import type { FurnitureSpec, PrimMat, ProceduralPrimitive } from '../domain/types';

/**
 * 가전제품 카탈로그 — 절차적 프리미티브로 형상 정의.
 * 좌표: 원점 = 바닥 중심, 앞면 = +Z, box pos = 중심, box size = [w, h, d], 원기둥 축 = Y.
 */
type V3 = [number, number, number];
type Opt = Partial<PrimMat> & { radiusTop?: number; segments?: number };

const box = (size: V3, pos: V3, color: string, o: Opt = {}): ProceduralPrimitive =>
  ({ kind: 'box', size, pos, color, roughness: 0.5, ...o });
const cyl = (radius: number, height: number, pos: V3, color: string, o: Opt = {}): ProceduralPrimitive =>
  ({ kind: 'cylinder', radius, height, pos, color, roughness: 0.5, ...o });

/** XY 평면 원판(앞을 향함) — 회전 미지원이므로 가로 슬라이스로 근사 */
function disc(r: number, cx: number, cy: number, z: number, depth: number, color: string, o: Opt = {}, n = 9): ProceduralPrimitive[] {
  const sh = (2 * r) / n;
  return Array.from({ length: n }, (_, i) => {
    const y = -r + sh * (i + 0.5);
    const half = Math.sqrt(Math.max(r * r - y * y, 0));
    return box([half * 2, sh, depth], [cx, cy + y, z], color, o);
  });
}

const WHITE = '#f4f4f5';
const DARK = '#1f2328';
const METAL = '#c7cbd1';
const SCREEN = '#0b1220';

/** 냉장고 (2도어 양문형 / 1도어 단문형) */
export function fridge(w: number, d: number, h: number, body: string, singleDoor: boolean, doorColor = body): ProceduralPrimitive[] {
  const plinth = 0.05;
  const bodyD = d - 0.06;
  const front = -0.03 + bodyD / 2; // 본체 앞면 z
  const doorD = 0.04;
  const zDoor = front + doorD / 2;
  const dh = h - plinth - 0.01;
  const yDoor = plinth + 0.005 + dh / 2;
  const handle = (x: number, len: number) =>
    box([0.018, len, 0.025], [x, plinth + dh * 0.55, front + doorD + 0.0125], METAL, { metalness: 0.8, roughness: 0.25 });
  const p: ProceduralPrimitive[] = [
    box([w - 0.04, plinth, bodyD - 0.04], [0, plinth / 2, -0.03], DARK),
    box([w, h - plinth, bodyD], [0, plinth + (h - plinth) / 2, -0.03], body, { metalness: 0.2 }),
  ];
  if (singleDoor) {
    p.push(box([w - 0.006, dh, doorD], [0, yDoor, zDoor], doorColor, { metalness: 0.25, roughness: 0.35 }));
    p.push(handle(w / 2 - 0.045, 0.6));
    return p;
  }
  const doorW = w / 2 - 0.004;
  for (const s of [-1, 1]) {
    p.push(box([doorW, dh, doorD], [s * (w / 4 + 0.002), yDoor, zDoor], doorColor, { metalness: 0.25, roughness: 0.35 }));
    p.push(handle(s * 0.035, 0.7));
  }
  p.push(box([0.16, 0.24, 0.006], [-w / 4, plinth + dh * 0.72, front + doorD + 0.003], SCREEN, { emissive: '#1e3a5f', roughness: 0.1 }));
  return p;
}

