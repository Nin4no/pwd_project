/**
 * rack — 기둥 4(accent 스틸) + 선반판
 * params: shelves(기본 4)
 */
import type { ProceduralPrimitive } from '../../../domain/types';
import { boxD, boxH, boxW } from '../blueprint';
import { boxPrim, registerModule } from '../assemble';

registerModule('rack', (b, m, c) => {
  const W = boxW(b), D = boxD(b), H = boxH(b);
  const shelfMat = c.mat(m.material);
  const postMat = c.mat(m.accent ?? (c.accent !== c.main ? c.accent : 'steel_black'));
  const shelves = Math.max(1, Math.min(12, Math.round(c.num('shelves', 4))));
  const post = Math.min(0.035, W * 0.06, D * 0.06);
  const st = Math.min(0.022, H * 0.05);
  const prims: ProceduralPrimitive[] = [];

  for (const x0 of [b.x0, b.x1 - post]) {
    for (const z0 of [b.z0, b.z1 - post]) {
      prims.push(boxPrim({ x0, x1: x0 + post, y0: b.y0, y1: b.y1, z0, z1: z0 + post }, postMat));
    }
  }

  const lowY0 = b.y0 + Math.min(0.08, H * 0.06);
  const topY0 = b.y1 - st;
  for (let i = 0; i < shelves; i++) {
    const y0 = shelves === 1 ? topY0 : lowY0 + ((topY0 - lowY0) * i) / (shelves - 1);
    prims.push(boxPrim({ x0: b.x0, x1: b.x1, y0, y1: y0 + st, z0: b.z0, z1: b.z1 }, shelfMat));
  }

  return { prims, topY: b.y1 };
});
