import { Mat4, Ray, Vec3 } from './math';

export type CameraMode = 'orbit' | 'top' | 'walk';

export class Camera3D {
  position = new Vec3(4.5, 5.0, 5.5);
  target = new Vec3(0, 0, 0);
  up = new Vec3(0, 1, 0);
  fov = (50 * Math.PI) / 180;
  aspect = 1;
  near = 0.05;
  far = 200;

  viewMatrix = new Mat4();
  projMatrix = new Mat4();
  viewProjMatrix = new Mat4();
  invViewProjMatrix = new Mat4();

  updateMatrices(): void {
    this.viewMatrix.lookAt(this.position, this.target, this.up);
    this.projMatrix.perspective(this.fov, Math.max(0.1, this.aspect), this.near, this.far);
    this.viewProjMatrix.multiply(this.projMatrix, this.viewMatrix);
    this.invViewProjMatrix.invert(this.viewProjMatrix);
  }

  /** NDC (-1..1, -1..1) → 월드 Ray */
  ndcToRay(ndcX: number, ndcY: number): Ray {
    return Ray.fromCameraNDC(ndcX, ndcY, this.invViewProjMatrix);
  }

  /** 월드 좌표 → 화면 픽셀 좌표 (선택 가구 라벨 위치 계산용) */
  projectToScreen(worldPos: Vec3, width: number, height: number): { x: number; y: number; visible: boolean } {
    const clip = this.viewProjMatrix.projectToClip(worldPos);
    if (clip.w <= 0.001) return { x: -9999, y: -9999, visible: false };
    const ndcX = clip.x / clip.w;
    const ndcY = clip.y / clip.w;
    const ndcZ = clip.z / clip.w;
    const visible = ndcZ >= -1 && ndcZ <= 1 && ndcX >= -1.2 && ndcX <= 1.2 && ndcY >= -1.2 && ndcY <= 1.2;
    return {
      x: (ndcX * 0.5 + 0.5) * width,
      y: (-ndcY * 0.5 + 0.5) * height,
      visible,
    };
  }
}

export interface WalkBounds {
  width: number;
  depth: number;
}

/**
 * Orbit / Top / Walk 통합 카메라 컨트롤러.
 * Three.js OrbitControls + PointerLockControls 동작과 단축키를 1:1 재현.
 */
export class CameraController {
  readonly camera: Camera3D;
  private canvas: HTMLCanvasElement;
  mode: CameraMode = 'orbit';
  enabled = true;
  keyboardEnabled = true;
  roomSize = 5;
  walkBounds: WalkBounds | null = null;
  onWalkLockChange?: (locked: boolean) => void;
  onFocusRequestSelected?: () => void;

  // 구면 좌표 (orbit/top)
  private theta = Math.atan2(0.9, 1.1); // 수평각
  private phi = Math.acos(1.0 / Math.hypot(0.9, 1.0, 1.1)); // 천정각
  private radius = Math.hypot(0.9, 1.0, 1.1) * 5;

  // 1인칭 워크 회전각
  private walkYaw = 0;
  private walkPitch = 0;

  // 드래그 상태
  private dragAction: 'none' | 'rotate' | 'pan' | 'dolly' = 'none';
  private lastX = 0;
  private lastY = 0;

  // 부드러운 포커스/리셋 애니메이션 목표
  private goal: { target: Vec3; pos?: Vec3 } | null = null;

  // 키보드 상태
  private keys = new Set<string>();
  private shift = false;

  private cleanupFns: Array<() => void> = [];

  constructor(camera: Camera3D, canvas: HTMLCanvasElement) {
    this.camera = camera;
    this.canvas = canvas;
    this.bindEvents();
    this.setMode('orbit', 5);
  }

  setMode(mode: CameraMode, roomSize = this.roomSize): void {
    this.mode = mode;
    this.roomSize = roomSize;
    this.goal = null;
    if (document.pointerLockElement === this.canvas && mode !== 'walk') {
      document.exitPointerLock?.();
    }
    if (mode === 'orbit') {
      this.camera.target.set(0, 0, 0);
      this.camera.up.set(0, 1, 0);
      this.camera.position.set(roomSize * 0.9, roomSize * 1.0, roomSize * 1.1);
      this.syncSphericalFromCamera();
    } else if (mode === 'top') {
      this.camera.target.set(0, 0, 0);
      this.camera.up.set(0, 1, 0);
      this.camera.position.set(0, roomSize * 1.9, 0.001);
      this.syncSphericalFromCamera();
    } else {
      this.camera.position.set(0, 1.6, 0);
      this.walkYaw = 0;
      this.walkPitch = 0;
      this.updateWalkTarget();
    }
    this.camera.updateMatrices();
  }