export function miniFridge(w: number, d: number, h: number, body = '#ecebe8', doorColor = '#f5f5f4'): ProceduralPrimitive[] {
  const bodyD = d - 0.04;
  const front = -0.02 + bodyD / 2;
  return [
    box([w, h - 0.03, bodyD], [0, 0.03 + (h - 0.03) / 2, -0.02], body),
    ...[-1, 1].flatMap((sx) => [-1, 1].map((sz) =>
      box([0.03, 0.03, 0.03], [sx * (w / 2 - 0.04), 0.015, sz * (bodyD / 2 - 0.04) - 0.02], DARK))),
    box([w - 0.006, h - 0.04, 0.035], [0, 0.035 + (h - 0.04) / 2, front + 0.0175], doorColor, { roughness: 0.35 }),
    box([0.018, 0.22, 0.022], [w / 2 - 0.05, h * 0.62, front + 0.035 + 0.011], METAL, { metalness: 0.8, roughness: 0.25 }),
  ];
}

/** 드럼세탁기 / 건조기 (전면 원형 도어) */
export function drum(w: number, d: number, h: number, body: string, door: string): ProceduralPrimitive[] {
  const bodyD = d - 0.03;
  const front = bodyD / 2 - 0.015;
  const cy = h * 0.47;
  return [
    box([w, h - 0.02, bodyD], [0, 0.02 + (h - 0.02) / 2, -0.015], body),
    box([w - 0.05, 0.02, bodyD - 0.05], [0, 0.01, -0.015], DARK),
    box([w - 0.02, 0.1, 0.012], [0, h - 0.07, front + 0.006], '#e4e4e7', { roughness: 0.3 }),
    box([0.12, 0.05, 0.006], [w * 0.12, h - 0.07, front + 0.015], SCREEN, { emissive: '#14324f', roughness: 0.1 }),
    cyl(0.03, 0.03, [-w * 0.3, h - 0.06, front - 0.004], METAL, { metalness: 0.7, roughness: 0.3 }),
    ...disc(0.21, 0, cy, front + 0.012, 0.024, METAL, { metalness: 0.7, roughness: 0.25 }),
    ...disc(0.165, 0, cy, front + 0.026, 0.008, door, { roughness: 0.08, metalness: 0.2, alpha: 0.85 }),
    box([w - 0.06, 0.06, 0.008], [0, 0.07, front + 0.004], '#e4e4e7'),
  ];
}

/** 통돌이 세탁기 (상부 도어 + 뒤쪽 컨트롤 패널) */
export function topLoader(w: number, d: number, h: number, body = WHITE, doorColor = '#94a3b8'): ProceduralPrimitive[] {
  const bodyH = h - 0.12;
  return [
    box([w, bodyH, d - 0.02], [0, bodyH / 2, 0], body),
    box([w, 0.12, 0.14], [0, bodyH + 0.06, -d / 2 + 0.08], '#e4e4e7'),
    box([0.18, 0.05, 0.006], [0, bodyH + 0.07, -d / 2 + 0.153], SCREEN, { emissive: '#14324f', roughness: 0.1 }),
    box([w - 0.06, 0.02, d - 0.2], [0, bodyH + 0.01, 0.06], doorColor, { alpha: 0.75, roughness: 0.1, metalness: 0.1 }),
    box([0.16, 0.02, 0.03], [0, bodyH + 0.02, d / 2 - 0.06], DARK),
  ];
}

/** TV 패널 (베젤 + 화면) — bottom = 패널 하단 높이, z = 패널 중심 z */
export function tvPanel(pw: number, ph: number, bottom: number, z: number): ProceduralPrimitive[] {
  return [
    box([pw, ph, 0.04], [0, bottom + ph / 2, z], '#111214', { roughness: 0.3, metalness: 0.3 }),
    box([pw - 0.02, ph - 0.02, 0.004], [0, bottom + ph / 2, z + 0.022], SCREEN, { roughness: 0.05, emissive: '#0b1a33' }),
  ];
}

