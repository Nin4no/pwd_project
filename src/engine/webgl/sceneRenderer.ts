import type { FurnitureSpec, PlacedFurniture, Room } from '../../domain/types';
import { FURNITURE } from '../../data/furniture';

const BASE_SPECS = new Map(FURNITURE.map((s) => [s.id, s]));
const defaultGetSpec = (id: string) => BASE_SPECS.get(id);

export type SpecLookup = (id: string) => FurnitureSpec | undefined;
import {
  WALL_THICKNESS,
  computeWallOpenings,
  findClosedPolygons,
  getEffectiveSize,
  getScaleXZ,
  wallsBounds,
} from '../geometry';
import { Camera3D, CameraController, type CameraMode } from './camera';
import { buildFurnitureParts } from './furnitureBuilder';
import { Mat4, Vec3 } from './math';
import {
  createBoxEdgesGeometry,
  createPlaneXZGeometry,
  createPolygonFloorGeometry,
  createWallEdgesGeometry,
  createWallGeometry,
  parseHexColor,
} from './primitives';
import {
  GpuMesh,
  ShaderProgram,
  createGridShader,
  createLitShader,
} from './resources';
import { computeWallDataList, roomOffset, type ComputedWallData } from './RoomMesh';
import { computeFocusOccluders, type FocusOccludedSet } from './occlusion';
import { computeSunLighting, type LightingPreset } from './lighting';
import type { AlignGuideSegment } from '../layout/alignSnap';
import { AlignGuideLayer } from './alignGuideLayer';

interface GpuFurniturePart {
  mesh: GpuMesh;
  color: [number, number, number];
  alpha: number;
  roughness: number;
  metalness: number;
  emissive: [number, number, number];
}

interface CachedWallGpu {
  key: string;
  mesh: GpuMesh;
  capMesh: GpuMesh;
  edgeMesh: GpuMesh;
}

interface CachedSelectionGpu {
  wireMesh: GpuMesh;
  ringMesh: GpuMesh;
}

export class RoomWebGLRenderer {
  readonly canvas: HTMLCanvasElement;
  readonly gl: WebGL2RenderingContext;
  readonly camera: Camera3D;
  readonly controller: CameraController;

  private litShader: ShaderProgram;
  private gridShader: ShaderProgram;
  private gridMesh: GpuMesh;
  private alignGuideLayer: AlignGuideLayer;
  private modelMat = new Mat4();

  // 씬 상태
  private room: Room;
  private wallData: ComputedWallData[] = [];
  private wallOpacities = new Map<string, number>();
  private furnitureOpacities = new Map<string, number>();
  private riseProgress = 1;
  private cutaway = true;
  private selectedId: string | null = null;
  private focusedId: string | null = null;
  private collisions = new Set<string>();
  private lightingPreset: LightingPreset = 'daylight';

  // GPU 리소스 캐시
  private floorMeshes: GpuMesh[] = [];
  private wallsSignature = '';
  private wallGpuCache = new Map<string, CachedWallGpu>();
  private furnitureGpuCache = new Map<string, GpuFurniturePart[]>();
  private selectionGpuCache = new Map<string, CachedSelectionGpu>();

  /** 가구 스펙 조회 — 기본은 전역 카탈로그, 리메이크 UI는 방 범위(scoped) 카탈로그를 주입 */
  private getSpec: SpecLookup = defaultGetSpec;

  setSpecLookup(lookup: SpecLookup): void {
    this.getSpec = lookup;
    this.setRoom(this.room);
  }

