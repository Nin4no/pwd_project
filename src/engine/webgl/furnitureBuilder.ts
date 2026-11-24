import type { FurnitureSpec } from '../../domain/types';
import type { GeometryData } from './resources';
import {
  createBoxGeometry,
  createCylinderGeometry,
  mergeGeometries,
  parseHexColor,
} from './primitives';

export interface FurniturePartData {
  geom: GeometryData;
  color: [number, number, number];
  alpha: number;
  roughness: number;
  metalness: number;
  emissive: [number, number, number];
}

interface RawPart {
  geom: GeometryData;
  color: [number, number, number];
  alpha: number;
  roughness: number;
  metalness: number;
  emissive: [number, number, number];
}

class PartCollector {
  private parts: RawPart[] = [];

  box(
    s: [number, number, number],
    p: [number, number, number],
    color: string | [number, number, number],
    rough = 0.7,
    metal = 0,
    alpha = 1,
    emissive: [number, number, number] = [0, 0, 0],
  ): void {
    const col = typeof color === 'string' ? parseHexColor(color) : color;
    const geom = createBoxGeometry(s[0], s[1], s[2], p[0], p[1], p[2]);
    this.parts.push({
      geom,
      color: col,
      alpha,
      roughness: rough,
      metalness: metal,
      emissive,
    });
  }

  cyl(
    r: number,
    h: number,
    p: [number, number, number],
    color: string | [number, number, number],
    rt?: number,
    seg = 24,
    metal?: number,
    openEnded = false,
    emissive: [number, number, number] = [0, 0, 0],
    alpha = 1,
  ): void {
    const col = typeof color === 'string' ? parseHexColor(color) : color;
    const m = metal ?? 0;
    const rough = metal !== undefined && metal > 0 ? 0.35 : 0.7;
    const rTop = rt ?? r;
    const geom = createCylinderGeometry(rTop, r, h, seg, openEnded, p[0], p[1], p[2]);
    this.parts.push({
      geom,
      color: col,
      alpha,
      roughness: rough,
      metalness: m,
      emissive,
    });
  }

  legs(
    w: number,
    d: number,
    h: number,
    color: string | [number, number, number],
    t = 0.04,
    inset = 0.03,
  ): void {
    const xs = [-w / 2 + t / 2 + inset, w / 2 - t / 2 - inset];
    const zs = [-d / 2 + t / 2 + inset, d / 2 - t / 2 - inset];
    for (const x of xs) {
      for (const z of zs) {
        this.box([t, h, t], [x, h / 2, z], color);
      }
    }
  }

  build(): FurniturePartData[] {
    const opaqueMap = new Map<
      string,
      { meta: Omit<RawPart, 'geom'>; geoms: GeometryData[] }
    >();
    const transparentList: FurniturePartData[] = [];

    for (const p of this.parts) {
      if (p.alpha < 1) {
        transparentList.push(p);
      } else {
        const key = [
          p.color.map((v) => v.toFixed(3)).join(','),
          p.roughness.toFixed(3),
          p.metalness.toFixed(3),
          p.emissive.map((v) => v.toFixed(3)).join(','),
        ].join('|');

        let group = opaqueMap.get(key);
        if (!group) {
          group = {
            meta: {
              color: p.color,
              alpha: p.alpha,
              roughness: p.roughness,
              metalness: p.metalness,
              emissive: p.emissive,
            },
            geoms: [],
          };
          opaqueMap.set(key, group);
        }
        group.geoms.push(p.geom);
      }
    }

    const result: FurniturePartData[] = [];
    for (const group of opaqueMap.values()) {
      result.push({
        geom: mergeGeometries(group.geoms),
        color: group.meta.color,
        alpha: group.meta.alpha,
        roughness: group.meta.roughness,
        metalness: group.meta.metalness,
        emissive: group.meta.emissive,
      });
    }

    // Keep transparent parts at the end so they render after opaque parts
    result.push(...transparentList);
    return result;
  }
}

/**
 * Procedural furniture geometry builder replicating Three.js FurnitureModel.tsx
 * with drawer call minimization and material grouping.
 */