export function tvWithCabinet(w: number, d: number, cabColor = '#cfb592'): ProceduralPrimitive[] {
  const cabH = 0.42;
  const pw = 1.23;
  const ph = 0.71;
  return [
    box([w, cabH - 0.06, d], [0, 0.06 + (cabH - 0.06) / 2, 0], cabColor, { roughness: 0.6 }),
    ...[-1, 1].map((s) => box([0.05, 0.06, d - 0.06], [s * (w / 2 - 0.08), 0.03, 0], DARK)),
    box([w * 0.48, 0.003, 0.004], [-w / 4, cabH * 0.6, d / 2 + 0.002], '#a58c6c'),
    box([w * 0.48, 0.003, 0.004], [w / 4, cabH * 0.6, d / 2 + 0.002], '#a58c6c'),
    box([0.36, 0.015, 0.22], [0, cabH + 0.0075, -0.02], '#2a2d31', { metalness: 0.6, roughness: 0.3 }),
    box([0.06, 0.07, 0.03], [0, cabH + 0.05, -0.05], '#2a2d31', { metalness: 0.6, roughness: 0.3 }),
    ...tvPanel(pw, ph, cabH + 0.08, -0.04),
  ];
}

export function tvFloorStand(w: number, h: number, standColor = '#3b3f45'): ProceduralPrimitive[] {
  const ph = w * 0.57;
  const bottom = h - ph;
  return [
    box([0.62, 0.025, 0.46], [0, 0.0125, 0], '#2a2d31', { metalness: 0.6, roughness: 0.3 }),
    box([0.06, h - 0.1, 0.06], [0, 0.025 + (h - 0.1) / 2, -0.12], standColor, { metalness: 0.6, roughness: 0.3 }),
    ...tvPanel(w, ph, bottom, -0.07),
  ];
}

export function standAircon(w: number, d: number, h: number, body = WHITE): ProceduralPrimitive[] {
  const front = d / 2 - 0.02;
  const p: ProceduralPrimitive[] = [
    box([w, h - 0.03, d - 0.02], [0, 0.03 + (h - 0.03) / 2, -0.01], body, { roughness: 0.35 }),
    box([w - 0.03, 0.03, d - 0.05], [0, 0.015, -0.01], '#d4d4d8'),
    box([w - 0.08, h * 0.35, 0.006], [0, h * 0.72, front + 0.003], '#d4d4d8'),
    box([0.1, 0.035, 0.005], [0, h * 0.5, front + 0.0025], SCREEN, { emissive: '#1e3a5f', roughness: 0.1 }),
  ];
  for (let i = 0; i < 6; i++) {
    p.push(box([w - 0.1, 0.008, 0.008], [0, h * 0.58 + i * h * 0.045, front + 0.008], '#a1a1aa'));
  }
  return p;
}

export function airPurifier(w: number, h: number, body = WHITE): ProceduralPrimitive[] {
  const r = w / 2;
  return [
    cyl(r, h - 0.05, [0, (h - 0.05) / 2, 0], body, { segments: 32, roughness: 0.45 }),
    cyl(r - 0.005, 0.05, [0, h - 0.025, 0], '#9ca3af', { segments: 32, roughness: 0.8 }),
    cyl(r * 0.45, 0.004, [0, h + 0.002, 0], SCREEN, { segments: 24, emissive: '#1e3a5f' }),
  ];
}

export function clothesCare(w: number, d: number, h: number, body = '#4b5058', doorColor = '#8b94a3'): ProceduralPrimitive[] {
  const bodyD = d - 0.04;
  const front = -0.02 + bodyD / 2;
  return [
    box([w, h, bodyD], [0, h / 2, -0.02], body, { metalness: 0.3, roughness: 0.4 }),
    box([w - 0.006, h - 0.01, 0.03], [0, h / 2, front + 0.015], doorColor, { roughness: 0.05, metalness: 0.6 }),
    box([0.012, 0.4, 0.02], [w / 2 - 0.03, h * 0.55, front + 0.04], METAL, { metalness: 0.8, roughness: 0.25 }),
    box([0.1, 0.03, 0.004], [0, h - 0.12, front + 0.032], SCREEN, { emissive: '#1e3a5f' }),
  ];
}

const ohou = (q: string) => `https://ohou.se/search/index?query=${q}`;

