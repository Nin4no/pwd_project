import type { AlignKind } from '../../../engine/layout/alignSnap';
import { ALIGN_GUIDE_STYLE } from '../../../engine/webgl/alignGuideStyle';
import s from './AlignSnapHud.module.css';

export interface AlignSnapHudStatus {
  dragging: boolean;
  shiftHeld: boolean;
  kindX: AlignKind | null;
  kindZ: AlignKind | null;
}

export interface AlignSnapHudProps {
  status: AlignSnapHudStatus | null;
}

const ALIGN_KIND_LABELS: Record<AlignKind, string> = {
  flush: '밀착',
  edge: '모서리 정렬',
  center: '중앙 정렬',
};

function renderAxisMatch(kind: AlignKind, axisLabel?: 'X' | 'Z') {
  const style = ALIGN_GUIDE_STYLE.kinds[kind];
  return (
    <span className={s.matchBadge}>
      <span
        className={s.dot}
        style={{ backgroundColor: style.hex }}
        aria-hidden="true"
      />
      {axisLabel ? <span className={s.axisTag}>{axisLabel}</span> : null}
      <span className={s.text}>{ALIGN_KIND_LABELS[kind]}</span>
    </span>
  );
}

/** 3D 가구 드래그 중 상단 중앙에 표시되는 스마트 정렬(Shift + 드래그) 상태 HUD */
export default function AlignSnapHud({ status }: AlignSnapHudProps) {
  if (!status?.dragging) return null;

  const { shiftHeld, kindX, kindZ } = status;
  const hasSnap = shiftHeld && (kindX !== null || kindZ !== null);
  const dualSnap = kindX !== null && kindZ !== null;

  const rootClass = hasSnap
    ? `${s.hud} ${s.hudSnapped}`
    : shiftHeld
      ? `${s.hud} ${s.hudArmed}`
      : s.hud;

  return (
    <div className={rootClass} role="status" aria-live="polite">
      <kbd className={shiftHeld ? `${s.kbd} ${s.kbdActive}` : s.kbd}>Shift</kbd>
      {!shiftHeld ? (
        <span className={s.text}>누른 채 드래그하면 가구 정렬</span>
      ) : !hasSnap ? (
        <span className={s.text}>가구 정렬 모드</span>
      ) : (
        <span className={s.matches}>
          {kindX !== null ? renderAxisMatch(kindX, dualSnap ? 'X' : undefined) : null}
          {dualSnap ? <span className={s.divider} aria-hidden="true" /> : null}
          {kindZ !== null ? renderAxisMatch(kindZ, dualSnap ? 'Z' : undefined) : null}
        </span>
      )}
    </div>
  );
}
