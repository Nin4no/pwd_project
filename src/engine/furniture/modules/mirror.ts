/**
 * mirror — 전신거울/벽걸이 거울
 * params: stand(true: 받침대 / false: 벽걸이 — mount 'wall' 사용), arch(false)
 */
import type { ProceduralPrimitive } from '../../../domain/types';
import { boxD, boxH, boxW } from '../blueprint';
import { boxPrim, registerModule } from '../assemble';

registerModule('mirror', (b, m, c) => {
  const W = boxW(b), D = boxD(b), H = boxH(b);
  const cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2;
  const stand = c.bool('stand', true);
  const arch = c.bool('arch', false);
  const frameMat = c.mat(m.material);
  const mirrorMat = c.mat('mirror');
  const accMat = c.mat(m.accent ?? (c.accent !== c.main ? c.accent : undefined));
  const prims: ProceduralPrimitive[] = [];

  const frameW = Math.min(0.032, W * 0.08);
  const panelD = stand ? Math.min(0.04, D * 0.25) : D;
  const panelZ0 = stand ? cz - panelD / 2 : b.z0;
  const panelZ1 = panelZ0 + panelD;
  const backD = panelD * 0.45;
  const glassZ0 = panelZ0 + backD;

  let bodyY0 = b.y0;
  if (stand) {
    const baseH = Math.min(0.03, H * 0.03);
    const footW = Math.min(0.045, W * 0.12);
    const xL = b.x0 + Math.min(0.06, W * 0.14);
    const xR = b.x1 - Math.min(0.06, W * 0.14) - footW;
    prims.push(boxPrim({ x0: xL, x1: xL + footW, y0: b.y0, y1: b.y0 + baseH, z0: b.z0, z1: b.z1 }, accMat));
    prims.push(boxPrim({ x0: xR, x1: xR + footW, y0: b.y0, y1: b.y0 + baseH, z0: b.z0, z1: b.z1 }, accMat));
    prims.push(boxPrim({ x0: xL + footW, x1: xR, y0: b.y0, y1: b.y0 + baseH, z0: panelZ0, z1: panelZ1 }, accMat));
    bodyY0 = b.y0 + baseH;
  }

  const bodyH = b.y1 - bodyY0;
  const archR = arch ? Math.min(W / 2, bodyH * 0.35) : 0;
  const rectY1 = b.y1 - archR;

  // 직사각 하부 프레임 + 거울면
  prims.push(boxPrim({ x0: b.x0, x1: b.x1, y0: bodyY0, y1: rectY1, z0: panelZ0, z1: glassZ0 }, frameMat));
  prims.push(boxPrim({ x0: b.x0, x1: b.x0 + frameW, y0: bodyY0, y1: rectY1, z0: glassZ0, z1: panelZ1 }, frameMat));
  prims.push(boxPrim({ x0: b.x1 - frameW, x1: b.x1, y0: bodyY0, y1: rectY1, z0: glassZ0, z1: panelZ1 }, frameMat));
  prims.push(boxPrim({ x0: b.x0 + frameW, x1: b.x1 - frameW, y0: bodyY0, y1: bodyY0 + frameW, z0: glassZ0, z1: panelZ1 }, frameMat));
  if (!arch) {
    prims.push(boxPrim({ x0: b.x0 + frameW, x1: b.x1 - frameW, y0: rectY1 - frameW, y1: rectY1, z0: glassZ0, z1: panelZ1 }, frameMat));
  }
  const glassY1 = arch ? rectY1 : rectY1 - frameW;
  prims.push(boxPrim({ x0: b.x0 + frameW, x1: b.x1 - frameW, y0: bodyY0 + frameW, y1: glassY1, z0: glassZ0, z1: panelZ1 }, mirrorMat));

  // 아치 상단 (수평 슬라이스 근사)
  if (arch && archR > frameW) {
    const slices = 5;
    const sh = archR / slices;
    const innerR = archR - frameW;
    for (let i = 0; i < slices; i++) {
      const sy0 = rectY1 + i * sh;
      const sy1 = sy0 + sh;
      const dy = (i + 0.5) * sh;
      const halfF = Math.sqrt(Math.max(0, archR * archR - dy * dy));
      prims.push(boxPrim({ x0: cx - halfF, x1: cx + halfF, y0: sy0, y1: sy1, z0: panelZ0, z1: glassZ0 }, frameMat));
      if (dy < innerR) {
        const halfG = Math.sqrt(Math.max(0, innerR * innerR - dy * dy));
        prims.push(boxPrim({ x0: cx - halfG, x1: cx + halfG, y0: sy0, y1: sy1, z0: glassZ0, z1: panelZ1 }, mirrorMat));
      }
    }
  }

  return { prims, topY: b.y1 };
});