/** 실규격 가전 카탈로그 (size = [가로, 깊이, 높이] m) */
export const APPLIANCES: FurnitureSpec[] = [
  { id: 'tv-55-set', name: 'TV 55인치 + 거실장', category: 'appliance', size: [1.6, 0.42, 1.21], color: '#111214', brand: '기본 가전', material: 'LED 패널 + 원목 무늬 거실장', shopUrl: ohou('55인치TV'), source: 'catalog', primitives: tvWithCabinet(1.6, 0.42) },
  { id: 'tv-65-stand', name: 'TV 65인치 (스탠드형)', category: 'appliance', size: [1.45, 0.46, 1.6], color: '#111214', brand: '기본 가전', material: 'LED 패널 + 스틸 스탠드', shopUrl: ohou('스탠드TV'), source: 'catalog', primitives: tvFloorStand(1.45, 1.6) },
  { id: 'fridge-side', name: '양문형 냉장고', category: 'appliance', size: [0.91, 0.92, 1.79], color: '#d6d9de', brand: '기본 가전', material: '메탈 도어', shopUrl: ohou('양문형냉장고'), source: 'catalog', primitives: fridge(0.91, 0.92, 1.79, '#d6d9de', false) },
  { id: 'fridge-single', name: '냉장고 (단문형)', category: 'appliance', size: [0.6, 0.68, 1.8], color: '#e5e7eb', brand: '기본 가전', material: '메탈 도어', shopUrl: ohou('1도어냉장고'), source: 'catalog', primitives: fridge(0.6, 0.68, 1.8, '#e5e7eb', true) },
  { id: 'fridge-mini', name: '소형 냉장고', category: 'appliance', size: [0.48, 0.5, 0.85], color: '#f5f5f4', brand: '기본 가전', material: '강판', shopUrl: ohou('소형냉장고'), source: 'catalog', primitives: miniFridge(0.48, 0.5, 0.85) },
  { id: 'washer-drum', name: '드럼세탁기', category: 'appliance', size: [0.6, 0.65, 0.85], color: WHITE, brand: '기본 가전', material: '강판 + 강화유리 도어', shopUrl: ohou('드럼세탁기'), source: 'catalog', primitives: drum(0.6, 0.65, 0.85, WHITE, '#334155') },
  { id: 'washer-top', name: '통돌이 세탁기', category: 'appliance', size: [0.62, 0.65, 1.0], color: WHITE, brand: '기본 가전', material: '강판 + 강화유리 도어', shopUrl: ohou('통돌이세탁기'), source: 'catalog', primitives: topLoader(0.62, 0.65, 1.0) },
  { id: 'dryer', name: '의류 건조기', category: 'appliance', size: [0.6, 0.7, 0.85], color: '#e7e5e4', brand: '기본 가전', material: '강판 + 강화유리 도어', shopUrl: ohou('건조기'), source: 'catalog', primitives: drum(0.6, 0.7, 0.85, '#e7e5e4', '#111827') },
  { id: 'aircon-stand', name: '스탠드 에어컨', category: 'appliance', size: [0.37, 0.33, 1.83], color: WHITE, brand: '기본 가전', material: 'ABS', shopUrl: ohou('스탠드에어컨'), source: 'catalog', primitives: standAircon(0.37, 0.33, 1.83) },
  { id: 'air-purifier', name: '공기청정기', category: 'appliance', size: [0.32, 0.32, 0.68], color: WHITE, brand: '기본 가전', material: 'ABS', shopUrl: ohou('공기청정기'), source: 'catalog', primitives: airPurifier(0.32, 0.68) },
  { id: 'clothes-care', name: '의류관리기', category: 'appliance', size: [0.45, 0.6, 1.85], color: '#4b5058', brand: '기본 가전', material: '미러 글라스 도어', shopUrl: ohou('의류관리기'), source: 'catalog', primitives: clothesCare(0.45, 0.6, 1.85) },
];
