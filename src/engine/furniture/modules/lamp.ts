/**
 * lamp — 플로어/데스크 램프 (shade 원기둥 + 기둥 + 받침)
 * params: style('floor'|'desk')
 */
import type { ProceduralPrimitive } from '../../../domain/types';
import { boxD, boxH, boxW } from '../blueprint';
import { cylPrim, registerModule } from '../assemble';

registerModule('lamp', (b, m, c) => {
  const W = boxW(b), D = boxD(b), H = boxH(b);
  const cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2;
  const style = c.str('style', H >= 0.9 ? 'floor' : 'desk');
  const shadeMat = c.mat(m.material);
  const poleMat = c.mat(m.accent ?? (c.accent !== c.main ? c.accent : 'steel_black'));

  const maxR = Math.min(W, D) / 2;
  const baseH = style === 'floor' ? Math.min(0.03, H * 0.04) : Math.min(0.024, H * 0.08);
  const baseR = maxR * 0.85;
  const poleR = Math.min(style === 'floor' ? 0.015 : 0.01, maxR * 0.14);
  const shadeH = style === 'floor' ? Math.min(0.28, H * 0.22) : Math.min(0.16, H * 0.38);
  const shadeY0 = b.y1 - shadeH;

  const prims: ProceduralPrimitive[] = [
    cylPrim(cx, cz, b.y0, b.y0 + baseH, baseR, poleMat),
    cylPrim(cx, cz, b.y0 + baseH, shadeY0 + shadeH * 0.35, poleR, poleMat),
    cylPrim(cx, cz, shadeY0 + shadeH * 0.2, shadeY0 + shadeH * 0.45, Math.min(0.035, maxR * 0.28), c.mat('led')),
    cylPrim(cx, cz, shadeY0, b.y1, maxR, shadeMat, maxR * 0.62),
  ];

  return { prims, topY: b.y1 };
});
