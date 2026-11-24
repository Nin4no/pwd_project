import { useState, type MouseEvent } from 'react';
import { Button, Field, Segmented, Tabs } from '../../../design/components';
import type { RoomCalibration, RoomDimensionKind } from '../../../engine/vision/roomCalibration';
import { buildCalibration, CORNER_NAMES, normalizePoint, type CalibrationTab } from './calibrationMath';
import s from './Photo.module.css';

interface Props {
  imageUrl: string;
  onConfirm: (calibration: RoomCalibration | undefined, desc: string) => void;
  onBack: () => void;
}

const DIMS: { value: RoomDimensionKind; label: string }[] = [
  { value: 'width', label: '가로' },
  { value: 'depth', label: '세로' },
  { value: 'height', label: '천장높이' },
];
const EDGES: { value: '0' | '1'; label: string }[] = [
  { value: '0', label: '안쪽 벽 (좌안–우안)' },
  { value: '1', label: '우측 벽 (우안–우앞)' },
];

/** 사진 스케일 보정 (구 PhotoCalibration 이식): 아는 치수 / 바닥 4점 / 건너뛰기 */
export default function PhotoCalibrationStep({ imageUrl, onConfirm, onBack }: Props) {
  const [tab, setTab] = useState<CalibrationTab>('dimension');
  const [dimKind, setDimKind] = useState<RoomDimensionKind>('width');
  const [dimMeters, setDimMeters] = useState('3.2');
  const [corners, setCorners] = useState<[number, number][]>([]);
  const [edgeIndex, setEdgeIndex] = useState<0 | 1>(0);
  const [edgeMeters, setEdgeMeters] = useState('3.0');
  const [error, setError] = useState<string | null>(null);

  const switchTab = (t: CalibrationTab) => { setTab(t); setError(null); };
  const addCorner = (e: MouseEvent<HTMLDivElement>) => {
    if (corners.length >= 4) return;
    const r = e.currentTarget.getBoundingClientRect();
    setCorners((c) => [...c, normalizePoint(e.clientX - r.left, e.clientY - r.top, r.width, r.height)]);
    setError(null);
  };
  const submit = () => {
    const out = buildCalibration({ tab, dimKind, dimMeters, corners, edgeIndex, edgeMeters });
    if (!out.ok) setError(out.error);
    else onConfirm(out.calibration, out.desc);
  };

  const dimension = (
    <div className={s.calibBody}>
      <p className={s.sub}>방의 가로·세로·천장높이 중 정확히 아는 치수 하나를 입력하세요.</p>
      <Segmented aria-label="치수 종류" size="sm" options={DIMS} value={dimKind} onChange={setDimKind} />
      <Field
        label="실측 길이 (m)"
        type="number"
        step="0.1"
        min="0.6"
        max="19.9"
        inputMode="decimal"
        value={dimMeters}
        onChange={(e) => { setDimMeters(e.currentTarget.value); setError(null); }}
        onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
      />
      <img className={s.preview} src={imageUrl} alt="선택한 방 사진" />
    </div>
  );

  const pts = corners.map(([u, v]) => `${u * 100},${v * 100}`).join(' ');
  const cornersPanel = (
    <div className={s.calibBody}>
      <p className={s.sub} aria-live="polite">
        {corners.length < 4
          ? `${corners.length + 1}번째: ${CORNER_NAMES[corners.length]} 모서리를 사진에서 클릭하세요. (${corners.length}/4)`
          : '모서리 4점을 모두 찍었어요. 기준 변과 실측 길이를 확인하세요.'}
      </p>
      <div className={s.pickWrap} onClick={addCorner} role="button" tabIndex={-1} aria-label="사진에서 바닥 모서리 찍기">
        <img className={s.preview} src={imageUrl} alt="바닥 모서리를 찍을 방 사진" draggable={false} />
        <svg className={s.overlay} viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          {corners.length > 1 && <polyline className={s.poly} points={corners.length === 4 ? `${pts} ${corners[0][0] * 100},${corners[0][1] * 100}` : pts} />}
          {corners.map(([u, v], i) => <circle key={i} className={s.dot} cx={u * 100} cy={v * 100} r={1.4} />)}
        </svg>
      </div>
      <div className={s.row}>
        <Button size="sm" variant="ghost" onClick={() => setCorners((c) => c.slice(0, -1))} disabled={!corners.length}>한 점 취소</Button>
        <Button size="sm" variant="ghost" onClick={() => setCorners([])} disabled={!corners.length}>다시 찍기</Button>
      </div>
      <Segmented aria-label="기준 변" size="sm" options={EDGES} value={String(edgeIndex) as '0' | '1'} onChange={(v) => setEdgeIndex(v === '1' ? 1 : 0)} />
      <Field
        label="기준 변 실측 길이 (m)"
        type="number"
        step="0.1"
        min="0.6"
        max="19.9"
        inputMode="decimal"
        value={edgeMeters}
        onChange={(e) => { setEdgeMeters(e.currentTarget.value); setError(null); }}
      />
    </div>
  );

  const skip = (
    <div className={s.calibBody}>
      <p className={s.sub}>보정 없이 사진만으로 크기를 추정해요. 나중에 2D 도면에서 벽을 직접 고칠 수 있어요.</p>
    </div>
  );

  return (
    <div className={s.step}>
      <Tabs
        aria-label="보정 방식"
        value={tab}
        onChange={switchTab}
        fill
        items={[
          { value: 'dimension', label: '아는 치수', panel: dimension },
          { value: 'corners', label: '바닥 4점', panel: cornersPanel },
          { value: 'skip', label: '건너뛰기', panel: skip },
        ]}
      />
      {error && <p className={s.error} role="alert">{error}</p>}
      <div className={s.row}>
        <Button variant="secondary" onClick={onBack}>이전</Button>
        <Button onClick={submit}>{tab === 'skip' ? '건너뛰고 미리보기' : '보정 적용'}</Button>
      </div>
    </div>
  );
}