  private syncSphericalFromCamera(): void {
    const dx = this.camera.position.x - this.camera.target.x;
    const dy = this.camera.position.y - this.camera.target.y;
    const dz = this.camera.position.z - this.camera.target.z;
    this.radius = Math.max(1.5, Math.hypot(dx, dy, dz));
    this.theta = Math.atan2(dx, dz);
    this.phi = Math.acos(Math.max(-1, Math.min(1, dy / this.radius)));
  }

  private applySphericalToCamera(): void {
    const sinPhi = Math.sin(this.phi);
    this.camera.position.set(
      this.camera.target.x + this.radius * sinPhi * Math.sin(this.theta),
      this.camera.target.y + this.radius * Math.cos(this.phi),
      this.camera.target.z + this.radius * sinPhi * Math.cos(this.theta),
    );
  }

  private updateWalkTarget(): void {
    const cosP = Math.cos(this.walkPitch);
    const dirX = -Math.sin(this.walkYaw) * cosP;
    const dirY = Math.sin(this.walkPitch);
    const dirZ = -Math.cos(this.walkYaw) * cosP;
    this.camera.target.set(
      this.camera.position.x + dirX,
      this.camera.position.y + dirY,
      this.camera.position.z + dirZ,
    );
  }

  focusOn(target: Vec3, frameDist?: number): void {
    if (this.mode === 'walk') return;
    let pos: Vec3 | undefined;
    if (frameDist) {
      const dir = this.camera.position.clone().sub(this.camera.target);
      const d = Math.max(frameDist, Math.min(Math.max(frameDist, 6), dir.len()));
      pos = target.clone().add(dir.normalize().scale(d));
    }
    this.goal = { target: target.clone(), pos };
  }

  resetView(): void {
    if (this.mode === 'walk') return;
    const s = this.roomSize;
    const pos =
      this.mode === 'top'
        ? new Vec3(0, s * 1.9, 0.001)
        : new Vec3(s * 0.9, s * 1.0, s * 1.1);
    this.goal = { target: new Vec3(0, 0, 0), pos };
  }

  update(dt: number): void {
    const clampedDt = Math.min(dt, 0.05);
    if (!this.keyboardEnabled && this.keys.size > 0) {
      this.keys.clear();
    }

    if (this.mode === 'walk') {
      const speed = (this.shift ? 2.6 : 1.4) * clampedDt;
      const fwd = new Vec3(-Math.sin(this.walkYaw), 0, -Math.cos(this.walkYaw)).normalize();
      const right = new Vec3(Math.cos(this.walkYaw), 0, -Math.sin(this.walkYaw)).normalize();
      const k = this.keys;
      if (k.has('KeyW') || k.has('ArrowUp')) this.camera.position.addScaled(fwd, speed);
      if (k.has('KeyS') || k.has('ArrowDown')) this.camera.position.addScaled(fwd, -speed);
      if (k.has('KeyD') || k.has('ArrowRight')) this.camera.position.addScaled(right, speed);
      if (k.has('KeyA') || k.has('ArrowLeft')) this.camera.position.addScaled(right, -speed);

      if (this.walkBounds) {
        const hw = Math.max(0.1, this.walkBounds.width / 2 - 0.25);
        const hd = Math.max(0.1, this.walkBounds.depth / 2 - 0.25);
        this.camera.position.x = Math.max(-hw, Math.min(hw, this.camera.position.x));
        this.camera.position.z = Math.max(-hd, Math.min(hd, this.camera.position.z));
      }
      this.camera.position.y = 1.6;
      this.updateWalkTarget();
      this.camera.updateMatrices();
      return;
    }

    // Orbit / Top: WASD 이동
    if (this.keys.size > 0) {
      const fwd = this.camera.target.clone().sub(this.camera.position);
      fwd.y = 0;
      if (fwd.lenSq() < 1e-8) fwd.set(0, 0, -1);
      fwd.normalize();
      const right = new Vec3().cross(fwd, this.camera.up).normalize();
      const k = this.keys;
      const f = (k.has('KeyW') ? 1 : 0) - (k.has('KeyS') ? 1 : 0);
      const s = (k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0);
      if (f || s) {
        const dist = this.camera.position.distTo(this.camera.target);
        const speed = Math.max(1.2, dist * 0.8) * (this.shift ? 2.2 : 1) * clampedDt;
        const move = new Vec3().addScaled(fwd, f).addScaled(right, s).normalize().scale(speed);
        this.camera.position.add(move);
        this.camera.target.add(move);
        this.syncSphericalFromCamera();
      }
    }

    // 포커스/리셋 지수 감쇠 애니메이션
    if (this.goal) {
      const a = 1 - Math.exp(-clampedDt * 9);
      const g = this.goal;
      const deltaTarget = g.target.clone().sub(this.camera.target).scale(a);
      this.camera.target.add(deltaTarget);
      if (g.pos) {
        this.camera.position.lerp(g.pos, a);
      } else {
        this.camera.position.add(deltaTarget);
      }
      this.syncSphericalFromCamera();
      const done =
        this.camera.target.distTo(g.target) < 0.002 &&
        (!g.pos || this.camera.position.distTo(g.pos) < 0.002);
      if (done) this.goal = null;
    }

    this.camera.updateMatrices();
  }

