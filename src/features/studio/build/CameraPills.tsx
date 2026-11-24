import { Badge, Segmented } from '../../../design/components';
import type { CameraMode } from '../../../engine/webgl/camera';
import type { LightingPreset } from '../../../engine/webgl/lighting';
import { useStudio } from '../context';
import s from './CameraPills.module.css';

const CAMS: { value: CameraMode; label: string }[] = [
  { value: 'orbit', label: '3D' },
  { value: 'top', label: '탑뷰' },
  { value: 'walk', label: '걷기' },
];

const LIGHTS: { value: LightingPreset; label: string }[] = [
  { value: 'daylight', label: '주간' },
  { value: 'afternoon', label: '오후' },
  { value: 'night', label: '야간' },
];

/** 3D 캔버스 하단 중앙 플로팅 독: 카메라 3종 · 조명 무드 3종 · 스냅 토글 · 충돌 배지 */
export default function CameraPills() {
  const cameraMode = useStudio((st) => st.cameraMode);
  const lightingPreset = useStudio((st) => st.lightingPreset);
  const walkLocked = useStudio((st) => st.walkLocked);
  const collisionCount = useStudio((st) => st.collisions.size);
  const snap = useStudio((st) => st.snap);
  const setCamera = useStudio((st) => st.setCamera);
  const setLighting = useStudio((st) => st.setLighting);
  const setSnap = useStudio((st) => st.setSnap);

  return (
    <div className={s.pills}>
      {cameraMode === 'walk' && (
        <p className={s.walkHint} role="status">
          {walkLocked ? 'WASD로 이동, 마우스로 둘러보기 (Esc로 잠금 해제)' : '화면을 클릭하면 걷기 시점이 잠겨요'}
        </p>
      )}
      <div className={s.pillRow}>
        <Segmented aria-label="카메라" size="sm" options={CAMS} value={cameraMode} onChange={setCamera} />
        <span className={s.divider} aria-hidden="true" />
        <Segmented aria-label="조명 분위기" size="sm" options={LIGHTS} value={lightingPreset} onChange={setLighting} />
        <span className={s.divider} aria-hidden="true" />
        <button type="button" className={s.pill} aria-pressed={snap} onClick={() => setSnap(!snap)}>
          벽에 붙이기
        </button>
        {collisionCount > 0 && <Badge tone="danger">충돌 {collisionCount}</Badge>}
      </div>
    </div>
  );
}