export function buildFurnitureParts(spec: FurnitureSpec): FurniturePartData[] {
  const col = new PartCollector();
  const [w, d, h] = spec.size;
  const c = spec.color;

  // Opus 5.5 Master Spec: AI 생성 커스텀 프리미티브 트리 지원
  if (spec.primitives && spec.primitives.length > 0) {
    for (const p of spec.primitives) {
      const emissive = p.emissive ? parseHexColor(p.emissive) : ([0, 0, 0] as [number, number, number]);
      if (p.kind === 'box') {
        col.box(
          p.size,
          p.pos,
          p.color,
          p.roughness ?? 0.7,
          p.metalness ?? 0,
          p.alpha ?? 1,
          emissive,
        );
      } else if (p.kind === 'cylinder') {
        col.cyl(
          p.radius,
          p.height,
          p.pos,
          p.color,
          p.radiusTop ?? p.radius,
          p.segments ?? 24,
          p.metalness ?? 0,
          p.openEnded ?? false,
          emissive,
          p.alpha ?? 1,
        );
      }
    }
    return col.build();
  }

  switch (spec.category) {
    case 'bed': {
      const frameH = 0.28;
      col.box([w, frameH, d], [0, frameH / 2, 0], c);
      col.box([w - 0.06, 0.2, d - 0.12], [0, frameH + 0.1, 0.04], '#fbfbf8', 0.95);
      col.box([w, 0.95, 0.07], [0, 0.475, -d / 2 + 0.035], c);
      const pillowXs = w > 1.3 ? [-w / 4, w / 4] : [0];
      const pillowW = Math.min(0.55, w * 0.42);
      for (const x of pillowXs) {
        col.box([pillowW, 0.1, 0.32], [x, frameH + 0.25, -d / 2 + 0.3], '#e8eef8', 1);
      }
      col.box([w - 0.04, 0.05, d * 0.55], [0, frameH + 0.215, d * 0.2], '#9fb7e0', 1);
      break;
    }

    case 'desk': {
      const isMotion = spec.id.includes('motion');
      col.box([w, 0.035, d], [0, h - 0.0175, 0], c);
      if (isMotion) {
        for (const x of [-w / 2 + 0.12, w / 2 - 0.12]) {
          col.box([0.07, h - 0.06, 0.07], [x, (h - 0.06) / 2 + 0.03, 0], '#374151', 0.7, 0.6);
          col.box([0.07, 0.03, d - 0.05], [x, 0.015, 0], '#374151', 0.7, 0.6);
        }
        col.box([w - 0.3, 0.05, 0.05], [0, h - 0.08, 0], '#374151', 0.7, 0.6);
        // 모니터 (모션데스크에만 표시)
        col.box([0.5, 0.3, 0.02], [0, h + 0.2, -d / 2 + 0.12], '#111827', 0.3);
        col.box([0.1, 0.05, 0.08], [0, h + 0.025, -d / 2 + 0.12], '#374151');
      } else {
        col.legs(w, d, h - 0.035, '#9ca3af');
      }
      break;
    }

    case 'storage': {
      if (spec.id === 'hanger') {
        const pole = '#4b5563';
        for (const x of [-w / 2 + 0.02, w / 2 - 0.02]) {
          col.box([0.03, h, 0.03], [x, h / 2, 0], pole, 0.7, 0.6);
          col.box([0.04, 0.03, d], [x, 0.015, 0], pole, 0.7, 0.6);
        }
        col.box([w, 0.025, 0.025], [0, h - 0.05, 0], pole, 0.7, 0.6);
        const clothesCols = ['#60a5fa', '#f87171', '#fbbf24', '#34d399', '#a78bfa', '#e5e7eb'];
        for (let i = 0; i < clothesCols.length; i++) {
          const x = -w / 2 + 0.15 + i * ((w - 0.3) / 5);
          col.box([0.04, 0.8, d * 0.8], [x, h - 0.48, 0], clothesCols[i], 1);
        }
        col.box([w - 0.06, 0.02, d - 0.05], [0, 0.2, 0], pole, 0.7, 0.4);
        break;
      }

      if (spec.id === 'shelf') {
        const t = 0.02;
        for (const x of [-w / 2 + t / 2, w / 2 - t / 2]) {
          col.box([t, h, d], [x, h / 2, 0], c);
        }
        col.box([w, h, 0.01], [0, h / 2, -d / 2 + 0.005], c);
        for (let i = 0; i < 6; i++) {
          col.box([w - t * 2, t, d], [0, t / 2 + i * ((h - t) / 5), 0], c);
        }
        const bookCols = ['#ef4444', '#3b82f6', '#22c55e', '#f59e0b'];
        for (let i = 0; i < 4; i++) {
          col.box(
            [0.3, 0.24, d * 0.7],
            [-0.15 + (i % 2) * 0.25, 0.14 + i * ((h - t) / 5), 0.02],
            bookCols[i],
          );
        }
        break;
      }

      // Wardrobe / Drawer
      const rows = spec.id === 'drawer' ? 3 : 0;
      col.box([w, h - 0.05, d], [0, (h - 0.05) / 2 + 0.05, 0], c);
      col.box([w - 0.04, 0.05, d - 0.04], [0, 0.025, 0], '#9ca3af');
      if (rows > 0) {
        for (let i = 0; i < rows; i++) {
          const fh = (h - 0.09) / rows;
          const y = 0.07 + fh * i + fh / 2;
          col.box([w - 0.04, fh - 0.02, 0.01], [0, y, d / 2 + 0.005], '#ffffff');
          col.box([0.18, 0.02, 0.02], [0, y, d / 2 + 0.02], '#6b7280', 0.7, 0.7);
        }
      } else {
        col.box([0.006, h - 0.1, 0.012], [0, h / 2 + 0.03, d / 2 + 0.003], '#cbd5e1');
        for (const x of [-0.04, 0.04]) {
          col.box([0.02, 0.25, 0.02], [x, h * 0.55, d / 2 + 0.015], '#6b7280', 0.7, 0.7);
        }
      }
      break;
    }

    case 'seating': {
      if (spec.id.startsWith('sofa')) {
        const arm = 0.16;
        col.box([w, 0.25, d], [0, 0.175, 0], c, 1);
        col.box([w - arm * 2, 0.14, d - 0.2], [0, 0.37, 0.08], c, 1);
        col.box([w, h - 0.05, 0.2], [0, (h - 0.05) / 2 + 0.05, -d / 2 + 0.1], c, 1);
        for (const x of [-w / 2 + arm / 2, w / 2 - arm / 2]) {
          col.box([arm, 0.6, d], [x, 0.3 + 0.05, 0], c, 1);
        }
        col.legs(w, d, 0.05, '#3f3f46', 0.04, 0.02);
        break;
      }

      // Desk chair
      const seatY = 0.46;
      col.cyl(0.3, 0.04, [0, 0.04, 0], '#111827', 0.3, 5);
      col.cyl(0.025, seatY - 0.08, [0, (seatY - 0.08) / 2 + 0.06, 0], '#9ca3af', undefined, 24, 0.8);
      col.box([w * 0.82, 0.08, d * 0.8], [0, seatY, 0.02], c, 0.9);
      col.box([w * 0.78, h - seatY - 0.08, 0.06], [0, seatY + (h - seatY) / 2, -d / 2 + 0.08], c, 0.9);
      for (const x of [-w / 2 + 0.06, w / 2 - 0.06]) {
        col.box([0.04, 0.04, d * 0.5], [x, seatY + 0.2, 0], '#374151');
      }
      break;
    }

    case 'table': {
      if (spec.id.includes('round')) {
        col.cyl(w / 2, 0.035, [0, h - 0.0175, 0], c, undefined, 48);
        col.cyl(0.04, h - 0.05, [0, (h - 0.05) / 2 + 0.02, 0], '#27272a', undefined, 24, 0.5);
        col.cyl(0.25, 0.02, [0, 0.01, 0], '#27272a', undefined, 24, 0.5);
        break;
      }
      col.box([w, 0.035, d], [0, h - 0.0175, 0], c);
      col.legs(w, d, h - 0.035, c, 0.045);
      break;
    }

    case 'lighting': {
      col.cyl(0.14, 0.03, [0, 0.015, 0], '#27272a', undefined, 24, 0.6);
      col.cyl(0.012, h - 0.3, [0, (h - 0.3) / 2, 0], '#a1a1aa', undefined, 24, 0.8);
      const shadeColor = parseHexColor(c);
      const emissiveColor: [number, number, number] = [
        shadeColor[0] * 0.6,
        shadeColor[1] * 0.6,
        shadeColor[2] * 0.6,
      ];
      col.cyl(
        w / 2,
        0.3,
        [0, h - 0.15, 0],
        shadeColor,
        0.1,
        32,
        0,
        true,
        emissiveColor,
      );
      break;
    }

    case 'window': {
      const y0 = spec.elevation ?? 0;
      const ft = 0.05;
      const st = 0.035;
      const frame = '#f8fafc';
      const sliding = w >= 1.0;
      const sashW = sliding ? (w - ft * 2) / 2 + st / 2 : w - ft * 2;
      const sashH = h - ft * 2;
      const sashes = sliding
        ? [
            { x: -(w - ft * 2) / 4 + st / 4, z: -0.025 },
            { x: (w - ft * 2) / 4 - st / 4, z: 0.025 },
          ]
        : [{ x: 0, z: 0 }];

      // Outer frame
      col.box([w, ft, d], [0, y0 + ft / 2, 0], frame, 0.4);
      col.box([w, ft, d], [0, y0 + h - ft / 2, 0], frame, 0.4);
      col.box([ft, h - ft * 2, d], [-w / 2 + ft / 2, y0 + h / 2, 0], frame, 0.4);
      col.box([ft, h - ft * 2, d], [w / 2 - ft / 2, y0 + h / 2, 0], frame, 0.4);

      // Sill
      if (y0 > 0.1) {
        col.box([w + 0.04, 0.025, d], [0, y0 - 0.0125, 0], frame, 0.5);
      }

      // Sashes
      for (const s of sashes) {
        const cy = y0 + ft + sashH / 2;
        col.box([sashW, st, 0.04], [s.x, y0 + ft + sashH - st / 2, s.z], frame, 0.4);
        col.box([sashW, st, 0.04], [s.x, y0 + ft + st / 2, s.z], frame, 0.4);
        col.box([st, sashH - st * 2, 0.04], [s.x - sashW / 2 + st / 2, cy, s.z], frame, 0.4);
        col.box([st, sashH - st * 2, 0.04], [s.x + sashW / 2 - st / 2, cy, s.z], frame, 0.4);

        // Glass pane (transparent)
        col.box(
          [sashW - st * 2, sashH - st * 2, 0.008],
          [s.x, cy, s.z],
          c,
          0.05,
          0.1,
          0.28,
        );
      }
      break;
    }

    case 'door': {
      const ft = 0.045;
      const frame = '#f8fafc';
      const leafH = h - ft;
      const leafW = w - ft * 2;

      // Frame: Top header, Left jamb, Right jamb (flush with wall thickness d)
      col.box([w, ft, d], [0, h - ft / 2, 0], frame, 0.4);
      col.box([ft, leafH, d], [-w / 2 + ft / 2, leafH / 2, 0], frame, 0.4);
      col.box([ft, leafH, d], [w / 2 - ft / 2, leafH / 2, 0], frame, 0.4);

      if (spec.id.includes('sliding') || w >= 1.3) {
        // Sliding / Double Glass Door leaves
        const st = 0.04;
        const sashW = leafW / 2 + st / 2;
        const sashes = [
          { x: -leafW / 4 + st / 4, z: -0.02 },
          { x: leafW / 4 - st / 4, z: 0.02 },
        ];
        const darkFrame = '#334155';
        for (const s of sashes) {
          const cy = leafH / 2;
          col.box([sashW, st, 0.035], [s.x, leafH - st / 2, s.z], darkFrame, 0.4);
          col.box([sashW, st * 1.5, 0.035], [s.x, (st * 1.5) / 2, s.z], darkFrame, 0.4);
          col.box([st, leafH, 0.035], [s.x - sashW / 2 + st / 2, cy, s.z], darkFrame, 0.4);
          col.box([st, leafH, 0.035], [s.x + sashW / 2 - st / 2, cy, s.z], darkFrame, 0.4);
          col.box(
            [sashW - st * 2, leafH - st * 2.5, 0.008],
            [s.x, cy, s.z],
            '#cbd5e1',
            0.1,
            0.1,
            0.32,
          );
        }
      } else {
        // Solid hinged door leaf
        const cy = leafH / 2;
        col.box([leafW, leafH, 0.045], [0, cy, 0], c, 0.65);

        // Subtle recessed panel trim
        const panelW = leafW - 0.16;
        const panelH = (leafH - 0.28) / 2;
        if (panelW > 0.1 && panelH > 0.1) {
          for (const py of [cy - panelH / 2 - 0.03, cy + panelH / 2 + 0.03]) {
            for (const sd of [-1, 1]) {
              col.box([panelW, panelH, 0.004], [0, py, sd * 0.023], c, 0.5);
            }
          }
        }

        // Metallic door lever handles on both sides
        const hx = w / 2 - ft - 0.08;
        const hy = 0.95;
        const handleColor = '#94a3b8';
        for (const hz of [-0.032, 0.032]) {
          col.box([0.025, 0.025, 0.01], [hx, hy, hz], handleColor, 0.3, 0.8);
          const leverDir = hz > 0 ? 1 : -1;
          col.box([0.1, 0.015, 0.012], [hx - 0.04, hy, hz + leverDir * 0.01], handleColor, 0.3, 0.8);
        }
      }
      break;
    }

    default:
      col.box([w, h, d], [0, h / 2, 0], c);
      break;
  }

  return col.build();
}
