import { useRef, type KeyboardEvent, type ReactNode } from 'react';
import s from './Segmented.module.css';

export interface SegmentedOption<T extends string> {
  value: T;
  label: ReactNode;
  icon?: ReactNode;
  disabled?: boolean;
  /** label이 아이콘뿐일 때 스크린리더 이름 */
  ariaLabel?: string;
}

export interface SegmentedProps<T extends string> {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  'aria-label': string;
  size?: 'sm' | 'md';
  /** 부모 폭 채우기(각 항목 균등) */
  block?: boolean;
  className?: string;
}

/**
 * 세그먼트 컨트롤 (2D/3D, 카메라 모드, 탭 전환 등).
 * role="radiogroup" + 로빙 tabindex, ←/→/Home/End로 이동하며 즉시 선택(0ms — 고빈도 조작).
 */
export default function Segmented<T extends string>({
  options,
  value,
  onChange,
  size = 'md',
  block,
  className,
  ...aria
}: SegmentedProps<T>) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const enabled = options.map((o, i) => (o.disabled ? -1 : i)).filter((i) => i >= 0);

  const move = (from: number, dir: 1 | -1 | 'first' | 'last') => {
    if (enabled.length === 0) return;
    let target: number;
    if (dir === 'first') target = enabled[0];
    else if (dir === 'last') target = enabled[enabled.length - 1];
    else {
      const pos = enabled.indexOf(from);
      const base = pos < 0 ? 0 : pos;
      target = enabled[(base + dir + enabled.length) % enabled.length];
    }
    onChange(options[target].value);
    refs.current[target]?.focus();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const map: Record<string, 1 | -1 | 'first' | 'last'> = {
      ArrowRight: 1,
      ArrowDown: 1,
      ArrowLeft: -1,
      ArrowUp: -1,
      Home: 'first',
      End: 'last',
    };
    const dir = map[e.key];
    if (dir === undefined) return;
    e.preventDefault();
    move(index, dir);
  };

  const selectedIndex = options.findIndex((o) => o.value === value);
  const cls = [s.root, s[size], block ? s.block : '', className ?? ''].filter(Boolean).join(' ');

  return (
    <div role="radiogroup" aria-label={aria['aria-label']} className={cls}>
      {options.map((o, i) => {
        const selected = o.value === value;
        const focusable = selected || (selectedIndex < 0 && i === enabled[0]);
        return (
          <button
            key={o.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={o.ariaLabel}
            disabled={o.disabled}
            tabIndex={focusable ? 0 : -1}
            className={`${s.item}${selected ? ` ${s.selected}` : ''}`}
            onClick={() => !selected && onChange(o.value)}
            onKeyDown={(e) => onKeyDown(e, i)}
          >
            {o.icon ? (
              <span className={s.icon} aria-hidden="true">
                {o.icon}
              </span>
            ) : null}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
