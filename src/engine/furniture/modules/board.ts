/**
 * board — 벽걸이 판(타공판·벽선반)
 * params: kind('pegboard'|'shelf'), holes(boolean|number, 격자 간격 0.05, 최대 12×10),
 *         shelves(0~3), hooks(0~6)
 */
import type { ProceduralPrimitive } from '../../../domain/types';
import { boxD, boxH, boxW } from '../blueprint';
import { boxPrim, registerModule } from '../assemble';

registerModule('board', (b, m, c) => {
  const W = boxW(b), D = boxD(b), H = boxH(b);
  const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
  const kind = c.str('kind', 'pegboard');
  const shelves = Math.max(0, Math.min(3, Math.round(c.num('shelves', kind === 'shelf' ? 1 : 0))));
  const hooks = Math.max(0, Math.min(6, Math.round(c.num('hooks', kind === 'pegboard' ? 4 : 0))));
  const rawHoles = m.params?.holes;
  const showHoles = typeof rawHoles === 'number' ? rawHoles > 0 : c.bool('holes', kind === 'pegboard');

  const boardMat = c.mat(m.material);
  const accMat = c.mat(m.accent ?? (c.accent !== c.main ? c.accent : 'steel_black'));
  const holeMat = c.mat('black');
  const prims: ProceduralPrimitive[] = [];

  const holeD = showHoles ? Math.min(0.006, Math.max(0.004, D * 0.25)) : 0;
  const plateT = shelves === 0 && hooks === 0 ? Math.max(0.008, D - holeD) : Math.min(0.022, D * 0.35);
  const plateZ1 = b.z0 + plateT;
  prims.push(boxPrim({ x0: b.x0, x1: b.x1, y0: b.y0, y1: b.y1, z0: b.z0, z1: plateZ1 }, boardMat));

  // 선반 (0~3)
  const shelfYs: number[] = [];
  if (shelves > 0) {
    const st = Math.min(0.02, H * 0.15);
    const sx0 = kind === 'shelf' ? b.x0 : b.x0 + Math.min(0.04, W * 0.08);
    const sx1 = kind === 'shelf' ? b.x1 : b.x1 - Math.min(0.04, W * 0.08);
    for (let i = 0; i < shelves; i++) {
      const y0 = shelves === 1 && kind === 'shelf'
        ? b.y0
        : b.y0 + H * (0.28 + (0.55 * i) / Math.max(1, shelves));
      const sy0 = Math.min(b.y1 - st, y0);
      shelfYs.push(sy0);
      prims.push(boxPrim({ x0: sx0, x1: sx1, y0: sy0, y1: sy0 + st, z0: plateZ1, z1: b.z1 }, boardMat));
    }
  }

  // 후크 (0~6)
  if (hooks > 0) {
    const hookZ1 = shelves > 0 ? Math.min(b.z1, plateZ1 + Math.max(0.025, (b.z1 - plateZ1) * 0.45)) : b.z1;
    const hookY = shelfYs.length ? Math.max(b.y0 + 0.06, shelfYs[0] * 0.5 + b.y0 * 0.5) : b.y0 + H * 0.25;
    const span = Math.max(0.06, W - 0.1);
    for (let i = 0; i < hooks; i++) {
      const hx = hooks === 1 ? cx : b.x0 + 0.05 + (span * i) / (hooks - 1);
      prims.push(boxPrim({ x0: hx - 0.006, x1: hx + 0.006, y0: hookY, y1: hookY + 0.012, z0: plateZ1, z1: hookZ1 }, accMat));
      prims.push(boxPrim({ x0: hx - 0.006, x1: hx + 0.006, y0: hookY + 0.012, y1: hookY + 0.03, z0: Math.max(plateZ1, hookZ1 - 0.01), z1: hookZ1 }, accMat));
    }
  }

  // 타공 격자 (간격 0.05, 최대 12×10, 모듈 총 부품 ≤ 40 준수)
  if (showHoles && D > plateT + 0.002) {
    const step = 0.05;
    const cols = Math.min(12, Math.max(0, Math.floor((W - 0.08) / step) + 1));
    const rows = Math.min(10, Math.max(0, Math.floor((H - 0.08) / step) + 1));
    const budget = Math.max(0, 40 - prims.length);
    if (cols > 0 && rows > 0 && budget > 0) {
      let stride = 1;
      while (Math.ceil(cols / stride) * Math.ceil(rows / stride) > budget) stride++;
      const ox = cx - ((cols - 1) * step) / 2;
      const oy = cy - ((rows - 1) * step) / 2;
      const hz1 = Math.min(b.z1, plateZ1 + holeD);
      for (let r = 0; r < rows; r += stride) {
        const hy = oy + r * step;
        for (let col = 0; col < cols; col += stride) {
          const hx = ox + col * step;
          prims.push(boxPrim({ x0: hx - 0.006, x1: hx + 0.006, y0: hy - 0.006, y1: hy + 0.006, z0: plateZ1, z1: hz1 }, holeMat));
        }
      }
    }
  }

  return { prims, topY: b.y1 };
});
