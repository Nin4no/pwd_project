import type { ReactNode } from 'react';
import { Button } from '../../../design/components';
import type { PlanTool } from '../../../engine/floorplan';
import { useStudio } from '../context';
import { DoorIcon, EraseIcon, FitIcon, PhotoIcon, RectIcon, SelectIcon, TrashIcon, WallIcon } from '../icons';
import { usePlanUi } from './PlanContext';
import s from './Plan.module.css';

export const PLAN_TOOLS: ReadonlyArray<{ tool: PlanTool; key: string; label: string; icon: ReactNode; hint: string }> = [
  { tool: 'select', key: '1', label: '선택', icon: <SelectIcon />, hint: '꼭짓점·벽·문을 드래그해 옮겨요. 빈 곳 드래그는 화면 이동' },
  { tool: 'wall', key: '2', label: '벽', icon: <WallIcon />, hint: '클릭으로 벽을 이어 그려요. 시작점을 누르면 닫히고, Esc로 끝내요' },
  { tool: 'rect', key: '3', label: '사각형', icon: <RectIcon />, hint: '코너에서 드래그하면 사각형 방, 벽 위에서 드래그하면 이어 붙여요' },
  { tool: 'door', key: '4', label: '문', icon: <DoorIcon />, hint: '벽을 클릭해 문을 달아요. 문 클릭은 경첩, Shift+클릭은 열림 방향' },
  { tool: 'erase', key: '5', label: '지우개', icon: <EraseIcon />, hint: '지울 벽이나 문을 클릭해요' },
];

/** 2D 좌측 패널: 도구 5종 + 맞춤·전체 지우기·배경 사진·사진으로 만들기 */
export default function PlanToolbar() {
  const { state: ui, actions } = usePlanUi();
  const setPanel = useStudio((st) => st.setPanel);
  const editor = ui.editor;

  const clearAll = () => {
    if (!editor) return;
    if (window.confirm('도면의 벽과 문을 모두 지울까요? (되돌리기로 복구할 수 있어요)')) editor.clear();
  };

  return (
    <div className={s.toolbar}>
      <header className={s.panelHeader}>
        <h2 className={s.panelTitle}>도면 도구</h2>
        <span className={s.panelMeta}>1–5</span>
      </header>

      <div className={s.panelBody}>
        <section className={s.section}>
          <p className={s.sectionLabel}>도구</p>
          <div className={s.tools} role="toolbar" aria-label="도면 도구">
            {PLAN_TOOLS.map((t) => (
              <button
                key={t.tool}
                type="button"
                className={s.tool}
                aria-pressed={ui.tool === t.tool}
                onClick={() => editor?.setTool(t.tool)}
                disabled={!editor}
                title={`${t.label} (${t.key})`}
              >
                <span className={s.toolIcon} aria-hidden="true">{t.icon}</span>
                <span className={s.toolLabel}>{t.label}</span>
                <kbd className={s.kbd}>{t.key}</kbd>
              </button>
            ))}
          </div>
        </section>

        <section className={s.section}>
          <p className={s.sectionLabel}>보기</p>
          <div className={s.stack}>
            <Button variant="secondary" size="sm" block icon={<FitIcon />} onClick={() => editor?.fitToContent()} disabled={!editor} title="화면 맞춤 (F)">
              화면 맞춤
            </Button>
            {ui.photo && (
              <Button variant="secondary" size="sm" block icon={<PhotoIcon />} onClick={() => actions.setPhoto({ ...ui.photo!, visible: !ui.photo!.visible })} aria-pressed={ui.photo.visible}>
                배경 사진 {ui.photo.visible ? '숨기기' : '보이기'}
              </Button>
            )}
            <Button variant="ghost" size="sm" block icon={<TrashIcon />} onClick={clearAll} disabled={!editor}>
              전체 지우기
            </Button>
          </div>
        </section>

        <div className={s.photoCta}>
          <p className={s.ctaTitle}>AI 사진 변환</p>
          <p className={s.ctaText}>방 사진 한 장으로 도면과 가구를 자동으로 만들어요.</p>
          <Button variant="primary" size="sm" block icon={<PhotoIcon />} onClick={() => setPanel('photoWizard', true)}>
            사진으로 만들기
          </Button>
        </div>
      </div>
    </div>
  );
}
