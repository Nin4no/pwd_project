import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import s from './NumberField.module.css';

export interface NumberFieldProps {
  value: number;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  /** 확정된 값(범위 보정 후) */
  onCommit: (value: number) => void;
  /** 보이는 라벨. 없으면 aria-label 필수 */
  label?: ReactNode;
  'aria-label'?: string;
  /** 단위 접미사 (cm, m, ° 등) */
  unit?: string;
  size?: 'sm' | 'md';
  id?: string;
  className?: string;
}

/**
 * 입력 중에는 값을 강제로 보정하지 않는 숫자 입력칸 (현행 studio/NumberField 이식).
 * - 타이핑 중간값(예: 120을 치려고 입력한 "1")이 min으로 튀지 않도록 범위 안일 때만 즉시 반영
 * - 범위를 벗어난 값은 포커스를 잃거나 Enter를 누를 때 min/max로 보정해 확정, Esc는 취소
 */
export default function NumberField({
  value,
  min = -Infinity,
  max = Infinity,
  step = 1,
  disabled,
  onCommit,
  label,
  unit,
  size = 'md',
  id,
  className,
  ...aria
}: NumberFieldProps) {
  const autoId = useId();
  const inputId = id ?? `${autoId}-num`;
  const [text, setText] = useState(String(value));
  const editing = useRef(false);
  const cancelled = useRef(false);

  useEffect(() => {
    if (!editing.current) setText(String(value));
  }, [value]);

  const finish = (raw: string) => {
    editing.current = false;
    if (cancelled.current) {
      cancelled.current = false;
      setText(String(value));
      return;
    }
    const n = parseFloat(raw);
    if (Number.isNaN(n)) {
      setText(String(value));
      return;
    }
    const clamped = Math.max(min, Math.min(max, n));
    setText(String(clamped));
    if (clamped !== value) onCommit(clamped);
  };

  return (
    <div className={`${s.field}${className ? ` ${className}` : ''}`}>
      {label ? (
        <label htmlFor={inputId} className={s.label}>
          {label}
        </label>
      ) : null}
      <div className={`${s.box} ${s[size]}${disabled ? ` ${s.disabled}` : ''}`}>
        <input
          id={inputId}
          type="number"
          inputMode="decimal"
          className={`${s.input} num`}
          aria-label={label ? undefined : aria['aria-label']}
          min={Number.isFinite(min) ? min : undefined}
          max={Number.isFinite(max) ? max : undefined}
          step={step}
          disabled={disabled}
          value={text}
          onFocus={() => {
            editing.current = true;
          }}
          onChange={(e) => {
            editing.current = true;
            setText(e.target.value);
            const n = parseFloat(e.target.value);
            if (!Number.isNaN(n) && n >= min && n <= max && n !== value) onCommit(n);
          }}
          onBlur={(e) => finish(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
            if (e.key === 'Escape') {
              cancelled.current = true;
              e.currentTarget.blur();
            }
          }}
        />
        {unit ? (
          <span className={`${s.unit} num`} aria-hidden="true">
            {unit}
          </span>
        ) : null}
      </div>
    </div>
  );
}
