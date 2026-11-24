import { useEffect, useState } from 'react';
import { Segmented } from '../../design/components';
import { useStudio } from './context';
import type { StudioMode } from './types';
import s from './TopBar.module.css';

const HINT_KEY = 'dyr:hint:mode';
const MODES: { value: StudioMode; label: string }[] = [
  { value: 'plan', label: '2D 도면' },
  { value: 'build', label: '3D 배치' },
];

const seen = () => { try { return localStorage.getItem(HINT_KEY) === '1'; } catch { return true; } };
const markSeen = () => { try { localStorage.setItem(HINT_KEY, '1'); } catch { /* 저장 공간 제한 무시 */ } };

/** 2D 도면 / 3D 배치 전환 (M). 첫 진입 시 힌트 1회 */
export default function ModeSwitch() {
  const mode = useStudio((st) => st.mode);
  const setMode = useStudio((st) => st.setMode);
  const [hint, setHint] = useState(() => !seen());

  useEffect(() => {
    if (!hint) return;
    const t = setTimeout(() => { setHint(false); markSeen(); }, 6000);
    return () => clearTimeout(t);
  }, [hint]);

  const change = (m: StudioMode) => {
    setMode(m);
    if (hint) { setHint(false); markSeen(); }
  };

  return (
    <div className={s.modeWrap}>
      <Segmented aria-label="편집 모드" options={MODES} value={mode} onChange={change} />
      {hint && (
        <p className={s.modeHint} role="status">
          벽은 2D 도면에서, 가구는 3D 배치에서 편집해요. (M 키로 전환)
        </p>
      )}
    </div>
  );
}
