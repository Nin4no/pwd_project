import { useEffect, useMemo, useState } from 'react';
import { Badge, Button, IconButton, NumberField, Tabs, type TabItem } from '../../../design/components';
import { normalizeRotation } from '../../../domain/room';
import { useStudio, useStudioStoreApi } from '../context';
import { CopyIcon, FocusIcon, RotateIcon, TrashIcon } from '../icons';
import type { StudioCatalog } from '../store';
import PlacedList, { CAT_LABEL } from './PlacedList';
import s from './Build.module.css';

type InspectorTab = 'props' | 'placed';

const ROTATION_PRESETS = [-90, 0, 90] as const;
const cm = (m: number) => Math.round(m * 100);

/** 3D 우측 패널: 속성 인스펙터 + 배치 목록 탭 */
export default function Inspector({ catalog }: { catalog: StudioCatalog }) {
  const store = useStudioStoreApi();
  const room = useStudio((st) => st.room);
  const selectedId = useStudio((st) => st.selectedId);
  const colliding = useStudio((st) => (st.selectedId ? st.collisions.has(st.selectedId) : false));
  const outside = useStudio((st) => (st.selectedId ? st.outside.includes(st.selectedId) : false));
  const [sizeOpen, setSizeOpen] = useState(false);
  const [tab, setTab] = useState<InspectorTab>(() => (selectedId ? 'props' : 'placed'));
  const scoped = useMemo(() => (room ? catalog.scoped(room) : catalog), [catalog, room?.customSpecs]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setTab(selectedId ? 'props' : 'placed');
  }, [selectedId]);

  const f = selectedId ? room?.furniture.find((p) => p.id === selectedId) : undefined;
  const spec = f ? scoped.get(f.specId) : undefined;
  const placedCount = room?.furniture.length ?? 0;

  const placedTab: TabItem<InspectorTab> = {
    value: 'placed',
    label: '배치 목록',
    count: placedCount,
    panel: <PlacedList catalog={catalog} />,
  };

  if (!f || !spec) {
    return (
      <div className={s.inspector}>
        <Tabs
          aria-label="배치 정보"
          value="placed"
          onChange={() => setTab('placed')}
          panelClassName={s.tabPanel}
          items={[placedTab]}
        />
      </div>
    );
  }

  const a = store.getState();
  const w = f.width ?? spec.size[0];
  const d = f.depth ?? spec.size[1];
  const h = f.height ?? spec.size[2];
  const rotDeg = Math.round(f.rotation);
  const hasCustomSize = f.width != null || f.depth != null || f.height != null;
  const rotate = (delta: number) => a.patch(f.id, { rotation: normalizeRotation(f.rotation + delta) });
  const endLive = () => store.getState().commitLive();

  const propsPanel = (
    <div className={s.inspBody}>
      <header className={s.inspCard}>
        <div className={s.inspCardTop}>
          <span className={s.inspSwatch} style={{ backgroundColor: spec.color }} aria-hidden="true" />
          <div className={s.inspCardTitleWrap}>
            <h2 className={s.inspTitle}>{spec.name}</h2>
            <div className={s.inspMeta}>
              <span>{CAT_LABEL[spec.category]}</span>
              {spec.wallMounted && <span className={s.metaTag}>벽부착</span>}
              <span className={s.metaDim}>{cm(w)}×{cm(d)}×{cm(h)} cm</span>
            </div>
          </div>
        </div>
        {(colliding || outside || spec.source === 'ai') && (
          <div className={s.badges}>
            {colliding && <Badge tone="danger">충돌</Badge>}
            {outside && <Badge tone="danger" title="벽을 바꾼 뒤 방 밖에 놓였어요">방 밖</Badge>}
            {spec.source === 'ai' && <Badge tone="ai">AI</Badge>}
          </div>
        )}
      </header>

      <section className={s.sectionCard}>
        <div className={s.sectionHead}>
          <label className={s.sectionLabel} htmlFor="insp-rot">회전</label>
          <div className={s.rotMeta}>
            <span className={s.degreeBadge}>{rotDeg}°</span>
            <IconButton
              size="sm"
              variant="ghost"
              aria-label="90° 회전"
              icon={<RotateIcon />}
              onClick={() => rotate(90)}
            />
          </div>
        </div>
        <input
          id="insp-rot"
          className={s.range}
          type="range"
          min={-180}
          max={180}
          step={1}
          value={rotDeg}
          onChange={(e) => a.patch(f.id, { rotation: Number(e.currentTarget.value) }, { live: true })}
          onPointerUp={endLive}
          onKeyUp={endLive}
          onBlur={endLive}
        />
        <div className={s.presetRow} role="group" aria-label="회전 각도 프리셋">
          {ROTATION_PRESETS.map((deg) => (
            <button
              key={deg}
              type="button"
              className={s.presetBtn}
              aria-pressed={rotDeg === deg}
              onClick={() => a.patch(f.id, { rotation: deg })}
            >
              {deg}°
            </button>
          ))}
        </div>
      </section>

      <section className={s.sectionCard}>
        <div className={s.sectionHead}>
          <span className={s.sectionLabel}>위치</span>
          <span className={s.sectionUnit}>m</span>
        </div>
        <div className={s.grid2}>
          <NumberField label="X" value={f.x} step={0.05} unit="m" size="sm" onCommit={(x) => a.patch(f.id, { x })} />
          <NumberField label="Z" value={f.z} step={0.05} unit="m" size="sm" onCommit={(z) => a.patch(f.id, { z })} />
        </div>
      </section>

      <section className={s.sectionCard}>
        <button type="button" className={s.disclosure} aria-expanded={sizeOpen} onClick={() => setSizeOpen((o) => !o)}>
          <span className={s.disclosureLeft}>
            <span className={s.chevron} aria-hidden="true" />
            <span>크기</span>
          </span>
          <span className={s.disclosureDim}>{cm(w)}×{cm(d)}×{cm(h)} cm</span>
        </button>
        {sizeOpen && (
          <div className={s.sizeBody}>
            <div className={s.grid3}>
              <NumberField label="W" value={cm(w)} min={5} max={600} step={1} unit="cm" size="sm" onCommit={(v) => a.patch(f.id, { width: v / 100 })} />
              <NumberField label="D" value={cm(d)} min={5} max={600} step={1} unit="cm" size="sm" onCommit={(v) => a.patch(f.id, { depth: v / 100 })} />
              <NumberField label="H" value={cm(h)} min={5} max={400} step={1} unit="cm" size="sm" onCommit={(v) => a.patch(f.id, { height: v / 100 })} />
            </div>
            {hasCustomSize && (
              <Button
                size="sm"
                variant="ghost"
                className={s.resetBtn}
                onClick={() => a.patch(f.id, { width: undefined, depth: undefined, height: undefined })}
              >
                기본 크기로
              </Button>
            )}
          </div>
        )}
      </section>

      <div className={s.actionBar}>
        <div className={s.actions}>
          <Button size="sm" variant="secondary" icon={<FocusIcon />} onClick={() => a.scene()?.focusFurniture?.(f.id)}>보기</Button>
          <Button size="sm" variant="secondary" icon={<CopyIcon />} onClick={() => a.duplicate(f.id)}>복제</Button>
          <Button size="sm" variant="danger" icon={<TrashIcon />} onClick={() => a.remove(f.id)}>삭제</Button>
        </div>
        <Button size="sm" variant="ghost" block onClick={() => a.select(null)}>선택 해제 (Esc)</Button>
      </div>
    </div>
  );

  return (
    <div className={s.inspector}>
      <Tabs
        aria-label="배치 정보"
        fill
        value={tab}
        onChange={setTab}
        panelClassName={s.tabPanel}
        items={[
          { value: 'props', label: '속성', panel: propsPanel },
          placedTab,
        ]}
      />
    </div>
  );
}