  private panByPixels(dx: number, dy: number): void {
    const rect = this.canvas.getBoundingClientRect();
    const h = Math.max(1, rect.height);
    const dist = this.camera.position.distTo(this.camera.target);
    const scale = (2 * dist * Math.tan(this.camera.fov * 0.5)) / h;

    const forward = this.camera.target.clone().sub(this.camera.position).normalize();
    const right = new Vec3().cross(forward, this.camera.up).normalize();

    if (this.mode === 'top') {
      const upOnGround = new Vec3(0, 0, -1);
      const offset = new Vec3()
        .addScaled(right, -dx * scale)
        .addScaled(upOnGround, dy * scale);
      this.camera.position.add(offset);
      this.camera.target.add(offset);
    } else {
      // 화면 기준 수평/수직 이동 (바닥 높이 유지 및 수직 팬 지원)
      const camUp = new Vec3().cross(right, forward).normalize();
      const offset = new Vec3()
        .addScaled(right, -dx * scale)
        .addScaled(camUp, dy * scale);
      this.camera.position.add(offset);
      this.camera.target.add(offset);
    }
    this.syncSphericalFromCamera();
  }

  private zoomByFactor(factor: number, clientX?: number, clientY?: number): void {
    const minD = 1.5;
    const maxD = this.roomSize * 4;
    const oldR = this.radius;
    const newR = Math.max(minD, Math.min(maxD, oldR * factor));
    if (Math.abs(newR - oldR) < 1e-6) return;

    // 커서 방향 줌 (zoomToCursor)
    if (clientX !== undefined && clientY !== undefined) {
      const rect = this.canvas.getBoundingClientRect();
      const ndcX = ((clientX - rect.left) / rect.width) * 2 - 1;
      const ndcY = -((clientY - rect.top) / rect.height) * 2 + 1;
      const ray = this.camera.ndcToRay(ndcX, ndcY);
      const hit = ray.intersectHorizontalPlane(0);
      if (hit) {
        const ratio = 1 - newR / oldR;
        this.camera.target.x += (hit.x - this.camera.target.x) * ratio;
        this.camera.target.z += (hit.z - this.camera.target.z) * ratio;
      }
    }

    this.radius = newR;
    this.applySphericalToCamera();
    this.camera.updateMatrices();
  }

