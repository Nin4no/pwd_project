/**
 * seat — 좌석(소파·의자·벤치·스툴)
 * params: style('sofa'|'chair'|'bench'|'stool'), back(true; stool·bench 기본 false),
 *         arms(sofa 기본 true), seats(sofa 좌방석 수 1~3), legs('four'|'base')
 */
import type { ProceduralPrimitive } from '../../../domain/types';
import { boxD, boxH, boxW } from '../blueprint';
import { boxPrim, cylPrim, registerModule } from '../assemble';

registerModule('seat', (b, m, c) => {
  const W = boxW(b), D = boxD(b), H = boxH(b);
  const cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2;
  const style = c.str('style', W >= 1.1 ? 'sofa' : 'chair');
  const back = c.bool('back', style !== 'stool' && style !== 'bench');
  const arms = c.bool('arms', style === 'sofa');
  const legs = c.str('legs', 'four');
  const seats = Math.max(1, Math.min(3, Math.round(c.num('seats', style === 'sofa' ? Math.max(1, Math.min(3, Math.round(W / 0.65))) : 1))));

  const cushion = c.mat(m.material);
  const legMat = c.mat(c.accent);
  const prims: ProceduralPrimitive[] = [];

  if (style === 'stool' && !back) {
    const seatH = Math.min(0.08, Math.max(0.04, H * 0.12));
    const seatY0 = b.y1 - seatH;
    if (Math.abs(W - D) < 0.03) {
      prims.push(cylPrim(cx, cz, seatY0, b.y1, Math.min(W, D) / 2, cushion));
    } else {
      prims.push(boxPrim({ x0: b.x0, x1: b.x1, y0: seatY0, y1: b.y1, z0: b.z0, z1: b.z1 }, cushion));
    }
    if (legs === 'base') {
      const baseR = Math.min(W, D) * 0.45;
      prims.push(cylPrim(cx, cz, b.y0, b.y0 + 0.025, baseR, legMat));
      prims.push(cylPrim(cx, cz, b.y0 + 0.025, seatY0, Math.min(0.03, baseR * 0.2), legMat));
      const footY = b.y0 + H * 0.28;
      if (footY < seatY0 - 0.05) {
        prims.push(boxPrim({ x0: cx - baseR * 0.7, x1: cx + baseR * 0.7, y0: footY - 0.01, y1: footY + 0.01, z0: cz - 0.01, z1: cz + 0.01 }, legMat));
      }
    } else {
      const ls = Math.min(0.035, W * 0.12, D * 0.12);
      const inset = Math.min(0.04, W * 0.14);
      const xL = b.x0 + inset, xR = b.x1 - inset - ls;
      const zB = b.z0 + inset, zF = b.z1 - inset - ls;
      for (const x0 of [xL, xR]) for (const z0 of [zB, zF]) {
        prims.push(boxPrim({ x0, x1: x0 + ls, y0: b.y0, y1: seatY0, z0, z1: z0 + ls }, legMat));
      }
      const footY = b.y0 + H * 0.28;
      if (footY < seatY0 - 0.05) {
        prims.push(boxPrim({ x0: xL + ls, x1: xR, y0: footY, y1: footY + 0.018, z0: zF, z1: zF + ls }, legMat));
        prims.push(boxPrim({ x0: xL + ls, x1: xR, y0: footY, y1: footY + 0.018, z0: zB, z1: zB + ls }, legMat));
        prims.push(boxPrim({ x0: xL, x1: xL + ls, y0: footY, y1: footY + 0.018, z0: zB + ls, z1: zF }, legMat));
        prims.push(boxPrim({ x0: xR, x1: xR + ls, y0: footY, y1: footY + 0.018, z0: zB + ls, z1: zF }, legMat));
      }
    }
    return { prims, topY: b.y1 };
  }

  const seatY1 = back
    ? b.y0 + Math.min(0.46, Math.max(0.22, H * (style === 'sofa' ? 0.52 : 0.48)))
    : b.y1;
  const legH = legs === 'base'
    ? Math.min(style === 'chair' ? 0.22 : 0.05, (seatY1 - b.y0) * 0.55)
    : style === 'sofa'
      ? Math.min(0.14, (seatY1 - b.y0) * 0.35)
      : Math.max(0.16, seatY1 - b.y0 - 0.08);
  const deckY0 = b.y0 + legH;
  const cushionH = style === 'sofa'
    ? Math.min(0.14, (seatY1 - deckY0) * 0.55)
    : Math.min(0.07, Math.max(0.035, (seatY1 - deckY0) * 0.8));
  const seatY0 = Math.max(deckY0, seatY1 - cushionH);
  const armW = arms ? Math.min(0.16, Math.max(0.05, W * 0.085)) : 0;
  const backD = back ? Math.min(0.18, Math.max(0.06, D * 0.18)) : 0;

  // 다리 / 하부 받침
  if (legs === 'base') {
    if (style === 'chair') {
      const r = Math.min(W, D) * 0.42;
      prims.push(cylPrim(cx, cz, b.y0, b.y0 + 0.025, r, legMat));
      prims.push(cylPrim(cx, cz, b.y0 + 0.025, deckY0, Math.min(0.03, r * 0.2), legMat));
    } else {
      prims.push(boxPrim({ x0: b.x0 + 0.04, x1: b.x1 - 0.04, y0: b.y0, y1: deckY0, z0: b.z0 + 0.04, z1: b.z1 - 0.04 }, legMat));
    }
  } else {
    const ls = style === 'sofa' ? 0.05 : 0.038;
    const inset = 0.03;
    for (const x0 of [b.x0 + inset, b.x1 - inset - ls]) {
      for (const z0 of [b.z0 + inset, b.z1 - inset - ls]) {
        prims.push(boxPrim({ x0, x1: x0 + ls, y0: b.y0, y1: deckY0, z0, z1: z0 + ls }, legMat));
      }
    }
  }

  // 하부 프레임(seat deck)
  const innerX0 = b.x0 + armW, innerX1 = b.x1 - armW;
  const seatZ0 = b.z0 + backD;
  if (seatY0 > deckY0 + 0.004) {
    prims.push(boxPrim({ x0: innerX0, x1: innerX1, y0: deckY0, y1: seatY0, z0: seatZ0, z1: b.z1 }, cushion));
  } else {
    prims.push(boxPrim({ x0: b.x0 + 0.02, x1: b.x1 - 0.02, y0: deckY0, y1: deckY0 + 0.02, z0: b.z0 + 0.02, z1: b.z1 - 0.02 }, legMat));
  }

  // 등받이
  if (back) {
    prims.push(boxPrim({ x0: b.x0, x1: b.x1, y0: deckY0, y1: b.y1, z0: b.z0, z1: seatZ0 }, cushion));
  }

  // 팔걸이
  if (arms) {
    const armY1 = back ? seatY1 + Math.min(0.22, (b.y1 - seatY1) * 0.55) : seatY1 + 0.15;
    prims.push(boxPrim({ x0: b.x0, x1: innerX0, y0: deckY0, y1: armY1, z0: seatZ0, z1: b.z1 }, cushion));
    prims.push(boxPrim({ x0: innerX1, x1: b.x1, y0: deckY0, y1: armY1, z0: seatZ0, z1: b.z1 }, cushion));
  }

  // 좌방석 (1~3 분할)
  const count = style === 'sofa' ? seats : 1;
  const gap = count > 1 ? 0.005 : 0;
  const cw = (innerX1 - innerX0 - gap * (count - 1)) / count;
  for (let i = 0; i < count; i++) {
    const x0 = innerX0 + i * (cw + gap);
    prims.push(boxPrim({ x0, x1: x0 + cw, y0: seatY0, y1: seatY1, z0: seatZ0, z1: b.z1 }, cushion));
    if (style === 'sofa' && back) {
      const bcD = Math.min(0.09, (b.z1 - seatZ0) * 0.16);
      prims.push(boxPrim({ x0: x0 + 0.004, x1: x0 + cw - 0.004, y0: seatY1, y1: b.y1 - 0.02, z0: seatZ0, z1: seatZ0 + bcD }, cushion));
    }
  }

  return { prims, topY: b.y1 };
});