  constructor(canvas: HTMLCanvasElement, initialRoom: Room, animate = false, specLookup?: SpecLookup) {
    if (specLookup) this.getSpec = specLookup;
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', {
      antialias: true,
      preserveDrawingBuffer: true,
      alpha: false,
    });
    if (!gl) {
      throw new Error('WebGL2를 지원하지 않는 브라우저입니다.');
    }
    this.gl = gl;
    this.room = initialRoom;
    this.riseProgress = animate ? 0.001 : 1;

    this.camera = new Camera3D();
    this.controller = new CameraController(this.camera, canvas);

    this.litShader = createLitShader(gl);
    this.gridShader = createGridShader(gl);
    this.gridMesh = new GpuMesh(gl, createPlaneXZGeometry(80, 80, -0.002));
    this.alignGuideLayer = new AlignGuideLayer(gl);

    this.syncRoomGeometry(initialRoom);
    const size = this.computeRoomSize(initialRoom);
    this.controller.setMode('orbit', size);
  }

  private computeRoomSize(room: Room): number {
    const b = wallsBounds(room.walls);
    return b ? Math.max(b.width, b.depth, 3) : 5;
  }

  setRoom(room: Room): void {
    this.room = room;
    this.syncRoomGeometry(room);
    const b = wallsBounds(room.walls);
    this.controller.walkBounds = b ? { width: b.width, depth: b.depth } : null;
    this.controller.roomSize = this.computeRoomSize(room);
  }

  setCameraMode(mode: CameraMode): void {
    this.cutaway = mode !== 'walk';
    if (mode === 'walk') {
      this.focusedId = null;
      this.alignGuideLayer.clear();
    }
    if (this.controller.mode !== mode) {
      this.controller.setMode(mode, this.computeRoomSize(this.room));
    }
  }

  setAlignGuides(guides: ReadonlyArray<AlignGuideSegment>): void {
    this.alignGuideLayer.setGuides(guides);
  }

  clearAlignGuides(): void {
    this.alignGuideLayer.clear();
  }

  setSelectionAndCollisions(selectedId: string | null, collisions?: Set<string>): void {
    if (this.focusedId && selectedId !== this.focusedId) {
      this.focusedId = null;
    }
    this.selectedId = selectedId;
    this.collisions = collisions ?? new Set<string>();
  }

  setLightingPreset(preset: LightingPreset): void {
    this.lightingPreset = preset;
  }

  getCameraAzimuth(): number {
    return this.controller.getAzimuth();
  }

  focusSelected(): void {
    if (!this.selectedId) {
      this.focusedId = null;
      this.controller.resetView();
      return;
    }
    this.focusFurniture(this.selectedId);
  }

  focusFurniture(id: string): void {
    const f = this.room.furniture.find((it) => it.id === id);
    const spec = f ? this.getSpec(f.specId) : undefined;
    if (!f || !spec) {
      this.focusedId = null;
      this.controller.resetView();
      return;
    }
    this.focusedId = id;
    const [w, d, h] = getEffectiveSize(f, spec);
    const elev = spec.wallMounted ? spec.elevation ?? 0 : 0;
    const r = Math.max(w, d, h);
    this.controller.focusOn(new Vec3(f.x, elev + h / 2, f.z), Math.max(2, r * 2.5));
  }

  resetView(opts?: { immediate?: boolean }): void {
    this.focusedId = null;
    this.controller.resetView(opts);
    if (opts?.immediate) {
      this.render(0);
    }
  }

  private syncRoomGeometry(room: Room): void {
    const gl = this.gl;
    const off = roomOffset(room.walls);

    // 1. 벽 목록 및 바닥 폴리곤 갱신 (벽 좌표가 바뀐 경우에만 바닥 재생성)
    const wallSig = room.walls
      .map((w) => `${w.id}:${w.a.x.toFixed(3)},${w.a.y.toFixed(3)}-${w.b.x.toFixed(3)},${w.b.y.toFixed(3)}`)
      .join('|');

    if (wallSig !== this.wallsSignature) {
      this.wallsSignature = wallSig;
      this.wallData = computeWallDataList(room.walls, off);

      this.floorMeshes.forEach((m) => m.dispose());
      this.floorMeshes = [];

      const polys = findClosedPolygons(room.walls);
      if (polys.length > 0) {
        this.floorMeshes = polys.map(
          (poly) => new GpuMesh(gl, createPolygonFloorGeometry(poly, off)),
        );
      } else {
        const b = wallsBounds(room.walls);
        if (b && b.width > 0.01 && b.depth > 0.01) {
          this.floorMeshes = [new GpuMesh(gl, createPlaneXZGeometry(b.width, b.depth, 0))];
        }
      }
    }

    // 2. 벽 개구부(창문) 포함 벽 메쉬 캐시 갱신
    const openings = computeWallOpenings(room.furniture, this.getSpec, room.walls, off);
    const aliveIds = new Set<string>();

    for (const w of this.wallData) {
      aliveIds.add(w.id);
      const ops = openings[w.id];
      const key = `${w.len.toFixed(4)}|${room.wallHeight}|${(ops ?? [])
        .map((o) => [o.start, o.end, o.bottom, o.top].map((v) => v.toFixed(3)).join(','))
        .join(';')}`;

      const cached = this.wallGpuCache.get(w.id);
      if (!cached || cached.key !== key) {
        if (cached) {
          cached.mesh.dispose();
          cached.capMesh.dispose();
          cached.edgeMesh.dispose();
        }
        const wallGeom = createWallGeometry(w.len, room.wallHeight, WALL_THICKNESS, ops);
        const capGeom = createPlaneXZGeometry(
          w.len + WALL_THICKNESS,
          WALL_THICKNESS,
          room.wallHeight + 0.002,
        );
        const edgeGeom = createWallEdgesGeometry(w.len, room.wallHeight, WALL_THICKNESS, ops);
        this.wallGpuCache.set(w.id, {
          key,
          mesh: new GpuMesh(gl, wallGeom),
          capMesh: new GpuMesh(gl, capGeom),
          edgeMesh: new GpuMesh(gl, edgeGeom),
        });
      }
      if (!this.wallOpacities.has(w.id)) {
        this.wallOpacities.set(w.id, 1);
      }
    }

    for (const [id, c] of this.wallGpuCache) {
      if (!aliveIds.has(id)) {
        c.mesh.dispose();
        c.capMesh.dispose();
        c.edgeMesh.dispose();
        this.wallGpuCache.delete(id);
        this.wallOpacities.delete(id);
      }
    }

    // 3. 가구 투명도 캐시 및 포커스 대상 정리
    const aliveFurnitureIds = new Set<string>();
    for (const item of room.furniture) {
      aliveFurnitureIds.add(item.id);
      if (!this.furnitureOpacities.has(item.id)) {
        this.furnitureOpacities.set(item.id, 1);
      }
    }
    for (const id of this.furnitureOpacities.keys()) {
      if (!aliveFurnitureIds.has(id)) {
        this.furnitureOpacities.delete(id);
      }
    }
    if (this.focusedId && !aliveFurnitureIds.has(this.focusedId)) {
      this.focusedId = null;
    }
  }

  private getFurnitureGpuParts(spec: FurnitureSpec): GpuFurniturePart[] {
    let parts = this.furnitureGpuCache.get(spec.id);
    if (!parts) {
      const built = buildFurnitureParts(spec);
      parts = built.map((p) => ({
        mesh: new GpuMesh(this.gl, p.geom),
        color: p.color,
        alpha: p.alpha,
        roughness: p.roughness,
        metalness: p.metalness,
        emissive: p.emissive,
      }));
      this.furnitureGpuCache.set(spec.id, parts);
    }
    return parts;
  }

  private getSelectionGpu(spec: FurnitureSpec): CachedSelectionGpu {
    let sel = this.selectionGpuCache.get(spec.id);
    if (!sel) {
      const [w, d, h] = spec.size;
      const wireGeom = createBoxEdgesGeometry(w + 0.02, h + 0.02, d + 0.02, 0, h / 2, 0);
      const ringGeom = createPlaneXZGeometry(w + 0.06, d + 0.06, 0.004);
      sel = {
        wireMesh: new GpuMesh(this.gl, wireGeom),
        ringMesh: new GpuMesh(this.gl, ringGeom),
      };
      this.selectionGpuCache.set(spec.id, sel);
    }
    return sel;
  }

  /** 화면 좌표 → 수평면(기본 바닥 y=0) 교차 좌표 */
  pickHorizontalPlane(clientX: number, clientY: number, planeY = 0): { x: number; z: number } | null {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    const ndcX = ((clientX - rect.left) / rect.width) * 2 - 1;
    const ndcY = -((clientY - rect.top) / rect.height) * 2 + 1;
    const ray = this.camera.ndcToRay(ndcX, ndcY);
    const hit = ray.intersectHorizontalPlane(planeY);
    return hit ? { x: hit.x, z: hit.z } : null;
  }

  /** 화면 좌표 → 가장 가까운 가구 Raycast 피킹 */
  pickFurniture(clientX: number, clientY: number): { item: PlacedFurniture; spec: FurnitureSpec } | null {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    const ndcX = ((clientX - rect.left) / rect.width) * 2 - 1;
    const ndcY = -((clientY - rect.top) / rect.height) * 2 + 1;
    const ray = this.camera.ndcToRay(ndcX, ndcY);

    let bestT = Infinity;
    let bestHit: { item: PlacedFurniture; spec: FurnitureSpec } | null = null;

    const activeTargetId = this.focusedId ?? this.selectedId;
    for (const item of this.room.furniture) {
      if (activeTargetId && (this.furnitureOpacities.get(item.id) ?? 1) < 0.5) {
        continue;
      }
      const spec = this.getSpec(item.specId);
      if (!spec) continue;
      const [w, d, h] = getEffectiveSize(item, spec);
      const elev = spec.wallMounted ? spec.elevation ?? 0 : 0;
      const cy = elev + h / 2;
      const rotY = (item.rotation * Math.PI) / 180;
      const t = ray.intersectOBB(item.x, cy, item.z, w / 2, h / 2, d / 2, rotY);
      if (t !== null && t < bestT) {
        bestT = t;
        bestHit = { item, spec };
      }
    }
    return bestHit;
  }

  /** 현재 캔버스 썸네일 캡처 (480x300 JPEG dataURL) */
  capture(): string | null {
    try {
      this.render(0);
      const src = this.canvas;
      const W = 480;
      const H = 300;
      const c = document.createElement('canvas');
      c.width = W;
      c.height = H;
      const ctx = c.getContext('2d');
      if (!ctx) return null;
      const sr = src.width / src.height;
      const dr = W / H;
      let sw = src.width;
      let sh = src.height;
      let sx = 0;
      let sy = 0;
      if (sr > dr) {
        sw = sh * dr;
        sx = (src.width - sw) / 2;
      } else {
        sh = sw / dr;
        sy = (src.height - sh) / 2;
      }
      ctx.drawImage(src, sx, sy, sw, sh, 0, 0, W, H);
      return c.toDataURL('image/jpeg', 0.75);
    } catch {
      return null;
    }
  }

  /** 현재 캔버스를 대상 캔버스에 원본 해상도로 복사 (인코딩 없는 빠른 스냅샷) */
  snapshotTo(target: HTMLCanvasElement): boolean {
    try {
      this.render(0);
      const src = this.canvas;
      if (src.width === 0 || src.height === 0) return false;
      target.width = src.width;
      target.height = src.height;
      const ctx = target.getContext('2d');
      if (!ctx) return false;
      ctx.clearRect(0, 0, target.width, target.height);
      ctx.drawImage(src, 0, 0);
      return true;
    } catch {
      return false;
    }
  }

  private resizeIfNeeded(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const displayW = Math.max(1, Math.floor(this.canvas.clientWidth * dpr));
    const displayH = Math.max(1, Math.floor(this.canvas.clientHeight * dpr));
    if (this.canvas.width !== displayW || this.canvas.height !== displayH) {
      this.canvas.width = displayW;
      this.canvas.height = displayH;
    }
    this.camera.aspect = displayW / displayH;
    this.gl.viewport(0, 0, displayW, displayH);
  }

  render(dt: number): void {
    this.resizeIfNeeded();
    this.controller.update(dt);

    const gl = this.gl;
    // 벽 생성 상승 애니메이션
    if (this.riseProgress < 1) {
      this.riseProgress = Math.min(1, this.riseProgress + dt * 1.1);
    }
    const riseScaleY = Math.max(0.001, 1 - Math.pow(1 - this.riseProgress, 3));

    // 선택·포커스 시선 가림(벽·가구) 판별
    const activeTargetId = this.focusedId ?? this.selectedId;
    let occluders: FocusOccludedSet = { wallIds: new Set(), furnitureIds: new Set() };
    if (this.cutaway && activeTargetId) {
      const targetItem = this.room.furniture.find((it) => it.id === activeTargetId);
      const targetSpec = targetItem ? this.getSpec(targetItem.specId) : undefined;
      if (targetItem && targetSpec) {
        occluders = computeFocusOccluders({
          cameraPos: this.camera.position,
          targetItem,
          targetSpec,
          walls: this.wallData,
          wallHeight: this.room.wallHeight,
          furniture: this.room.furniture,
          getSpec: this.getSpec,
        });
      }
    }

    // 카메라 방향 벽 컷어웨이 + 포커스 시선 가림 벽 투명도 업데이트
    const opacityLerp = Math.min(1, dt * 10);
    for (const w of this.wallData) {
      const prev = this.wallOpacities.get(w.id) ?? 1;
      const isOccluding = occluders.wallIds.has(w.id);
      if (!this.cutaway || (w.isInterior && !isOccluding)) {
        this.wallOpacities.set(w.id, 1);
        continue;
      }
      const dx = this.camera.position.x - w.cx;
      const dz = this.camera.position.z - w.cz;
      const outside = dx * w.nx + dz * w.nz > 0.05;
      const target = isOccluding || (outside && this.camera.position.y < this.room.wallHeight * 6) ? 0.16 : 1;
      const next = prev + (target - prev) * opacityLerp;
      this.wallOpacities.set(w.id, next);
    }

    // 포커스 시선 가림 가구/문 투명도 업데이트
    for (const item of this.room.furniture) {
      const prev = this.furnitureOpacities.get(item.id) ?? 1;
      const target = occluders.furnitureIds.has(item.id) ? 0.16 : 1;
      const next = prev + (target - prev) * opacityLerp;
      this.furnitureOpacities.set(item.id, next);
    }

    // 화면 클리어 (조명 프리셋 + 방 향 기준 태양광)
    const light = computeSunLighting(this.lightingPreset, this.room.facing);
    gl.depthMask(true);
    gl.clearColor(light.clearColor[0], light.clearColor[1], light.clearColor[2], 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.disable(gl.CULL_FACE);

    const vp = this.camera.viewProjMatrix.elements;
    const camPos = this.camera.position;

    const [kx, ky, kz] = light.keyDir;
    const kLen = Math.hypot(kx, ky, kz) || 1;
    const [fx, fy, fz] = light.fillDir;
    const fLen = Math.hypot(fx, fy, fz) || 1;

    // 1. 바닥 메쉬 렌더링
    this.litShader.use();
    this.litShader.setVec3('u_skyColor', light.sky[0], light.sky[1], light.sky[2]);
    this.litShader.setVec3('u_groundColor', light.ground[0], light.ground[1], light.ground[2]);
    this.litShader.setVec3('u_keyDir', kx / kLen, ky / kLen, kz / kLen);
    this.litShader.setVec3('u_keyColor', light.keyColor[0], light.keyColor[1], light.keyColor[2]);
    this.litShader.setVec3('u_fillDir', fx / fLen, fy / fLen, fz / fLen);
    this.litShader.setVec3('u_fillColor', light.fillColor[0], light.fillColor[1], light.fillColor[2]);
    this.litShader.setMat4('u_viewProj', vp);
    this.litShader.setVec3('u_cameraPos', camPos.x, camPos.y, camPos.z);
    this.modelMat.identity();
    this.litShader.setMat4('u_model', this.modelMat.elements);
    this.litShader.setVec3('u_color', 0.875, 0.785, 0.655); // 따뜻한 오크 우드 톤 (#dfc8a7)
    this.litShader.setFloat('u_alpha', 1.0);
    this.litShader.setFloat('u_roughness', 0.78);
    this.litShader.setFloat('u_metalness', 0.0);
    this.litShader.setVec3('u_emissive', 0, 0, 0);
    this.litShader.setFloat('u_unlit', 0.0);
    this.litShader.setFloat('u_isFloor', 1.0);
    this.litShader.setFloat('u_isWall', 0.0);

    gl.disable(gl.BLEND);
    gl.depthFunc(gl.LESS);
    for (const fm of this.floorMeshes) {
      fm.draw();
    }
    gl.depthFunc(gl.LEQUAL);
    this.litShader.setFloat('u_isFloor', 0.0);

    // 2. 모눈종이 그리드 렌더링 (반투명)
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    this.gridShader.use();
    this.gridShader.setMat4('u_viewProj', vp);
    this.gridShader.setVec3('u_cameraPos', camPos.x, camPos.y, camPos.z);
    this.gridMesh.draw();
    gl.depthMask(true);

    // 3. 불투명 벽 & 상단 캡 렌더링
    this.litShader.use();
    this.litShader.setMat4('u_viewProj', vp);
    this.litShader.setVec3('u_cameraPos', camPos.x, camPos.y, camPos.z);
    gl.disable(gl.BLEND);

    const transparentWalls: ComputedWallData[] = [];
    for (const w of this.wallData) {
      const op = this.wallOpacities.get(w.id) ?? 1;
      if (op < 0.99) {
        transparentWalls.push(w);
        continue;
      }
      this.drawWall(w, 1.0, riseScaleY);
    }
    this.litShader.setFloat('u_isWall', 0.0);

    // 4. 가구 불투명 파트 렌더링
    const transparentFurnitureDraws: Array<{
      item: PlacedFurniture;
      part: GpuFurniturePart;
      alpha: number;
      wasOpaquePart: boolean;
      distSq: number;
      elev: number;
      rotY: number;
      sx: number;
      sy: number;
      sz: number;
    }> = [];

    for (const item of this.room.furniture) {
      const spec = this.getSpec(item.specId);
      if (!spec) continue;
      const elev = spec.wallMounted ? (spec.elevation ?? 0) : 0;
      const rotY = (item.rotation * Math.PI) / 180;
      const [sx, sy, sz] = getScaleXZ(item, spec);
      const itemOpacity = this.furnitureOpacities.get(item.id) ?? 1;
      const dx = item.x - camPos.x;
      const dy = elev - camPos.y;
      const dz = item.z - camPos.z;
      const distSq = dx * dx + dy * dy + dz * dz;

      this.modelMat.composeTRS(item.x, elev, item.z, rotY, sx, sy, sz);
      this.litShader.setMat4('u_model', this.modelMat.elements);
      this.litShader.setFloat('u_unlit', 0.0);

      const parts = this.getFurnitureGpuParts(spec);
      for (const p of parts) {
        const effectiveAlpha = p.alpha * itemOpacity;
        if (effectiveAlpha < 0.99) {
          transparentFurnitureDraws.push({
            item,
            part: p,
            alpha: effectiveAlpha,
            wasOpaquePart: p.alpha >= 0.99,
            distSq,
            elev,
            rotY,
            sx,
            sy,
            sz,
          });
          continue;
        }
        this.litShader.setVec3('u_color', p.color[0], p.color[1], p.color[2]);
        this.litShader.setFloat('u_alpha', 1.0);
        this.litShader.setFloat('u_roughness', p.roughness);
        this.litShader.setFloat('u_metalness', p.metalness);
        this.litShader.setVec3('u_emissive', p.emissive[0], p.emissive[1], p.emissive[2]);
        p.mesh.draw();
      }
    }

    // 5. 선택 / 충돌 가구 하이라이트 (바닥 패드 + 외곽선)
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    for (const item of this.room.furniture) {
      const isSelected = item.id === this.selectedId;
      const isColliding = this.collisions.has(item.id);
      if (!isSelected && !isColliding) continue;
      const spec = this.getSpec(item.specId);
      if (!spec) continue;

      const [r, g, b] = parseHexColor(isColliding ? '#ef4444' : '#1e6bff');
      const elev = spec.wallMounted ? (spec.elevation ?? 0) : 0;
      const rotY = (item.rotation * Math.PI) / 180;
      const [sx, sy, sz] = getScaleXZ(item, spec);
      this.modelMat.composeTRS(item.x, elev, item.z, rotY, sx, sy, sz);
      this.litShader.setMat4('u_model', this.modelMat.elements);
      this.litShader.setVec3('u_color', r, g, b);
      this.litShader.setVec3('u_emissive', 0, 0, 0);
      this.litShader.setFloat('u_unlit', 1.0);

      const selGpu = this.getSelectionGpu(spec);
      if (!spec.wallMounted) {
        gl.depthMask(false);
        this.litShader.setFloat('u_alpha', 0.22);
        selGpu.ringMesh.draw();
        gl.depthMask(true);
      }
      this.litShader.setFloat('u_alpha', 1.0);
      selGpu.wireMesh.draw();
    }

    // 6. 가구 반투명 파트 (창문 유리 + 포커스 가림 가구 페이드)
    transparentFurnitureDraws.sort((a, b) => b.distSq - a.distSq);
    gl.depthMask(false);
    this.litShader.setFloat('u_unlit', 0.0);
    for (const entry of transparentFurnitureDraws) {
      const { item, part, alpha, wasOpaquePart, elev, rotY, sx, sy, sz } = entry;
      if (wasOpaquePart) {
        gl.enable(gl.CULL_FACE);
        gl.cullFace(gl.BACK);
      }
      this.modelMat.composeTRS(item.x, elev, item.z, rotY, sx, sy, sz);
      this.litShader.setMat4('u_model', this.modelMat.elements);
      this.litShader.setVec3('u_color', part.color[0], part.color[1], part.color[2]);
      this.litShader.setFloat('u_alpha', alpha);
      this.litShader.setFloat('u_roughness', part.roughness);
      this.litShader.setFloat('u_metalness', part.metalness);
      this.litShader.setVec3('u_emissive', part.emissive[0], part.emissive[1], part.emissive[2]);
      part.mesh.draw();
      if (wasOpaquePart) {
        gl.disable(gl.CULL_FACE);
      }
    }

    // 7. 컷어웨이 반투명 벽 렌더링
    for (const w of transparentWalls) {
      const op = this.wallOpacities.get(w.id) ?? 0.12;
      gl.depthMask(op > 0.5);
      this.drawWall(w, op, riseScaleY);
    }

    // 7.5. 가구 스마트 정렬 가이드 (Shift + 드래그)
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.depthMask(false);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.disable(gl.CULL_FACE);
    this.alignGuideLayer.render(vp);

    gl.depthMask(true);
    gl.disable(gl.BLEND);
  }

  private drawWall(w: ComputedWallData, opacity: number, riseScaleY: number): void {
    const gpu = this.wallGpuCache.get(w.id);
    if (!gpu) return;
    const gl = this.gl;
    this.modelMat.composeTRS(w.cx, 0, w.cz, w.rotY, 1, riseScaleY, 1);
    this.litShader.setMat4('u_model', this.modelMat.elements);

    // 반투명 컷어웨이 벽일 때는 뒷면 컬링을 켜서 앞·뒷면 중복 알파 중첩 방지
    if (opacity < 0.99) {
      gl.enable(gl.CULL_FACE);
      gl.cullFace(gl.BACK);
    }

    gl.enable(gl.POLYGON_OFFSET_FILL);
    gl.polygonOffset(1.0, 1.0);

    // 벽 본체 (#f1f5f9)
    this.litShader.setVec3('u_color', 0.945, 0.961, 0.976);
    this.litShader.setFloat('u_alpha', opacity);
    this.litShader.setFloat('u_roughness', 0.88);
    this.litShader.setFloat('u_metalness', 0.0);
    this.litShader.setVec3('u_emissive', 0, 0, 0);
    this.litShader.setFloat('u_unlit', 0.0);
    this.litShader.setFloat('u_isFloor', 0.0);
    this.litShader.setFloat('u_isWall', 1.0);
    gpu.mesh.draw();

    gl.disable(gl.POLYGON_OFFSET_FILL);
    if (opacity < 0.99) {
      gl.disable(gl.CULL_FACE);
    }

    // 벽 상단 단면 캡 (#334155) — 불투명할 때 선명하게 강조
    if (opacity > 0.5) {
      this.litShader.setVec3('u_color', 0.2, 0.255, 0.333);
      this.litShader.setFloat('u_alpha', opacity);
      this.litShader.setFloat('u_unlit', 1.0);
      this.litShader.setFloat('u_isWall', 0.0);
      gpu.capMesh.draw();
    }

    // 건축 외곽선 (벽 모서리·바닥 접합선·창문 틀을 선명하게 표시)
    this.litShader.setVec3('u_color', 0.45, 0.52, 0.62);
    this.litShader.setFloat('u_alpha', opacity > 0.5 ? 0.65 : 0.32);
    this.litShader.setFloat('u_unlit', 1.0);
    this.litShader.setFloat('u_isWall', 0.0);
    gpu.edgeMesh.draw();
  }

  dispose(): void {
    this.controller.dispose();
    this.alignGuideLayer.dispose();
    this.gridMesh.dispose();
    this.floorMeshes.forEach((m) => m.dispose());
    this.floorMeshes = [];
    this.wallGpuCache.forEach((c) => {
      c.mesh.dispose();
      c.capMesh.dispose();
      c.edgeMesh.dispose();
    });
    this.wallGpuCache.clear();
    this.furnitureGpuCache.forEach((parts) => parts.forEach((p) => p.mesh.dispose()));
    this.furnitureGpuCache.clear();
    this.selectionGpuCache.forEach((s) => {
      s.wireMesh.dispose();
      s.ringMesh.dispose();
    });
    this.selectionGpuCache.clear();
    this.litShader.dispose();
    this.gridShader.dispose();
  }
}
