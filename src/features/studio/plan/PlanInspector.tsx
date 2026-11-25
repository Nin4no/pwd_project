import { useMemo } from 'react';
import { Badge, Button, NumberField } from '../../../design/components';
import { useStudio } from '../context';
import { TrashIcon } from '../icons';
import { usePlanUi } from './PlanContext';
import { PLAN_TOOLS } from './PlanToolbar';
import s from './Plan.module.css';

const HINGE = { left: '왼쪽', right: '오른쪽' } as const;
const DIR = { in: '안쪽', out: '바깥쪽' } as const;

/** 2D 우측 패널: 벽 높이·면적 요약·선택 문 속성·도구 힌트 */
export default function PlanInspector() {
  const { state: ui, actions } = usePlanUi();
  const wallHeight = useStudio((st) => st.room?.wallHeight ?? 2.4);
  const outsideCount = useStudio((st) => st.outside.length);
  const editor = ui.editor;

  // revision이 바뀔 때마다(onChange) 다시 계산
  const summary = useMemo(() => editor?.summary() ?? null, [editor, ui.revision]); // eslint-disable-line react-hooks/exhaustive-deps
  const bounds = summary?.bounds ?? null;
  const door = useMemo(
    () => (editor && ui.doorId ? editor.getDocument().doors.find((d) => d.id === ui.doorId) ?? null : null),
    [editor, ui.doorId, ui.revision], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const swing = door?.swing ?? { hinge: 'left' as const, dir: 'in' as const };
  const tool = PLAN_TOOLS.find((t) => t.tool === ui.tool);

  return (
    <div className={s.inspector}>
      <header className={s.panelHeader}>
        <h2 className={s.panelTitle}>도면 속성</h2>
        {summary && (
          <span className={s.panelMeta} data-tone={summary.closed ? 'ready' : undefined}>
            {summary.closed ? '닫힘' : '작성 중'}
          </span>
        )}
      </header>

      <div className={s.panelBody}>
        <section className={s.section}>
          <div className={s.sectionHead}>
            <p className={s.sectionLabel}>방 크기</p>
            <span className={s.sectionUnit}>0.01m</span>
          </div>
          {bounds ? (
            <div className={s.dimGrid}>
              <NumberField
                label="가로"
                size="sm"
                unit="m"
                min={0.3}
                max={50}
                step={0.01}
                precision={2}
                commitMode="blur"
                value={+bounds.width.toFixed(2)}
                disabled={!editor || bounds.width < 1e-4}
                onCommit={(w) => editor?.resizeRoom({ width: w })}
              />
              <NumberField
                label="세로"
                size="sm"
                unit="m"
                min={0.3}
                max={50}
                step={0.01}
                precision={2}
                commitMode="blur"
                value={+bounds.depth.toFixed(2)}
                disabled={!editor || bounds.depth < 1e-4}
                onCommit={(d) => editor?.resizeRoom({ depth: d })}
              />
            </div>
          ) : (
            <p className={s.emptyNote}>벽이나 사각형을 먼저 그리면 가로·세로 크기를 0.01m 단위로 조절할 수 있어요.</p>
          )}
        </section>

        <section className={s.section}>
          <p className={s.sectionLabel}>벽 높이</p>
          <NumberField
            aria-label="벽 높이"
            value={wallHeight}
            min={2}
            max={5}
            step={0.1}
            unit="m"
            onCommit={(v) => editor?.setWallHeight(v)}
            disabled={!editor}
          />
        </section>

        <section className={s.section} aria-live="polite">
          <p className={s.sectionLabel}>면적</p>
          <div className={s.summaryCard}>
            {summary && summary.closed ? (
              <div className={s.areaMain}>
                <strong className={s.areaValue}>
                  {summary.area.toFixed(1)}
                  <span className={s.areaUnit}>㎡</span>
                </strong>
                <span className={s.areaSub}>{summary.pyeong.toFixed(1)}평</span>
              </div>
            ) : (
              <p className={s.areaEmpty}>벽을 닫으면 면적이 계산돼요.</p>
            )}
            {summary && (
              <dl className={s.stats}>
                {summary.bounds && (
                  <>
                    <dt>크기</dt>
                    <dd>{summary.bounds.width.toFixed(2)} × {summary.bounds.depth.toFixed(2)} m</dd>
                  </>
                )}
                <dt>벽</dt>
                <dd>{summary.wallCount}개</dd>
                <dt>문</dt>
                <dd>{summary.doorCount}개</dd>
              </dl>
            )}
          </div>
          {outsideCount > 0 && (
            <div className={s.alertRow}>
              <Badge tone="danger">방 밖 가구 {outsideCount}개</Badge>
            </div>
          )}
        </section>

        <section className={s.section}>
          <p className={s.sectionLabel}>선택한 문</p>
          {door ? (
            <div className={s.doorCard}>
              <dl className={s.doorSpecs}>
                <dt>경첩</dt>
                <dd>{HINGE[swing.hinge]}</dd>
                <dt>열림 방향</dt>
                <dd>{DIR[swing.dir]}</dd>
              </dl>
              <div className={s.doorActions}>
                <Button size="sm" variant="secondary" onClick={() => editor?.toggleDoorSwing(door.id, 'hinge')}>경첩 전환</Button>
                <Button size="sm" variant="secondary" onClick={() => editor?.toggleDoorSwing(door.id, 'dir')}>방향 전환</Button>
              </div>
              <Button size="sm" variant="ghost" block icon={<TrashIcon />} onClick={() => { editor?.removeDoor(door.id); actions.clearDoor(); }}>
                문 삭제
              </Button>
            </div>
          ) : (
            <p className={s.emptyNote}>문 위에 마우스를 올리거나 클릭하면 속성을 바꿀 수 있어요.</p>
          )}
        </section>

        <aside className={s.hint} data-active={ui.drawing ? 'true' : undefined} aria-live="polite">
          <p className={s.hintTitle}>{ui.drawing ? '그리는 중' : `${tool?.label ?? '도구'} 도구`}</p>
          <p className={s.hintText}>{ui.drawing ? 'Esc로 마치거나 취소해요.' : tool?.hint}</p>
        </aside>
      </div>
    </div>
  );
}
