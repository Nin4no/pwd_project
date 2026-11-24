import { useMemo } from 'react';
import { Badge, IconButton } from '../../../design/components';
import type { FurnitureCategory } from '../../../domain/types';
import { useStudio, useStudioStoreApi } from '../context';
import { FocusIcon, TrashIcon } from '../icons';
import type { StudioCatalog } from '../store';
import s from './Build.module.css';

export const CAT_LABEL: Record<FurnitureCategory, string> = {
  bed: '침대',
  desk: '책상',
  storage: '수납',
  seating: '의자·소파',
  table: '테이블',
  lighting: '조명',
  window: '창문',
  door: '문',
  appliance: '가전',
};

const cm = (m: number) => Math.round(m * 100);

/** 배치된 가구 목록 — 카드 클릭으로 선택(시점 유지), 빠른 버튼으로 포커스·삭제 */
export default function PlacedList({ catalog }: { catalog: StudioCatalog }) {
  const store = useStudioStoreApi();
  const room = useStudio((st) => st.room);
  const collisions = useStudio((st) => st.collisions);
  const outside = useStudio((st) => st.outside);
  const selectedId = useStudio((st) => st.selectedId);
  const scoped = useMemo(() => (room ? catalog.scoped(room) : catalog), [catalog, room?.customSpecs]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!room || room.furniture.length === 0) {
    return (
      <div className={s.emptyCard}>
        <p className={s.emptyTitle}>배치된 가구가 없어요</p>
        <p className={s.emptyDesc}>왼쪽 카탈로그에서 가구를 클릭하거나 끌어다 놓아 보세요.</p>
      </div>
    );
  }

  const a = store.getState();

  return (
    <ul className={s.placed}>
      {room.furniture.map((f) => {
        const spec = scoped.get(f.specId);
        const name = spec?.name ?? f.specId;
        const catLabel = spec ? CAT_LABEL[spec.category] : undefined;
        const w = f.width ?? spec?.size[0] ?? 0;
        const d = f.depth ?? spec?.size[1] ?? 0;
        const isSelected = selectedId === f.id;
        const isColliding = collisions.has(f.id);
        const isOutside = outside.includes(f.id);

        return (
          <li key={f.id} className={s.placedRow}>
            <button
              type="button"
              className={s.placedItem}
              aria-current={isSelected ? 'true' : undefined}
              onClick={() => a.select(f.id)}
            >
              <span
                className={s.swatch}
                style={{ backgroundColor: spec?.color ?? 'var(--grey-100)' }}
                aria-hidden="true"
              />
              <span className={s.placedBody}>
                <span className={s.placedName}>{name}</span>
                <span className={s.placedMeta}>
                  {catLabel && <span className={s.metaCat}>{catLabel}</span>}
                  {spec?.wallMounted && <span className={s.metaTag}>벽부착</span>}
                  <span className={s.metaDim}>{cm(w)}×{cm(d)} cm</span>
                </span>
                {(isColliding || isOutside) && (
                  <span className={s.placedBadges}>
                    {isColliding && <Badge tone="danger">충돌</Badge>}
                    {isOutside && <Badge tone="danger">방 밖</Badge>}
                  </span>
                )}
              </span>
            </button>
            <div className={s.placedQuick}>
              <IconButton
                size="sm"
                variant="ghost"
                aria-label={`${name} 보기`}
                icon={<FocusIcon />}
                onClick={(e) => {
                  e.stopPropagation();
                  a.select(f.id);
                  a.scene()?.focusFurniture?.(f.id);
                }}
              />
              <IconButton
                size="sm"
                variant="danger"
                aria-label={`${name} 삭제`}
                icon={<TrashIcon />}
                onClick={(e) => {
                  e.stopPropagation();
                  a.remove(f.id);
                }}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
