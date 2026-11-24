/**
 * appliance — 가전 모듈 (src/data/appliances.ts 생성기 위임)
 * params: kind('fridge'|'fridge1'|'minifridge'|'washer'|'toploader'|'dryer'|'tv'|'tvstand'|'aircon'|'purifier'|'styler')
 */
import type { ProceduralPrimitive } from '../../../domain/types';
import {
  airPurifier, clothesCare, drum, fridge, miniFridge,
  standAircon, topLoader, tvFloorStand, tvWithCabinet,
} from '../../../data/appliances';
import { boxD, boxH, boxW } from '../blueprint';
import { r3, registerModule } from '../assemble';

registerModule('appliance', (b, m, c) => {
  const w = boxW(b), d = boxD(b), h = boxH(b);
  const cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2;
  const kind = c.str('kind', 'fridge');
  const body = c.mat(m.material).color;

  let raw: ProceduralPrimitive[];
  switch (kind) {
    case 'fridge1': raw = fridge(w, d, h, body, true); break;
    case 'minifridge': raw = miniFridge(w, d, h, body); break;
    case 'washer': raw = drum(w, d, h, body, '#334155'); break;
    case 'toploader': raw = topLoader(w, d, h, body); break;
    case 'dryer': raw = drum(w, d, h, body, '#111827'); break;
    case 'tv': raw = tvWithCabinet(w, d, body); break;
    case 'tvstand': raw = tvFloorStand(w, h, body); break;
    case 'aircon': raw = standAircon(w, d, h, body); break;
    case 'purifier': raw = airPurifier(w, h, body); break;
    case 'styler': raw = clothesCare(w, d, h, body); break;
    case 'fridge':
    default:
      raw = fridge(w, d, h, body, false);
      break;
  }

  const prims = raw.map((p) => ({
    ...p,
    pos: [r3(p.pos[0] + cx), r3(p.pos[1] + b.y0), r3(p.pos[2] + cz)] as [number, number, number],
  }));
  const topY = prims.reduce(
    (maxY, p) => Math.max(maxY, p.pos[1] + (p.kind === 'box' ? p.size[1] / 2 : p.height / 2)),
    b.y0,
  );
  return { prims, topY: r3(topY) };
});
