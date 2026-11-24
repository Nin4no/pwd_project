import { useMemo, useState } from 'react';
import { Field, IconButton } from '../../../design/components';
import type { CatalogRegistry } from '../../../domain/catalog';
import type { FurnitureCategory, FurnitureSpec } from '../../../domain/types';
import { useStudio, useStudioStoreApi } from '../context';
import { TrashIcon } from '../icons';
import { useCatalogVersion } from './useCatalogVersion';
import s from './CatalogPanel.module.css';

type Cat = FurnitureCategory | 'all' | 'ai';
export const DRAG_MIME = 'text/furniture';

const CATEGORY_LABEL: Record<FurnitureCategory, string> = {
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

const CATS: ReadonlyArray<{ value: Cat; label: string }> = [
  { value: 'all', label: '전체' },
  ...(Object.entries(CATEGORY_LABEL) as [FurnitureCategory, string][]).map(([value, label]) => ({ value, label })),
  { value: 'ai', label: 'AI' },
];

const cm = (m: number) => Math.round(m * 100);

/** 3D 좌측 패널: 고정 헤더(제목·검색·카테고리 칩)·2줄 가구 카드(클릭/드래그 배치)·AI 가구 삭제 */
export default function CatalogPanel({ catalog, initialCat = 'all' }: { catalog: CatalogRegistry; initialCat?: Cat }) {
  const store = useStudioStoreApi();
  const furniture = useStudio((st) => st.room?.furniture);
  const version = useCatalogVersion(catalog);
  const [q, setQ] = useState('');
  const [cat, setCat] = useState<Cat>(initialCat);
  const items = useMemo(() => catalog.search(q.trim(), cat), [catalog, q, cat, version]); // eslint-disable-line react-hooks/exhaustive-deps

  const place = (spec: FurnitureSpec) => {
    // 배치 시 시점을 강제로 옮기지 않음 (사용자 요청) — 보기 버튼·F 키로만 이동
    store.getState().place(spec.id, { x: 0, z: 0 });
  };
  const removeAi = (spec: FurnitureSpec) => {
    const inUse = furniture?.some((f) => f.specId === spec.id);
    const msg = inUse
      ? `'${spec.name}'은(는) 이 방에 배치되어 있어요. 목록에서 지워도 방에 놓인 가구는 유지돼요. 삭제할까요?`
      : `'${spec.name}'을(를) AI 가구 목록에서 삭제할까요?`;
    if (window.confirm(msg)) catalog.removeUserFurniture(spec.id);
  };

  return (
    <div className={s.catalog}>
      <header className={s.header}>
        <div className={s.titleRow}>
          <h2 className={s.title}>가구 카탈로그</h2>
          <span className={s.count} aria-live="polite">
            {items.length}개
          </span>
        </div>
        <Field label="가구 검색" hideLabel type="search" placeholder="가구 검색 (예: 침대, 책상)" value={q} onChange={(e) => setQ(e.currentTarget.value)} />
        <div className={s.chips} role="group" aria-label="카테고리">
          {CATS.map((c) => (
            <button
              key={c.value}
              type="button"
              className={s.chip}
              aria-pressed={cat === c.value}
              onClick={(e) => {
                setCat(c.value);
                e.currentTarget.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
              }}
            >
              {c.label}
            </button>
          ))}
        </div>
      </header>
      <div className={s.body}>
        {items.length === 0 ? (
          <p className={s.empty}>{cat === 'ai' ? '아직 만든 AI 가구가 없어요. 상단 AI ▾ → 가구 만들기로 시작해 보세요.' : '검색 결과가 없어요.'}</p>
        ) : (
          <ul className={s.cards}>
            {items.map((spec) => {
              const isAi = spec.source === 'ai';
              const canDelete = isAi && !catalog.isBase(spec.id);
              return (
                <li key={spec.id} className={s.cardItem}>
                  <button
                    type="button"
                    className={canDelete ? `${s.card} ${s.cardWithDel}` : s.card}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData(DRAG_MIME, spec.id);
                      e.dataTransfer.effectAllowed = 'copy';
                    }}
                    onClick={() => place(spec)}
                    title={`${spec.name} — 클릭하면 방 가운데, 끌어서 원하는 곳에 놓기`}
                  >
                    <span className={s.cardTop}>
                      <span className={s.swatch} style={{ background: spec.color }} aria-hidden="true" />
                      <span className={s.cardName}>{spec.name}</span>
                      {(spec.wallMounted || isAi) && (
                        <span className={s.cardTags}>
                          {spec.wallMounted && <span className={s.tagWall}>벽부착</span>}
                          {isAi && <span className={s.tagAi}>AI</span>}
                        </span>
                      )}
                    </span>
                    <span className={s.cardMeta}>
                      <span className={s.cardCat}>{CATEGORY_LABEL[spec.category]}</span>
                      <span className={s.cardSize}>
                        {cm(spec.size[0])}×{cm(spec.size[1])}×{cm(spec.size[2])} cm
                      </span>
                    </span>
                  </button>
                  {canDelete && (
                    <IconButton className={s.cardDel} size="sm" aria-label={`${spec.name} 삭제`} icon={<TrashIcon />} onClick={() => removeAi(spec)} />
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
