import { useState } from 'react';
import { Badge, Button, Sheet } from '../../../design/components';
import { aiLayoutRecommender, ROOM_PRESETS, type LayoutRecommendation, type RoomPresetId } from '../../../engine/layout/recommender';
import { useStudio, useStudioStoreApi } from '../context';
import s from './Ai.module.css';

/** AI 배치 추천: 프리셋 4종 + 기존 가구 유지 → 미리보기(점수·이유) → 적용 / 되돌리기(undo) */
export default function RecommendDrawer() {
  const store = useStudioStoreApi();
  const open = useStudio((st) => st.panels.ai === 'recommend');
  const busy = useStudio((st) => st.busy === 'recommending');
  const [preset, setPreset] = useState<RoomPresetId>('studio_full');
  const [keep, setKeep] = useState(false);
  const [rec, setRec] = useState<LayoutRecommendation | null>(null);
  const [applied, setApplied] = useState(false);
  const [error, setError] = useState('');

  const close = () => store.getState().setPanel('ai', null);
  const run = () => {
    const a = store.getState();
    if (!a.room) return;
    a.setBusy('recommending');
    setError('');
    setApplied(false);
    // 솔버가 동기라 스피너가 먼저 그려지도록 한 프레임 양보
    setTimeout(() => {
      try {
        const room = store.getState().room;
        if (room) setRec(aiLayoutRecommender.recommendLayout(room, preset, keep));
      } catch (err) {
        setError(err instanceof Error ? err.message : '추천을 만들지 못했어요.');
      } finally {
        store.getState().setBusy(null);
      }
    }, 0);
  };
  const apply = () => {
    if (!rec) return;
    const a = store.getState();
    a.applyLayout(rec.placed, keep);
    if (a.mode !== 'build') a.setMode('build');
    setApplied(true);
  };
  const revert = () => {
    store.getState().undo();
    setApplied(false);
  };

  return (
    <Sheet
      open={open}
      onClose={close}
      title="AI 배치 추천"
      description="방 모양과 면적을 분석해 가구 배치를 제안해요."
      footer={
        applied ? (
          <>
            <Button variant="secondary" onClick={revert}>되돌리기</Button>
            <Button onClick={close}>완료</Button>
          </>
        ) : rec ? (
          <>
            <Button variant="secondary" onClick={run} loading={busy}>다시 추천</Button>
            <Button onClick={apply}>적용</Button>
          </>
        ) : (
          <Button onClick={run} loading={busy}>추천받기</Button>
        )
      }
    >
      <div className={s.presets} role="radiogroup" aria-label="방 유형">
        {ROOM_PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            role="radio"
            aria-checked={preset === p.id}
            className={s.preset}
            onClick={() => { setPreset(p.id); setRec(null); setApplied(false); }}
          >
            <strong>{p.label}</strong>
            <span className={s.desc}>{p.description}</span>
            <span className={s.items}>{p.items.join(' · ')}</span>
          </button>
        ))}
      </div>
      <label className={s.toggle}>
        <input type="checkbox" checked={keep} onChange={(e) => { setKeep(e.currentTarget.checked); setRec(null); }} />
        기존 가구 유지하고 빈 곳만 채우기
      </label>

      {error && <p className={s.notice} role="alert">{error}</p>}
      {rec && (
        <section className={s.result} aria-live="polite">
          <div className={s.resultHead}>
            <strong>{rec.preset.label}</strong>
            <Badge tone="ai">점수 {Math.round(rec.score)}</Badge>
            {applied && <Badge tone="success">적용됨</Badge>}
          </div>
          <p className={s.desc}>{rec.summary}</p>
          <ul className={s.notes}>
            {rec.reasons.map((r, i) => (
              <li key={`${r.furnitureName}-${i}`}><strong>{r.furnitureName}</strong> — {r.reason}</li>
            ))}
          </ul>
        </section>
      )}
    </Sheet>
  );
}
