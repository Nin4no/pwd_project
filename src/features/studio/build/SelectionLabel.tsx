import type { FurnitureSpec } from '../../../domain/types';
import s from './RoomCanvas.module.css';

const cm = (m: number) => Math.round(m * 100);

/** 3D 캔버스 위 선택 가구 이름·치수 라벨 (위치는 RoomCanvas가 매 프레임 갱신) */
export default function SelectionLabel({ spec, size, colliding }: { spec: FurnitureSpec; size: [number, number, number]; colliding: boolean }) {
  const elev = spec.elevation ?? 0;
  const dims = spec.wallMounted
    ? `${cm(size[0])}×${cm(size[2])}cm${elev > 0 ? ` · 창대 ${cm(elev)}cm` : ''}`
    : `${cm(size[0])}×${cm(size[1])}cm`;
  return (
    <div className={s.chip} data-colliding={colliding || undefined}>
      {spec.name} · {dims}
      {colliding ? ' · 간섭!' : ''}
    </div>
  );
}
