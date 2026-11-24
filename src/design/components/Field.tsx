import { forwardRef, useId, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from 'react';
import s from './Field.module.css';

interface FieldBase {
  label: ReactNode;
  /** 라벨을 시각적으로 숨김(스크린리더용으로는 유지) */
  hideLabel?: boolean;
  hint?: ReactNode;
  /** 있으면 aria-invalid + role="alert"로 표시 */
  error?: ReactNode;
  /** 입력칸 오른쪽 부가 요소(버튼 등) */
  trailing?: ReactNode;
  className?: string;
}

export type FieldProps = FieldBase &
  (
    | ({ multiline?: false } & InputHTMLAttributes<HTMLInputElement>)
    | ({ multiline: true } & TextareaHTMLAttributes<HTMLTextAreaElement>)
  );

/** 라벨·힌트·오류 메시지를 가진 입력 래퍼 (input / textarea) */
const Field = forwardRef<HTMLInputElement | HTMLTextAreaElement, FieldProps>(function Field(props, ref) {
  const { label, hideLabel, hint, error, trailing, className, id, ...rest } = props;
  const autoId = useId();
  const inputId = id ?? `${autoId}-input`;
  const hintId = hint ? `${autoId}-hint` : undefined;
  const errId = error ? `${autoId}-err` : undefined;
  const describedBy = [errId, hintId].filter(Boolean).join(' ') || undefined;
  const common = {
    id: inputId,
    'aria-invalid': error ? true : undefined,
    'aria-describedby': describedBy,
  };

  let control: ReactNode;
  if (rest.multiline) {
    const { multiline: _m, ...ta } = rest;
    void _m;
    control = (
      <textarea
        ref={ref as React.Ref<HTMLTextAreaElement>}
        {...ta}
        {...common}
        className={`${s.control} ${s.textarea}${error ? ` ${s.invalid}` : ''}`}
      />
    );
  } else {
    const { multiline: _m, ...inp } = rest;
    void _m;
    control = (
      <input
        ref={ref as React.Ref<HTMLInputElement>}
        {...inp}
        {...common}
        className={`${s.control}${error ? ` ${s.invalid}` : ''}`}
      />
    );
  }

  return (
    <div className={`${s.field}${className ? ` ${className}` : ''}`}>
      <label htmlFor={inputId} className={hideLabel ? 'sr-only' : s.label}>
        {label}
      </label>
      {trailing ? (
        <div className={s.row}>
          {control}
          {trailing}
        </div>
      ) : (
        control
      )}
      {error ? (
        <p id={errId} className={s.error} role="alert">
          {error}
        </p>
      ) : null}
      {hint ? (
        <p id={hintId} className={s.hint}>
          {hint}
        </p>
      ) : null}
    </div>
  );
});

export default Field;
