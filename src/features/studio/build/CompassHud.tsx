import { useCallback, useEffect, useLayoutEffect, useRef, useState, type MutableRefObject } from 'react';
import {
  compassNeedleDeg,
  DEFAULT_ROOM_FACING,
  normalizeRoomFacing,
  ROOM_FACING_META,
  type RoomFacing,
} from '../../../domain/orientation';
import s from './CompassHud.module.css';

export interface CompassHudProps {
  facing?: RoomFacing;
  /** 생략 시 읽기 전용 배지 (RoomViewer) */
  onChange?: (facing: RoomFacing) => void;
  /** 매 프레임 React 리렌더 없이 카메라 수평 방위각(rad)을 전달받는 싱크 ref */
  azimuthSinkRef?: MutableRefObject<((azimuthRad: number) => void) | null>;
  variant?: 'studio' | 'viewer';
  /** variant='studio'에서 우측 인스펙터 패널 열림 여부 */
  inspectorOpen?: boolean;
}

const ROSE_CELLS: readonly (RoomFacing | 'CENTER')[] = [
  'NW', 'N', 'NE',
  'W', 'CENTER', 'E',
  'SW', 'S', 'SE',
];

/**
 * 실시간 3D/2D 나침반 HUD 및 8방위(채광 방향) 설정 팝오버.
 * 카메라 회전 시 azimuthSinkRef를 통해 SVG 바늘 DOM만 직접 회전시켜 리렌더 비용이 0이다.
 */
export default function CompassHud({
  facing,
  onChange,
  azimuthSinkRef,
  variant = 'studio',
  inspectorOpen = true,
}: CompassHudProps) {
  const normalized = normalizeRoomFacing(facing ?? DEFAULT_ROOM_FACING);
  const meta = ROOM_FACING_META[normalized];
  const interactive = typeof onChange === 'function';

  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const dialRef = useRef<SVGSVGElement | null>(null);
  const facingRef = useRef<RoomFacing>(normalized);
  const lastAzRef = useRef<number>(0);

  facingRef.current = normalized;

  const applyNeedle = useCallback(() => {
    const el = dialRef.current;
    if (!el) return;
    const deg = compassNeedleDeg(facingRef.current, lastAzRef.current);
    el.style.transform = `rotate(${deg.toFixed(1)}deg)`;
  }, []);

  useLayoutEffect(() => {
    applyNeedle();
  }, [normalized, applyNeedle]);

  useLayoutEffect(() => {
    if (!azimuthSinkRef) return;
    azimuthSinkRef.current = (az: number) => {
      lastAzRef.current = az;
      applyNeedle();
    };
    return () => {
      azimuthSinkRef.current = null;
    };
  }, [azimuthSinkRef, applyNeedle]);

  useEffect(() => {
    if (!open || !interactive) return;
    const onPointerDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open, interactive]);

  const initialDeg = compassNeedleDeg(normalized, lastAzRef.current).toFixed(1);

  const dialIcon = (
    <span className={s.dialWrap} aria-hidden="true">
      <svg
        ref={dialRef}
        className={s.dialSvg}
        viewBox="0 0 20 20"
        fill="none"
        style={{ transform: `rotate(${initialDeg}deg)` }}
      >
        <circle cx="10" cy="10" r="8.25" stroke="currentColor" strokeOpacity="0.18" strokeWidth="1" />
        {/* 동/서/남 눈금 */}
        <line x1="10" y1="17.2" x2="10" y2="18.5" stroke="currentColor" strokeOpacity="0.35" strokeWidth="1.1" strokeLinecap="round" />
        <line x1="1.5" y1="10" x2="2.8" y2="10" stroke="currentColor" strokeOpacity="0.35" strokeWidth="1.1" strokeLinecap="round" />
        <line x1="17.2" y1="10" x2="18.5" y2="10" stroke="currentColor" strokeOpacity="0.35" strokeWidth="1.1" strokeLinecap="round" />
        {/* 남쪽(S) 바늘 꼬리 */}
        <polygon points="10,16.8 7.9,10 12.1,10" fill="currentColor" fillOpacity="0.32" />
        {/* 북쪽(N) 붉은 바늘 팁 */}
        <polygon points="10,2.2 12.2,10 7.8,10" fill="var(--danger)" />
        <circle cx="10" cy="10" r="1.4" fill="var(--surface)" stroke="var(--text)" strokeWidth="1" />
      </svg>
    </span>
  );

  return (
    <div
      ref={rootRef}
      className={s.root}
      data-variant={variant}
      data-inspector-open={variant === 'studio' ? String(Boolean(inspectorOpen)) : undefined}
    >
      {interactive ? (
        <button
          ref={triggerRef}
          type="button"
          className={`${s.pill} ${s.pillInteractive}`}
          aria-label={`방위 설정 (현재 ${meta.label})`}
          aria-expanded={open}
          aria-haspopup="dialog"
          onClick={() => setOpen((prev) => !prev)}
        >
          {dialIcon}
          <span className={s.labelGroup}>
            <span className={s.facingLabel}>{meta.label}</span>
            <span className={s.facingCode}>{meta.facing}</span>
          </span>
          <span className={s.chevron} aria-hidden="true" />
        </button>
      ) : (
        <div className={s.pill} role="status" aria-label={`방위 ${meta.label}`}>
          {dialIcon}
          <span className={s.labelGroup}>
            <span className={s.facingLabel}>{meta.label}</span>
            <span className={s.facingCode}>{meta.facing}</span>
          </span>
        </div>
      )}

      {interactive && open && (
        <div className={s.popover} role="dialog" aria-label="8방위 채광 방향 선택">
          <div className={s.popHead}>
            <span className={s.popTitle}>방위 · 채광 방향</span>
            <span className={s.popDegree}>{meta.label} · {meta.azimuthDeg}°</span>
          </div>
          <div className={s.roseGrid} role="group" aria-label="8방위 선택">
            {ROSE_CELLS.map((cell) => {
              if (cell === 'CENTER') {
                return (
                  <div key="center" className={s.roseCenter} aria-hidden="true">
                    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
                      <circle cx="10" cy="10" r="3.6" />
                      <path d="M10 2.5v2.2M10 15.3v2.2M2.5 10h2.2M15.3 10h2.2M4.7 4.7l1.5 1.5M13.8 13.8l1.5 1.5M15.3 4.7l-1.5 1.5M6.2 13.8l-1.5 1.5" />
                    </svg>
                    <span>채광</span>
                  </div>
                );
              }
              const item = ROOM_FACING_META[cell];
              const active = normalized === cell;
              return (
                <button
                  key={cell}
                  type="button"
                  className={s.dirBtn}
                  aria-pressed={active}
                  onClick={() => {
                    onChange(cell);
                    setOpen(false);
                  }}
                >
                  <span className={s.dirCode}>{item.facing}</span>
                  <span className={s.dirName}>{item.label}</span>
                </button>
              );
            })}
          </div>
          <p className={s.caption}>도면 아래쪽(+Z) 기준 채광 방향</p>
        </div>
      )}
    </div>
  );
}
