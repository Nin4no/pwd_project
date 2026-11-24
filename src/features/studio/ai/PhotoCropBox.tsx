import { useRef, type PointerEvent } from 'react';
import { Button } from '../../../design/components';
import type { NormalizedCrop } from './photoFurnitureGen';
import s from './Ai.module.css';

type Handle = 'nw' | 'ne' | 'sw' | 'se';
type DragMode = 'move' | Handle;

interface Props {
  src: string;
  alt?: string;
  crop: NormalizedCrop;
  onChange: (crop: NormalizedCrop) => void;
  disabled?: boolean;
}

const MIN_SIZE = 0.12;
const FULL_CROP: NormalizedCrop = { x: 0, y: 0, w: 1, h: 1 };
const HANDLES: readonly { id: Handle; label: string }[] = [
  { id: 'nw', label: '왼쪽 위 모서리 조절' },
  { id: 'ne', label: '오른쪽 위 모서리 조절' },
  { id: 'sw', label: '왼쪽 아래 모서리 조절' },
  { id: 'se', label: '오른쪽 아래 모서리 조절' },
];

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** 업로드한 사진에서 추출할 가구 영역을 드래그로 지정하는 크롭 박스 */
export default function PhotoCropBox({ src, alt = '업로드한 가구 사진', crop, onChange, disabled }: Props) {
  const frameRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    mode: DragMode;
    startX: number;
    startY: number;
    startCrop: NormalizedCrop;
    width: number;
    height: number;
  } | null>(null);

  const startDrag = (mode: DragMode, e: PointerEvent<HTMLElement>) => {
    if (disabled) return;
    e.preventDefault();
    e.stopPropagation();
    const rect = frameRef.current?.getBoundingClientRect();
    if (!rect || rect.width < 1 || rect.height < 1) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = {
      mode,
      startX: e.clientX,
      startY: e.clientY,
      startCrop: crop,
      width: rect.width,
      height: rect.height,
    };
  };

  const onPointerMove = (e: PointerEvent<HTMLElement>) => {
    const d = dragRef.current;
    if (!d) return;
    const dx = (e.clientX - d.startX) / d.width;
    const dy = (e.clientY - d.startY) / d.height;
    const { startCrop } = d;

    if (d.mode === 'move') {
      onChange({
        x: clamp(startCrop.x + dx, 0, 1 - startCrop.w),
        y: clamp(startCrop.y + dy, 0, 1 - startCrop.h),
        w: startCrop.w,
        h: startCrop.h,
      });
      return;
    }

    let left = startCrop.x;
    let top = startCrop.y;
    let right = startCrop.x + startCrop.w;
    let bottom = startCrop.y + startCrop.h;

    if (d.mode.includes('w')) left = clamp(startCrop.x + dx, 0, right - MIN_SIZE);
    if (d.mode.includes('e')) right = clamp(right + dx, left + MIN_SIZE, 1);
    if (d.mode.includes('n')) top = clamp(startCrop.y + dy, 0, bottom - MIN_SIZE);
    if (d.mode.includes('s')) bottom = clamp(bottom + dy, top + MIN_SIZE, 1);

    onChange({ x: left, y: top, w: right - left, h: bottom - top });
  };

  const endDrag = () => {
    dragRef.current = null;
  };

  const isCropped = crop.w < 0.99 || crop.h < 0.99;

  return (
    <div className={s.cropWrap}>
      <div className={s.cropStage}>
        <div ref={frameRef} className={s.cropFrame}>
          <img className={s.cropImg} src={src} alt={alt} draggable={false} />
          <div
            role="group"
            aria-label="가구 영역 선택"
            className={s.cropBox}
            data-disabled={disabled || undefined}
            style={{
              left: `${crop.x * 100}%`,
              top: `${crop.y * 100}%`,
              width: `${crop.w * 100}%`,
              height: `${crop.h * 100}%`,
            }}
            onPointerDown={(e) => startDrag('move', e)}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            onLostPointerCapture={endDrag}
          >
            <span className={`${s.cropGridV} ${s.cropGrid1}`} aria-hidden="true" />
            <span className={`${s.cropGridV} ${s.cropGrid2}`} aria-hidden="true" />
            <span className={`${s.cropGridH} ${s.cropGrid1}`} aria-hidden="true" />
            <span className={`${s.cropGridH} ${s.cropGrid2}`} aria-hidden="true" />
            {HANDLES.map(({ id, label }) => (
              <span
                key={id}
                role="slider"
                aria-label={label}
                aria-valuetext={`${Math.round(crop.w * 100)}% × ${Math.round(crop.h * 100)}%`}
                className={`${s.cropHandle} ${s[`handle_${id}`]}`}
                onPointerDown={(e) => startDrag(id, e)}
                onPointerMove={onPointerMove}
                onPointerUp={endDrag}
                onPointerCancel={endDrag}
                onLostPointerCapture={endDrag}
              />
            ))}
          </div>
        </div>
      </div>
      <div className={s.cropBar}>
        <span className={s.cropMeta}>
          선택 영역 {Math.round(crop.w * 100)}% × {Math.round(crop.h * 100)}%
        </span>
        {isCropped && (
          <Button size="sm" variant="ghost" onClick={() => onChange(FULL_CROP)} disabled={disabled}>
            전체 선택
          </Button>
        )}
      </div>
    </div>
  );
}
