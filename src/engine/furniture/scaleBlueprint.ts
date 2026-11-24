import type { Blueprint, ModuleSpec } from './blueprint';

const r3 = (v: number) => Math.round(v * 1000) / 1000;
const scaleDim = (v: number, k: number) => r3(Math.min(3.2, Math.max(0.05, v * k)));

function scaleModule<T extends ModuleSpec>(mod: T, k: number): T {
  return {
    ...mod,
    ...(typeof mod.w === 'number' && Number.isFinite(mod.w) ? { w: scaleDim(mod.w, k) } : {}),
    ...(typeof mod.d === 'number' && Number.isFinite(mod.d) ? { d: scaleDim(mod.d, k) } : {}),
    ...(typeof mod.h === 'number' && Number.isFinite(mod.h) ? { h: scaleDim(mod.h, k) } : {}),
    ...(mod.params ? { params: { ...mod.params } } : {}),
    ...(mod.children ? { children: mod.children.map((c) => scaleModule(c, k)) } : {}),
  };
}

/**
 * 기준 가로 실측(widthCm, 10~600cm)에 맞춰 Blueprint의 루트·자식 치수와 mountY를 균일 비율로 스케일한다.
 * 각 치수는 [0.05, 3.2]m 범위로 클램프하고 소수점 3자리로 반올림하며, 입력 객체를 변형하지 않는다.
 */
export function scaleBlueprintToWidth(bp: Blueprint, widthCm: number): Blueprint {
  if (!Number.isFinite(widthCm) || widthCm < 10 || widthCm > 600) return bp;
  if (!bp?.root || !Number.isFinite(bp.root.w) || bp.root.w <= 0) return bp;

  const k = (widthCm / 100) / bp.root.w;
  return {
    ...bp,
    ...(typeof bp.mountY === 'number' && Number.isFinite(bp.mountY)
      ? { mountY: r3(Math.min(3.2, Math.max(0, bp.mountY * k))) }
      : {}),
    ...(bp.notes ? { notes: [...bp.notes] } : {}),
    root: scaleModule(bp.root, k),
  };
}
