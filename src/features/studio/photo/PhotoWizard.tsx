import { useRef, useState, type DragEvent } from 'react';
import { Badge, Button, Sheet, Spinner } from '../../../design/components';
import { applyRoomCalibration } from '../../../engine/vision/roomPrediction';
import type { AiFloorplanResult } from '../../../engine/vision/types';
import { aiApi, type AiApi } from '../../../services/api';
import { useStudio, useStudioStoreApi } from '../context';
import { usePlanUi } from '../plan/PlanContext';
import PhotoCalibrationStep from './PhotoCalibrationStep';
import { analyzePhoto, preparePhoto, type PhotoAnalysis } from './photoAnalysis';
import s from './Photo.module.css';

type Step = 'pick' | 'analyzing' | 'calibrate' | 'preview';
type Photo = Awaited<ReturnType<typeof preparePhoto>>;
const STEPS: Step[] = ['pick', 'analyzing', 'calibrate', 'preview'];
const STEP_LABEL: Record<Step, string> = { pick: '사진 선택', analyzing: '분석', calibrate: '보정', preview: '미리보기' };

/** 사진 → 방: ① 사진 선택 ② 분석(서버 → 로컬 폴백) ③ 보정 ④ 미리보기·적용 */
export default function PhotoWizard({ ai = aiApi }: { ai?: Pick<AiApi, 'analyzeRoomPhoto'> }) {
  const store = useStudioStoreApi();
  const open = useStudio((st) => st.panels.photoWizard);
  const { actions: plan } = usePlanUi();
  const [step, setStep] = useState<Step>('pick');
  const [photo, setPhoto] = useState<Photo | null>(null);
  const [analysis, setAnalysis] = useState<PhotoAnalysis | null>(null);
  const [result, setResult] = useState<AiFloorplanResult | null>(null);
  const [calibDesc, setCalibDesc] = useState('');
  const [error, setError] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const seq = useRef(0);

  const resetAll = () => { seq.current++; setStep('pick'); setPhoto(null); setAnalysis(null); setResult(null); setError(''); };
  const close = () => {
    if (store.getState().busy === 'analyzing') store.getState().setBusy(null);
    store.getState().setPanel('photoWizard', false);
    resetAll();
  };

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setError('');
    try {
      setPhoto(await preparePhoto(file));
    } catch (err) {
      setError(err instanceof Error ? err.message : '사진을 열지 못했어요.');
    }
  };
  const analyze = async () => {
    if (!photo) return;
    const my = ++seq.current;
    setStep('analyzing');
    store.getState().setBusy('analyzing');
    try {
      const a = await analyzePhoto(ai, photo);
      if (my !== seq.current) return;
      setAnalysis(a);
      setStep('calibrate');
    } catch (err) {
      if (my !== seq.current) return;
      setError(err instanceof Error ? err.message : '사진을 분석하지 못했어요.');
      setStep('pick');
    } finally {
      if (my === seq.current) store.getState().setBusy(null);
    }
  };
  const apply = () => {
    if (!result || !photo) return;
    const a = store.getState();
    a.applyPlan(result.walls, result.wallHeight, [], result.suggestedFurniture);
    plan.setPhoto({ image: photo.image, visible: true });
    store.getState().setMode('plan');
    close();
  };
  const onDrop = (e: DragEvent) => { e.preventDefault(); setDragOver(false); void pick(e.dataTransfer.files[0]); };

  const bounds = result ? (() => {
    const xs = result.walls.flatMap((w) => [w.a.x, w.b.x]);
    const ys = result.walls.flatMap((w) => [w.a.y, w.b.y]);
    return { w: Math.max(...xs) - Math.min(...xs), d: Math.max(...ys) - Math.min(...ys) };
  })() : null;

  return (
    <Sheet open={open} onClose={close} title="사진으로 방 만들기" description="방 사진 한 장으로 벽과 가구 배치를 추정해요." width="lg">
      <ol className={s.steps} aria-label="진행 단계">
        {STEPS.map((st, i) => (
          <li key={st} className={s.stepDot} aria-current={st === step ? 'step' : undefined}>
            <span>{i + 1}</span> {STEP_LABEL[st]}
          </li>
        ))}
      </ol>

      {step === 'pick' && (
        <div className={s.step}>
          <div
            className={s.drop}
            data-over={dragOver || undefined}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
          >
            {photo ? (
              <img className={s.preview} src={photo.dataUrl} alt="선택한 방 사진 미리보기" />
            ) : (
              <p className={s.sub}>사진을 여기에 끌어다 놓거나 아래 버튼으로 골라 주세요.<br />방 안쪽 벽과 바닥이 함께 보이는 사진이 좋아요.</p>
            )}
            <input ref={inputRef} type="file" accept="image/*" hidden onChange={(e) => void pick(e.currentTarget.files?.[0])} />
            <Button variant="secondary" onClick={() => inputRef.current?.click()}>{photo ? '다른 사진 고르기' : '사진 고르기'}</Button>
          </div>
          {error && <p className={s.error} role="alert">{error}</p>}
          <div className={s.row}>
            <Button onClick={() => void analyze()} disabled={!photo}>분석하기</Button>
          </div>
        </div>
      )}

      {step === 'analyzing' && (
        <div className={s.center}>
          <Spinner size="lg" label="사진 분석 중" />
          <p className={s.sub}>벽과 바닥, 가구를 찾고 있어요…</p>
        </div>
      )}

      {step === 'calibrate' && photo && analysis && (
        <PhotoCalibrationStep
          imageUrl={photo.dataUrl}
          onBack={() => setStep('pick')}
          onConfirm={(calib, desc) => { setResult(applyRoomCalibration(analysis.result, calib)); setCalibDesc(desc); setStep('preview'); }}
        />
      )}

      {step === 'preview' && result && analysis && (
        <div className={s.step}>
          <div className={s.badges}>
            <Badge tone={analysis.via === 'server' ? 'ai' : 'neutral'}>{analysis.via === 'server' ? 'AI 분석' : '로컬 분석'}</Badge>
            <Badge tone="info">{calibDesc}</Badge>
          </div>
          {analysis.reason && <p className={s.sub}>{analysis.reason} — 브라우저 안에서 분석했어요.</p>}
          <dl className={s.stats}>
            {bounds && (<><dt>방 크기</dt><dd>{bounds.w.toFixed(2)} × {bounds.d.toFixed(2)} m</dd></>)}
            <dt>천장 높이</dt><dd>{result.wallHeight.toFixed(2)} m</dd>
            <dt>벽</dt><dd>{result.walls.length}개</dd>
            <dt>추천 가구</dt><dd>{result.suggestedFurniture.length}개</dd>
          </dl>
          <p className={s.sub}>{result.summary}</p>
          <p className={s.warn}>적용하면 지금 도면이 바뀌어요. 되돌리기(Ctrl+Z)로 복구할 수 있어요.</p>
          <div className={s.row}>
            <Button variant="secondary" onClick={() => setStep('calibrate')}>보정 다시</Button>
            <Button onClick={apply}>도면에 적용</Button>
          </div>
        </div>
      )}
    </Sheet>
  );
}
