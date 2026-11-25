import type { PlacedFurniture, Point, Wall } from '../../domain/types';
import type { CatalogReader } from '../../domain/catalog';
import { WALL_THICKNESS, dist, extractRooms, findClosedPolygons, formatLength, getEffectiveSize, isSwingDoor, isWallSurfaceSpec, nearestWall as nearestWallHit, samePoint, wallInwardNormal, wallsBounds, type ExtractedRoom } from '../geometry';
import { ZERO_OFFSET, doorTangent, uniqueVertices } from './hit';
import type { ToolState } from './tools';
import type { PlanBackground, PlanTheme, PlanView } from './types';

/** 기본 테마 — tokens.css 값과 동일. 실제 앱은 FloorplanEditor가 CSS 변수에서 읽어 덮어씀 */
export const DEFAULT_THEME: PlanTheme = {
  bg: '#ffffff',
  gridMinor: 'rgba(61, 111, 184, 0.06)',
  gridMid: 'rgba(61, 111, 184, 0.12)',
  gridMajor: 'rgba(61, 111, 184, 0.22)',
  axisLabel: '#8B95A1',
  roomFill: 'rgba(61, 111, 184, 0.10)',
  roomFillNested: 'rgba(61, 111, 184, 0.06)',
  wall: '#191F28',
  wallHover: '#3D6FB8',
  wallErase: '#F04452',
  vertex: '#ffffff',
  vertexHover: '#3D6FB8',
  dimension: '#4E5968',
  dimensionPreview: '#3D6FB8',
  preview: 'rgba(61, 111, 184, 0.55)',
  chainStart: '#03B26C',
  door: '#B8742D',
  doorFill: '#FBF1E2',
  doorHover: '#8A5520',
  doorHoverFill: '#F7E1B8',
  doorErase: '#F04452',
  doorEraseFill: '#FFEEEE',
  furnitureFill: 'rgba(61, 111, 184, 0.12)',
  furnitureStroke: '#3D6FB8',
  furnitureLabel: '#2F5A99',
  windowFill: '#E6F3FB',
  windowStroke: '#2E8BC0',
  areaLabel: '#2F5A99',
  areaSub: '#4E5968',
  fontMono: "'JetBrains Mono', ui-monospace, monospace",
  fontSans: "'Pretendard Variable', 'Pretendard', 'Malgun Gothic', sans-serif",
};

export interface RenderInput {
  ctx: CanvasRenderingContext2D;
  width: number;
  height: number;
  view: PlanView;
  state: ToolState;
  theme: PlanTheme;
  catalog: CatalogReader;
  background: PlanBackground | null;
  furniture: PlacedFurniture[];
  rooms: ExtractedRoom[];
}

