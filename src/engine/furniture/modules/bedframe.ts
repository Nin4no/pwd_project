/**
 * bedframe — 침대 프레임 + 매트리스 (+헤드보드, 하부 서랍, 2층 침대)
 * params: headboard(true), legs('low'|'four'|'platform'), drawers(0~4), bunk(false)
 */
import type { ProceduralPrimitive } from '../../../domain/types';
import { boxD, boxH, boxW } from '../blueprint';
import { boxPrim, registerModule } from '../assemble';

registerModule('bedframe', (b, m, c) => {
  const W = boxW(b), D = boxD(b), H = boxH(b);
  const frameMat = c.mat(m.material);
  const accMat = c.mat(m.accent ?? (c.accent !== c.main ? c.accent : undefined));
  const hwMat = c.mat('steel');
  const matMat = c.mat('mattress');
  const headboard = c.bool('headboard', true);
  const legs = c.str('legs', 'four');
  const drawers = Math.max(0, Math.min(4, Math.round(c.num('drawers', 0))));
  const bunk = c.bool('bunk', false);
  const prims: ProceduralPrimitive[] = [];

  if (bunk) {
    const post = Math.min(0.055, W * 0.06, D * 0.04);
    for (const x0 of [b.x0, b.x1 - post]) {
      for (const z0 of [b.z0, b.z1 - post]) {
        prims.push(boxPrim({ x0, x1: x0 + post, y0: b.y0, y1: b.y1, z0, z1: z0 + post }, frameMat));
      }
    }
    const lowY0 = b.y0 + Math.min(0.22, H * 0.13);
    const lowY1 = lowY0 + 0.09;
    const matH = Math.min(0.16, H * 0.095);
    const lowMatY1 = lowY1 + matH;
    prims.push(boxPrim({ x0: b.x0, x1: b.x1, y0: lowY0, y1: lowY1, z0: b.z0 + post, z1: b.z1 - post }, frameMat));
    prims.push(boxPrim({ x0: b.x0 + post * 0.5, x1: b.x1 - post * 0.5, y0: lowY1, y1: lowMatY1, z0: b.z0 + post, z1: b.z1 - post }, matMat));

    if (drawers > 0) {
      const spanZ = D - post * 2 - 0.08;
      const slot = spanZ / drawers;
      prims.push(boxPrim({ x0: b.x0 + post, x1: b.x1 - 0.035, y0: b.y0 + 0.02, y1: lowY0, z0: b.z0 + post, z1: b.z1 - post }, accMat));
      for (let i = 0; i < drawers; i++) {
        const dz0 = b.z0 + post + 0.04 + i * slot;
        prims.push(boxPrim({ x0: b.x1 - 0.035, x1: b.x1 - 0.015, y0: b.y0 + 0.025, y1: lowY0 - 0.01, z0: dz0 + 0.01, z1: dz0 + slot - 0.01 }, frameMat));
        prims.push(boxPrim({ x0: b.x1 - 0.015, x1: b.x1, y0: (b.y0 + 0.02 + lowY0) / 2 - 0.006, y1: (b.y0 + 0.02 + lowY0) / 2 + 0.006, z0: dz0 + slot / 2 - 0.05, z1: dz0 + slot / 2 + 0.05 }, hwMat));
      }
    }

    const upY0 = b.y0 + H * 0.60;
    const upY1 = upY0 + 0.09;
    const upMatY1 = upY1 + matH;
    prims.push(boxPrim({ x0: b.x0, x1: b.x1, y0: upY0, y1: upY1, z0: b.z0 + post, z1: b.z1 - post }, frameMat));
    prims.push(boxPrim({ x0: b.x0 + post * 0.5, x1: b.x1 - post * 0.5, y0: upY1, y1: upMatY1, z0: b.z0 + post, z1: b.z1 - post }, matMat));

    // 난간 (상단 2층)
    const guardTop = Math.min(b.y1 - 0.02, upMatY1 + 0.24);
    const railH = 0.03;
    const railT = 0.025;
    // 벽쪽(-x) 2줄 난간
    prims.push(boxPrim({ x0: b.x0, x1: b.x0 + railT, y0: guardTop - railH, y1: guardTop, z0: b.z0 + post, z1: b.z1 - post }, frameMat));
    prims.push(boxPrim({ x0: b.x0, x1: b.x0 + railT, y0: upMatY1 + 0.07, y1: upMatY1 + 0.10, z0: b.z0 + post, z1: b.z1 - post }, frameMat));
    // 머리/발쪽(z0, z1) 난간
    prims.push(boxPrim({ x0: b.x0 + post, x1: b.x1 - post, y0: guardTop - railH, y1: guardTop, z0: b.z0, z1: b.z0 + railT }, frameMat));
    prims.push(boxPrim({ x0: b.x0 + post, x1: b.x1 - post, y0: guardTop - railH, y1: guardTop, z0: b.z1 - railT, z1: b.z1 }, frameMat));
    // 입구쪽(+x) 부분 난간 + 수직 지지대
    const ladZ0 = b.z1 - post - Math.min(0.42, D * 0.22);
    prims.push(boxPrim({ x0: b.x1 - railT, x1: b.x1, y0: guardTop - railH, y1: guardTop, z0: b.z0 + post, z1: ladZ0 }, frameMat));
    prims.push(boxPrim({ x0: b.x1 - railT, x1: b.x1, y0: upY1, y1: guardTop, z0: ladZ0 - 0.025, z1: ladZ0 }, frameMat));

    // 사다리 (+x 발쪽)
    const stileW = 0.028;
    const ladZ1 = b.z1 - post - 0.02;
    const ladX0 = b.x1 - 0.035;
    prims.push(boxPrim({ x0: ladX0, x1: b.x1, y0: b.y0, y1: guardTop, z0: ladZ0, z1: ladZ0 + stileW }, frameMat));
    prims.push(boxPrim({ x0: ladX0, x1: b.x1, y0: b.y0, y1: guardTop, z0: ladZ1 - stileW, z1: ladZ1 }, frameMat));
    const rungs = 4;
    for (let i = 0; i < rungs; i++) {
      const ry = b.y0 + 0.26 + ((upY1 - 0.12 - (b.y0 + 0.26)) * i) / (rungs - 1);
      prims.push(boxPrim({ x0: ladX0 + 0.005, x1: b.x1, y0: ry, y1: ry + 0.022, z0: ladZ0 + stileW, z1: ladZ1 - stileW }, frameMat));
    }
    return { prims, topY: upMatY1 };
  }

  // 단층 침대
  const headD = headboard ? Math.min(0.07, D * 0.05) : 0;
  const matTop = headboard ? b.y0 + Math.min(0.5, Math.max(0.24, H * 0.48)) : b.y1;
  const matH = Math.min(0.22, Math.max(0.10, (matTop - b.y0) * 0.42));
  const frameTop = matTop - matH;
  const legH = drawers > 0 || legs === 'platform'
    ? Math.min(0.04, (frameTop - b.y0) * 0.22)
    : legs === 'low'
      ? Math.min(0.05, (frameTop - b.y0) * 0.28)
      : Math.min(0.16, Math.max(0.05, (frameTop - b.y0) * 0.55));
  const frameY0 = b.y0 + legH;
  const frameZ0 = b.z0 + headD;

  const rightDrawers = drawers <= 2 ? drawers : Math.ceil(drawers / 2);
  const leftDrawers = drawers <= 2 ? 0 : Math.floor(drawers / 2);
  const baseX0 = leftDrawers > 0 ? b.x0 + 0.035 : b.x0;
  const baseX1 = rightDrawers > 0 ? b.x1 - 0.035 : b.x1;

  if (headboard) {
    prims.push(boxPrim({ x0: b.x0, x1: b.x1, y0: b.y0, y1: b.y1, z0: b.z0, z1: frameZ0 }, frameMat));
  }
  prims.push(boxPrim({ x0: baseX0, x1: baseX1, y0: frameY0, y1: frameTop, z0: frameZ0, z1: b.z1 }, frameMat));

  if (legs === 'platform' || drawers > 0) {
    prims.push(boxPrim({ x0: baseX0 + 0.03, x1: baseX1 - 0.03, y0: b.y0, y1: frameY0, z0: frameZ0 + 0.03, z1: b.z1 - 0.03 }, accMat));
  } else {
    const ls = 0.05;
    const zMin = headboard ? frameZ0 + 0.02 : b.z0 + 0.02;
    for (const x0 of [baseX0 + 0.02, baseX1 - 0.02 - ls]) {
      for (const z0 of [zMin, b.z1 - 0.02 - ls]) {
        prims.push(boxPrim({ x0, x1: x0 + ls, y0: b.y0, y1: frameY0, z0, z1: z0 + ls }, accMat));
      }
    }
  }

  const addSideDrawers = (count: number, isRight: boolean) => {
    if (count <= 0) return;
    const spanZ = Math.max(0.2, b.z1 - frameZ0 - 0.16);
    const slot = spanZ / count;
    const cy = (frameY0 + frameTop) / 2;
    for (let i = 0; i < count; i++) {
      const dz0 = frameZ0 + 0.08 + i * slot;
      const fx0 = isRight ? baseX1 : baseX0 - 0.02;
      const fx1 = isRight ? baseX1 + 0.02 : baseX0;
      const hx0 = isRight ? baseX1 + 0.02 : b.x0;
      const hx1 = isRight ? b.x1 : baseX0 - 0.02;
      prims.push(boxPrim({ x0: fx0, x1: fx1, y0: frameY0 + 0.008, y1: frameTop - 0.008, z0: dz0 + 0.008, z1: dz0 + slot - 0.008 }, frameMat));
      prims.push(boxPrim({ x0: hx0, x1: hx1, y0: cy - 0.006, y1: cy + 0.006, z0: dz0 + slot / 2 - 0.055, z1: dz0 + slot / 2 + 0.055 }, hwMat));
    }
  };
  addSideDrawers(rightDrawers, true);
  addSideDrawers(leftDrawers, false);

  const mInset = headboard ? 0.012 : 0;
  prims.push(boxPrim({ x0: b.x0 + mInset, x1: b.x1 - mInset, y0: frameTop, y1: matTop, z0: frameZ0, z1: b.z1 - mInset }, matMat));

  return { prims, topY: matTop };
});
