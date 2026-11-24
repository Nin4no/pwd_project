import s from './Home.module.css';

export interface RoomTemplate {
  key: string;
  label: string;
  w: number;
  d: number;
  h: number;
}

/** 빠른 시작 템플릿 (현행 QUICK_TEMPLATES 치수 유지) */
export const ROOM_TEMPLATES: RoomTemplate[] = [
  { key: 'studio', label: '원룸', w: 3.5, d: 4.0, h: 2.4 },
  { key: 'bedroom', label: '침실', w: 4.5, d: 4.0, h: 2.4 },
  { key: 'office', label: '서재', w: 4.0, d: 4.5, h: 2.5 },
  { key: 'living', label: '거실', w: 5.5, d: 4.5, h: 2.6 },
];

const pyeong = (t: RoomTemplate) => ((t.w * t.d) / 3.3058).toFixed(1);

export default function TemplateChips({ onPick }: { onPick: (t: RoomTemplate) => void }) {
  return (
    <div className={s.templates} role="group" aria-label="템플릿으로 시작">
      <span className={s.templatesLabel}>템플릿으로 시작</span>
      <div className={s.chips}>
        {TEMPLATES_VIEW.map(({ t, title }) => (
          <button key={t.key} type="button" className={s.chip} onClick={() => onPick(t)} title={title}>
            <span className={s.chipLabel}>{t.label}</span>
            <span className={`${s.chipDim} num`}>
              {t.w}×{t.d}m
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

const TEMPLATES_VIEW = ROOM_TEMPLATES.map((t) => ({ t, title: `${t.w} × ${t.d}m (${pyeong(t)}평) 방을 바로 3D로 열기` }));