export function renderPlan(input: RenderInput): void {
  const { ctx, width, height, view, state, theme, catalog, background, furniture, rooms } = input;
  const { doc, tool, hover } = state;
  const toScreen = (p: Point) => ({ x: p.x * view.scale + view.ox, y: p.y * view.scale + view.oy });
  const toWorld = (sx: number, sy: number): Point => ({ x: (sx - view.ox) / view.scale, y: (sy - view.oy) / view.scale });

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = theme.bg;
  ctx.fillRect(0, 0, width, height);

  const bounds = wallsBounds(doc.walls);
  if (background?.visible && bounds && bounds.width > 0.1 && bounds.depth > 0.1) {
    const p0 = toScreen({ x: bounds.minX, y: bounds.minY });
    const p1 = toScreen({ x: bounds.maxX, y: bounds.maxY });
    ctx.save();
    ctx.globalAlpha = background.opacity ?? 0.24;
    ctx.drawImage(background.image, p0.x, p0.y, p1.x - p0.x, p1.y - p0.y);
    ctx.restore();
  }

  // 모눈 0.1 / 0.5 / 1m
  const tl = toWorld(0, 0), br = toWorld(width, height);
  const drawGrid = (step: number, color: string) => {
    ctx.strokeStyle = color; ctx.lineWidth = 1; ctx.beginPath();
    for (let x = Math.floor(tl.x / step) * step; x <= br.x; x += step) { const s = x * view.scale + view.ox; ctx.moveTo(s, 0); ctx.lineTo(s, height); }
    for (let y = Math.floor(tl.y / step) * step; y <= br.y; y += step) { const s = y * view.scale + view.oy; ctx.moveTo(0, s); ctx.lineTo(width, s); }
    ctx.stroke();
  };
  if (view.scale * 0.1 >= 6) drawGrid(0.1, theme.gridMinor);
  drawGrid(0.5, theme.gridMid);
  drawGrid(1, theme.gridMajor);
  ctx.fillStyle = theme.axisLabel; ctx.font = `10px ${theme.fontMono}`;
  for (let x = Math.ceil(tl.x); x <= br.x; x++) ctx.fillText(`${x}m`, x * view.scale + view.ox + 3, 11);
  for (let y = Math.ceil(tl.y); y <= br.y; y++) ctx.fillText(`${y}m`, 3, y * view.scale + view.oy - 3);

  // 닫힌 공간 채우기
  for (const r of rooms) {
    ctx.beginPath();
    r.outer.forEach((p, i) => { const s = toScreen(p); i ? ctx.lineTo(s.x, s.y) : ctx.moveTo(s.x, s.y); });
    ctx.closePath();
    for (const hole of r.holes) { hole.forEach((p, i) => { const s = toScreen(p); i ? ctx.lineTo(s.x, s.y) : ctx.moveTo(s.x, s.y); }); ctx.closePath(); }
    ctx.fillStyle = r.holes.length ? theme.roomFillNested : theme.roomFill;
    ctx.fill('evenodd');
  }

  // 바닥 가구 풋프린트 (읽기 전용 미리보기 — 벽 표면 부착형은 벽 위에 별도 렌더링)
  for (const f of furniture) {
    const spec = catalog.get(f.specId);
    if (!spec || spec.category === 'door' || isWallSurfaceSpec(spec)) continue;
    const [w, d] = getEffectiveSize(f, spec);
    const s = toScreen({ x: f.x, y: f.z });
    const sw = w * view.scale, sh = d * view.scale;
    ctx.save();
    ctx.translate(s.x, s.y);
    ctx.rotate(((f.rotation || 0) * Math.PI) / 180);
    if (spec.category === 'window') {
      ctx.fillStyle = theme.windowFill; ctx.strokeStyle = theme.windowStroke; ctx.lineWidth = 2;
      ctx.fillRect(-sw / 2, -sh / 2, sw, sh); ctx.strokeRect(-sw / 2, -sh / 2, sw, sh);
    } else {
      ctx.fillStyle = theme.furnitureFill; ctx.strokeStyle = theme.furnitureStroke; ctx.lineWidth = 1.5;
      ctx.beginPath();
      if (typeof ctx.roundRect === 'function') ctx.roundRect(-sw / 2, -sh / 2, sw, sh, 4); else ctx.rect(-sw / 2, -sh / 2, sw, sh);
      ctx.fill(); ctx.stroke();
      if (sw > 36 && sh > 16) {
        ctx.fillStyle = theme.furnitureLabel; ctx.font = `600 11px ${theme.fontSans}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(spec.name.replace(/\s*\([^)]*\)/g, '').trim() || spec.name, 0, 0);
        ctx.textAlign = 'start'; ctx.textBaseline = 'alphabetic';
      }
    }
    ctx.restore();
  }

  const thick = Math.max(4, WALL_THICKNESS * view.scale);
  const drawWall = (a: Point, b: Point, color: string, dashed = false) => {
    const sa = toScreen(a), sb = toScreen(b);
    ctx.strokeStyle = color; ctx.lineWidth = thick; ctx.lineCap = 'square';
    ctx.setLineDash(dashed ? [8, 6] : []);
    ctx.beginPath(); ctx.moveTo(sa.x, sa.y); ctx.lineTo(sb.x, sb.y); ctx.stroke();
    ctx.setLineDash([]);
  };
  const drawLabel = (a: Point, b: Point, color: string) => {
    const len = dist(a, b);
    if (len < 0.05) return;
    const sa = toScreen(a), sb = toScreen(b);
    const mx = (sa.x + sb.x) / 2, my = (sa.y + sb.y) / 2;
    const L = Math.hypot(sb.x - sa.x, sb.y - sa.y) || 1;
    const nx = -(sb.y - sa.y) / L, ny = (sb.x - sa.x) / L;
    const lx = mx + nx * (thick / 2 + 13), ly = my + ny * (thick / 2 + 13);
    const text = formatLength(len);
    ctx.font = `600 12px ${theme.fontMono}`;
    const tw = ctx.measureText(text).width;
    ctx.fillStyle = 'rgba(255,255,255,.92)';
    ctx.fillRect(lx - tw / 2 - 4, ly - 9, tw + 8, 18);
    ctx.fillStyle = color; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(text, lx, ly);
    ctx.textAlign = 'start'; ctx.textBaseline = 'alphabetic';
  };

  for (const w of doc.walls) {
    const col = tool === 'erase' && w.id === hover.eraseWallId ? theme.wallErase : tool === 'select' && w.id === hover.wallId ? theme.wallHover : theme.wall;
    drawWall(w.a, w.b, col);
  }

  const polys = findClosedPolygons(doc.walls);
  for (const d of doc.doors) drawDoor(ctx, d, doc.walls, catalog, view, theme, polys, tool === 'erase' && d.id === hover.eraseDoorId, (tool === 'door' || tool === 'select') && d.id === hover.doorId);
  for (const f of furniture) {
    const spec = catalog.get(f.specId);
    if (spec && isWallSurfaceSpec(spec)) drawWallSurfaceSymbol(ctx, f, spec, view);
  }
  for (const w of doc.walls) drawLabel(w.a, w.b, theme.dimension);

  // 면적 라벨
  for (const r of rooms) {
    const s = toScreen(r.label);
    const line1 = `${r.areaM2.toFixed(2)}m²`, line2 = `약 ${r.pyeong.toFixed(1)}평`;
    ctx.font = `600 14px ${theme.fontMono}`; const w1 = ctx.measureText(line1).width;
    ctx.font = `12px ${theme.fontSans}`; const w2 = ctx.measureText(line2).width;
    const boxW = Math.max(w1, w2) + 14, boxH = 38;
    ctx.fillStyle = 'rgba(255,255,255,0.92)'; ctx.strokeStyle = theme.gridMajor; ctx.lineWidth = 1;
    ctx.beginPath();
    if (typeof ctx.roundRect === 'function') ctx.roundRect(s.x - boxW / 2, s.y - 16, boxW, boxH, 6); else ctx.rect(s.x - boxW / 2, s.y - 16, boxW, boxH);
    ctx.fill(); ctx.stroke();
    ctx.textAlign = 'center';
    ctx.fillStyle = theme.areaLabel; ctx.font = `600 14px ${theme.fontMono}`; ctx.fillText(line1, s.x, s.y - 1);
    ctx.fillStyle = theme.areaSub; ctx.font = `11.5px ${theme.fontSans}`; ctx.fillText(line2, s.x, s.y + 15);
    ctx.textAlign = 'start';
  }

  // 꼭짓점
  for (const v of uniqueVertices(doc.walls)) {
    const s = toScreen(v);
    const hot = !!hover.vertex && samePoint(hover.vertex, v);
    ctx.fillStyle = hot ? theme.vertexHover : theme.vertex;
    ctx.strokeStyle = hot ? theme.wallHover : theme.furnitureStroke;
    ctx.lineWidth = hot ? 2.5 : 2;
    ctx.beginPath(); ctx.arc(s.x, s.y, hot ? 6.5 : 4.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  }

  // 미리보기
  const hp = hover.point;
  if (tool === 'wall' && state.chain && hp) {
    drawWall(state.chain.last, hp, theme.preview, true);
    drawLabel(state.chain.last, hp, theme.dimensionPreview);
    const s = toScreen(state.chain.start);
    ctx.strokeStyle = theme.chainStart; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(s.x, s.y, 8, 0, Math.PI * 2); ctx.stroke();
  }
  if (tool === 'rect' && state.rectStart && hp) {
    const r = state.rectStart;
    const pts: Point[] = [r, { x: hp.x, y: r.y }, hp, { x: r.x, y: hp.y }];
    pts.forEach((a, i) => drawWall(a, pts[(i + 1) % 4], theme.preview, true));
    drawLabel(pts[0], pts[1], theme.dimensionPreview);
    drawLabel(pts[1], pts[2], theme.dimensionPreview);
  }
  if (hp && (tool === 'wall' || tool === 'rect') && !hover.vertex) {
    const s = toScreen(hp);
    ctx.fillStyle = theme.wallHover;
    ctx.beginPath(); ctx.arc(s.x, s.y, 4, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = theme.gridMajor; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(s.x, 0); ctx.lineTo(s.x, height); ctx.moveTo(0, s.y); ctx.lineTo(width, s.y); ctx.stroke();
  }
}

function drawDoor(
  ctx: CanvasRenderingContext2D,
  f: PlacedFurniture,
  walls: Wall[],
  catalog: CatalogReader,
  view: PlanView,
  theme: PlanTheme,
  polys: Point[][],
  erasing: boolean,
  hovered: boolean,
) {
  const spec = catalog.get(f.specId);
  if (!spec) return;
  const [w] = getEffectiveSize(f, spec);
  const toScreen = (p: Point) => ({ x: p.x * view.scale + view.ox, y: p.y * view.scale + view.oy });
  const host = nearestWallHit(f.x, f.z, walls, ZERO_OFFSET);
  const { ux, uz } = doorTangent(f, walls);
  const t = { x: ux, y: uz };
  const nIn = host && host.d <= WALL_THICKNESS ? wallInwardNormal(f.x, f.z, host, walls, ZERO_OFFSET, polys) : { x: -t.y, z: t.x };
  const stroke = erasing ? theme.doorErase : hovered ? theme.doorHover : theme.door;

  if (isSwingDoor(spec)) {
    const swing = f.swing ?? { hinge: 'left' as const, dir: 'in' as const };
    const dir = swing.dir === 'out' ? { x: -nIn.x, y: -nIn.z } : { x: nIn.x, y: nIn.z };
    const side = swing.hinge === 'left' ? -1 : 1;
    const hx = f.x + t.x * ((side * w) / 2) + dir.x * (WALL_THICKNESS / 2);
    const hy = f.z + t.y * ((side * w) / 2) + dir.y * (WALL_THICKNESS / 2);
    const sH = toScreen({ x: hx, y: hy });
    const radius = w * view.scale;
    const vClosed = { x: -side * t.x, y: -side * t.y };
    const a0 = Math.atan2(vClosed.y, vClosed.x), a1 = Math.atan2(dir.y, dir.x);
    const ccw = vClosed.x * dir.y - vClosed.y * dir.x < 0;
    ctx.save();
    ctx.beginPath(); ctx.moveTo(sH.x, sH.y); ctx.arc(sH.x, sH.y, radius, a0, a1, ccw); ctx.closePath();
    ctx.fillStyle = erasing ? theme.doorEraseFill : theme.doorFill; ctx.globalAlpha = 0.6; ctx.fill(); ctx.globalAlpha = 1;
    ctx.beginPath(); ctx.arc(sH.x, sH.y, radius, a0, a1, ccw);
    ctx.setLineDash([4, 3]); ctx.strokeStyle = stroke; ctx.lineWidth = 1.25; ctx.stroke(); ctx.setLineDash([]);
    const tip = toScreen({ x: hx + dir.x * w, y: hy + dir.y * w });
    ctx.beginPath(); ctx.moveTo(sH.x, sH.y); ctx.lineTo(tip.x, tip.y); ctx.strokeStyle = stroke; ctx.lineWidth = 2; ctx.stroke();
    ctx.restore();
  }

  const s = toScreen({ x: f.x, y: f.z });
  const sw = w * view.scale, sh = WALL_THICKNESS * view.scale;
  ctx.save();
  ctx.translate(s.x, s.y);
  ctx.rotate(Math.atan2(t.y, t.x));
  ctx.fillStyle = erasing ? theme.doorEraseFill : hovered ? theme.doorHoverFill : theme.doorFill;
  ctx.strokeStyle = stroke;
  ctx.lineWidth = hovered || erasing ? 2.5 : 2;
  ctx.fillRect(-sw / 2, -sh / 2, sw, sh);
  ctx.strokeRect(-sw / 2, -sh / 2, sw, sh);
  ctx.restore();
}

function drawWallSurfaceSymbol(
  ctx: CanvasRenderingContext2D,
  f: PlacedFurniture,
  spec: NonNullable<ReturnType<CatalogReader['get']>>,
  view: PlanView,
) {
  const [w, d] = getEffectiveSize(f, spec);
  const sx = f.x * view.scale + view.ox;
  const sy = f.z * view.scale + view.oy;
  const sw = Math.max(12, w * view.scale);
  const sh = Math.max(6, d * view.scale);
  const radius = Math.min(2.5, sh / 3);
  const dotR = Math.max(1.2, Math.min(2, sh * 0.22));
  const dotOffset = sw * 0.22;

  ctx.save();
  ctx.translate(sx, sy);
  ctx.rotate(-((f.rotation || 0) * Math.PI) / 180);
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = '#334155';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(-sw / 2, -sh / 2, sw, sh, radius);
  } else {
    ctx.rect(-sw / 2, -sh / 2, sw, sh);
  }
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = '#1e293b';
  ctx.beginPath();
  ctx.arc(-dotOffset, 0, dotR, 0, Math.PI * 2);
  ctx.arc(dotOffset, 0, dotR, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

export const roomsOf = (walls: Wall[]) => extractRooms(walls);
