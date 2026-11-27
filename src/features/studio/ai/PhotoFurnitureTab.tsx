import { useCallback, useEffect, useId, useRef, useState, type DragEvent, type FormEvent } from 'react';
import { Badge, Button, Field } from '../../../design/components';
import type { CatalogRegistry } from '../../../domain/catalog';
import type { FurnitureCategory } from '../../../domain/types';
import type { AiApi } from '../../../services/api';
import { useStudio, useStudioStoreApi } from '../context';
import { PhotoIcon } from '../icons';
import { preparePhoto } from '../photo/photoAnalysis';
import { extractImageFromDataTransfer, readImageFromClipboard } from './clipboardImage';
import PhotoCropBox from './PhotoCropBox';
import { extractFurnitureFromPhoto, renderCroppedDataUrl, type NormalizedCrop, type PhotoExtractedFurniture } from './photoFurnitureGen';
import s from './Ai.module.css';

type PreparedPhoto = Awaited<ReturnType<typeof preparePhoto>>;
interface Props {
  catalog: CatalogRegistry;
  ai: Partial<Pick<AiApi, 'generateFurnitureFromPhoto'>>;
  onPlaced: () => void;
}

const FULL_CROP: NormalizedCrop = { x: 0, y: 0, w: 1, h: 1 };
const cm = (m: number) => Math.round(m * 100);
const CATEGORIES: { value: '' | FurnitureCategory; label: string }[] = [
  { value: '', label: '자동 인식' }, { value: 'bed', label: '침대' }, { value: 'desk', label: '책상' },
  { value: 'storage', label: '수납' }, { value: 'seating', label: '의자·소파' }, { value: 'table', label: '테이블' },
  { value: 'lighting', label: '조명' }, { value: 'window', label: '창문' }, { value: 'door', label: '문' },
  { value: 'appliance', label: '가전' },
];
const UNAVAILABLE_PHOTO_AI: Pick<AiApi, 'generateFurnitureFromPhoto'> = {
  generateFurnitureFromPhoto: async () => {
    throw Object.assign(new Error('사진 추출 API가 연결되지 않았어요.'), { response: { status: 503 } });
  },
};