  private bindEvents(): void {
    const el = this.canvas;

    const onContextMenu = (e: MouseEvent) => e.preventDefault();

    const onPointerDown = (e: PointerEvent) => {
      if (this.mode === 'walk') {
        if (document.pointerLockElement !== el) {
          el.requestPointerLock?.();
        }
        return;
      }
      if (!this.enabled) return;
      this.goal = null;

      if (this.mode === 'top') {
        this.dragAction = 'pan';
      } else {
        // 좌클릭(0) = 화면 이동(pan), Shift+좌클릭 = 회전(rotate)
        // 우클릭(2) = 화면 회전(rotate), Alt+우클릭 = 줌(dolly)
        // 휠클릭(1) = 화면 이동(pan)
        if (e.button === 0) {
          this.dragAction = e.shiftKey || e.ctrlKey ? 'rotate' : 'pan';
        } else if (e.button === 1) {
          this.dragAction = 'pan';
        } else if (e.button === 2) {
          this.dragAction = e.altKey ? 'dolly' : 'rotate';
        }
      }
      this.lastX = e.clientX;
      this.lastY = e.clientY;
    };

    const onPointerMove = (e: PointerEvent) => {
      if (this.mode === 'walk') {
        if (document.pointerLockElement === el) {
          const sens = 0.0022;
          this.walkYaw -= e.movementX * sens;
          this.walkPitch = Math.max(-Math.PI / 2.2, Math.min(Math.PI / 2.2, this.walkPitch - e.movementY * sens));
          this.updateWalkTarget();
          this.camera.updateMatrices();
        }
        return;
      }
      if (!this.enabled || this.dragAction === 'none') return;
      const dx = e.clientX - this.lastX;
      const dy = e.clientY - this.lastY;
      this.lastX = e.clientX;
      this.lastY = e.clientY;

      if (this.dragAction === 'rotate') {
        const rotSpeed = 0.0065;
        this.theta -= dx * rotSpeed;
        const maxPolar = Math.PI / 2 - 0.05;
        this.phi = Math.max(0.05, Math.min(maxPolar, this.phi - dy * rotSpeed));
        this.applySphericalToCamera();
        this.camera.updateMatrices();
      } else if (this.dragAction === 'pan') {
        this.panByPixels(dx, dy);
        this.camera.updateMatrices();
      } else if (this.dragAction === 'dolly') {
        const factor = Math.pow(0.995, -dy);
        this.zoomByFactor(factor);
      }
    };

    const onPointerUp = () => {
      this.dragAction = 'none';
    };

    const onWheel = (e: WheelEvent) => {
      if (this.mode === 'walk' || !this.enabled) return;
      e.preventDefault();
      this.goal = null;
      const factor = e.deltaY > 0 ? 1.1 : 1 / 1.1;
      this.zoomByFactor(factor, e.clientX, e.clientY);
    };

    const isTyping = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (!this.keyboardEnabled) return;
      if (e.key === 'Alt') {
        e.preventDefault();
        return;
      }
      if (e.key === 'Shift') this.shift = true;
      if (isTyping(e) || e.ctrlKey || e.metaKey || e.altKey) return;
      if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) {
        this.keys.add(e.code);
        if (this.mode !== 'walk' && ['KeyW', 'KeyA', 'KeyS', 'KeyD'].includes(e.code)) {
          this.goal = null;
        }
      } else if (this.mode !== 'walk') {
        if (e.code === 'KeyF') this.onFocusRequestSelected?.();
        else if (e.code === 'Home' || e.code === 'Digit0') this.resetView();
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (!this.keyboardEnabled) return;
      if (e.key === 'Alt') e.preventDefault();
      if (e.key === 'Shift') this.shift = false;
      this.keys.delete(e.code);
    };

    const onBlur = () => {
      this.keys.clear();
      this.shift = false;
      this.dragAction = 'none';
    };

    const onPointerLockChange = () => {
      const locked = document.pointerLockElement === el;
      this.onWalkLockChange?.(locked);
    };

    el.addEventListener('contextmenu', onContextMenu);
    el.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    el.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    document.addEventListener('pointerlockchange', onPointerLockChange);

    this.cleanupFns.push(() => {
      el.removeEventListener('contextmenu', onContextMenu);
      el.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      el.removeEventListener('wheel', onWheel);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      document.removeEventListener('pointerlockchange', onPointerLockChange);
    });
  }

  cancelDrag(): void {
    this.dragAction = 'none';
  }

  dispose(): void {
    this.cleanupFns.forEach((fn) => fn());
    this.cleanupFns = [];
  }
}