/** 사진에서 단일 가구 크롭·힌트 입력 → 3D 추출 → 카탈로그 등록 & 배치 */
export default function PhotoFurnitureTab({ catalog, ai, onPlaced }: Props) {
  const store = useStudioStoreApi();
  const drawerOpen = useStudio((st) => st.panels.ai === 'generate');
  const busy = useStudio((st) => st.busy === 'generating');
  const catId = useId();
  const widthId = useId();
  const fileRef = useRef<HTMLInputElement>(null);
  const dropRef = useRef<HTMLDivElement>(null);
  const seqRef = useRef(0);

  const [photo, setPhoto] = useState<PreparedPhoto | null>(null);
  const [crop, setCrop] = useState<NormalizedCrop>(FULL_CROP);
  const [hintName, setHintName] = useState('');
  const [category, setCategory] = useState<'' | FurnitureCategory>('');
  const [widthCm, setWidthCm] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<PhotoExtractedFurniture | null>(null);
  const [editedName, setEditedName] = useState('');

  const pickFile = useCallback(async (file: File | undefined) => {
    if (!file) return;
    setError('');
    try {
      setPhoto(await preparePhoto(file));
      setCrop(FULL_CROP);
      setResult(null);
      setEditedName('');
    } catch (err) {
      setError(err instanceof Error ? err.message : '사진을 열지 못했어요.');
    }
  }, []);

  const pasteFromClipboard = async () => {
    if (busy) return;
    setError('');
    try {
      const file = await readImageFromClipboard();
      if (!file) {
        setError('클립보드에 복사된 이미지가 없어요.');
        return;
      }
      await pickFile(file);
    } catch (err) {
      setError(err instanceof Error ? err.message : '클립보드에서 이미지를 불러오지 못했어요.');
    }
  };

  useEffect(() => {
    if (!drawerOpen || busy) return;
    const onPaste = (e: ClipboardEvent) => {
      const imageFile = extractImageFromDataTransfer(e.clipboardData);
      const target = e.target as HTMLElement | null;
      const typing = !!target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
      if (imageFile) {
        e.preventDefault();
        void pickFile(imageFile);
        return;
      }
      if (!typing && target && (target === dropRef.current || dropRef.current?.contains(target))) {
        setError('클립보드에 복사된 이미지가 없어요.');
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [drawerOpen, busy, pickFile]);

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(false);
    if (!busy) void pickFile(extractImageFromDataTransfer(e.dataTransfer) ?? e.dataTransfer.files[0]);
  };

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!photo || busy) return;

    let knownWidthCm: number | undefined;
    const rawW = widthCm.trim();
    if (rawW !== '') {
      const n = Number(rawW);
      if (!Number.isFinite(n) || n < 10 || n > 600) {
        setError('가로 실측은 10~600 cm 범위로 입력해 주세요.');
        return;
      }
      knownWidthCm = n;
    }

    setError('');
    setResult(null);
    const mySeq = ++seqRef.current;
    store.getState().setBusy('generating');
    try {
      const imageDataUrl = renderCroppedDataUrl(photo.image, crop);
      const photoAi = ai.generateFurnitureFromPhoto
        ? { generateFurnitureFromPhoto: ai.generateFurnitureFromPhoto }
        : UNAVAILABLE_PHOTO_AI;
      const extracted = await extractFurnitureFromPhoto(photoAi, {
        imageDataUrl,
        hintName: hintName.trim() || undefined,
        knownWidthCm,
        preferredCategory: category || undefined,
      });
      if (mySeq !== seqRef.current) return;
      setResult(extracted);
      setEditedName(extracted.spec.name);
    } catch (err) {
      if (mySeq === seqRef.current) {
        setResult(null);
        setError(err instanceof Error && err.message ? err.message : '사진에서 가구를 추출하지 못했어요.');
      }
    } finally {
      if (mySeq === seqRef.current) store.getState().setBusy(null);
    }
  };

  const placeNow = () => {
    if (!result) return;
    const spec = catalog.addUserFurniture({ ...result.spec, name: editedName.trim() || result.spec.name });
    const a = store.getState();
    if (a.mode !== 'build') a.setMode('build');
    a.place(spec.id, { x: 0, z: 0 });
    onPlaced();
  };

  const confPct = result?.confidence != null
    ? Math.round(result.confidence <= 1 ? result.confidence * 100 : result.confidence)
    : null;

  return (
    <div className={s.form}>
      <input ref={fileRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { const f = e.currentTarget.files?.[0]; e.currentTarget.value = ''; void pickFile(f); }} />
      {!photo ? (
        <div
          ref={dropRef}
          tabIndex={0}
          className={s.dropzone}
          data-over={dragOver || undefined}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
        >
          <span className={s.dropIcon} aria-hidden="true"><PhotoIcon /></span>
          <p className={s.dropTitle}>가구 사진을 올려 주세요</p>
          <p className={s.desc}>파일 선택·드래그하거나 Ctrl+V로 클립보드 이미지를 붙여넣으세요.</p>
          <div className={s.dropActions}>
            <Button variant="secondary" onClick={() => fileRef.current?.click()}>사진 고르기</Button>
            <Button variant="secondary" onClick={() => void pasteFromClipboard()}>클립보드 붙여넣기</Button>
          </div>
        </div>
      ) : (
        <form className={s.form} onSubmit={submit}>
          <div className={s.cropHeader}>
            <span className={s.cropHeading}>추출할 가구만 드래그해 감싸 주세요</span>
            <div className={s.cropActions}>
              <Button size="sm" variant="secondary" onClick={() => void pasteFromClipboard()} disabled={busy}>붙여넣기</Button>
              <Button size="sm" variant="secondary" onClick={() => fileRef.current?.click()} disabled={busy}>사진 바꾸기</Button>
            </div>
          </div>
          <PhotoCropBox
            src={photo.dataUrl}
            crop={crop}
            onChange={(next) => { setCrop(next); if (result) setResult(null); if (error) setError(''); }}
            disabled={busy}
          />
          <div className={s.hintsGrid}>
            <Field
              className={s.hintFull}
              label="가구 이름 (선택)"
              placeholder="예: 원목 암체어"
              value={hintName}
              onChange={(e) => { setHintName(e.currentTarget.value); if (error) setError(''); }}
              disabled={busy}
            />
            <div className={s.subField}>
              <label htmlFor={catId} className={s.subLabel}>카테고리 (선택)</label>
              <select
                id={catId}
                className={s.select}
                value={category}
                onChange={(e) => { setCategory(e.currentTarget.value as '' | FurnitureCategory); if (error) setError(''); }}
                disabled={busy}
              >
                {CATEGORIES.map((c) => <option key={c.value || 'auto'} value={c.value}>{c.label}</option>)}
              </select>
            </div>
            <div className={s.subField}>
              <label htmlFor={widthId} className={s.subLabel}>가로 실측 (선택)</label>
              <div className={`${s.numBox}${busy ? ` ${s.numDisabled}` : ''}`}>
                <input
                  id={widthId} type="number" inputMode="decimal" min={10} max={600} step={1} placeholder="예: 80" className={s.numInput}
                  value={widthCm} onChange={(e) => { setWidthCm(e.currentTarget.value); if (error) setError(''); }} disabled={busy}
                />
                <span className={s.numUnit} aria-hidden="true">cm</span>
              </div>
            </div>
          </div>

          {error && <p className={s.error} role="alert">{error}</p>}
          {!result && (
            <Button type="submit" variant="primary" block loading={busy} disabled={busy}>사진에서 3D 추출</Button>
          )}
          {busy && <p className={s.status} role="status">사진에서 가구 형태와 치수를 추출하고 있어요…</p>}
        </form>
      )}

      {!photo && error && <p className={s.error} role="alert">{error}</p>}

      {result && (
        <section className={s.result} aria-live="polite">
          <div className={s.resultHead}>
            <span className={s.swatch} style={{ background: result.spec.color }} aria-hidden="true" />
            <Badge tone={result.via === 'server' ? 'ai' : 'neutral'}>{result.via === 'server' ? 'AI 추출' : '기본 생성기'}</Badge>
            {confPct != null && <Badge tone="info">신뢰도 {confPct}%</Badge>}
          </div>
          <Field label="가구 이름" hideLabel value={editedName} onChange={(e) => setEditedName(e.currentTarget.value)} placeholder={result.spec.name} />
          <p className={s.mono}>
            {cm(result.spec.size[0])} × {cm(result.spec.size[1])} × {cm(result.spec.size[2])} cm
            {result.spec.material ? ` · ${result.spec.material}` : ''}
          </p>
          {result.reason && <p className={s.notice}>{result.reason} — 기본 생성기로 만들었어요.</p>}
          {result.description && <p className={s.desc}>{result.description}</p>}
          {result.notes.length > 0 && (
            <ul className={s.notes}>{result.notes.slice(0, 4).map((n, i) => <li key={`${n}-${i}`}>{n}</li>)}</ul>
          )}
          <div className={s.resultActions}>
            <Button variant="secondary" onClick={() => setResult(null)}>다시 추출</Button>
            <Button variant="primary" onClick={placeNow}>바로 배치</Button>
          </div>
        </section>
      )}
    </div>
  );
}
