import { useId, useRef, type KeyboardEvent, type ReactNode } from 'react';
import s from './Tabs.module.css';

export interface TabItem<T extends string> {
  value: T;
  label: ReactNode;
  /** 라벨 옆 개수 등 보조 표기 */
  count?: number;
  disabled?: boolean;
  panel: ReactNode;
}

export interface TabsProps<T extends string> {
  items: TabItem<T>[];
  value: T;
  onChange: (value: T) => void;
  'aria-label': string;
  /** 탭 줄을 부모 폭에 균등 분배 */
  fill?: boolean;
  className?: string;
  panelClassName?: string;
}

/** 탭 + 패널 (WAI-ARIA tabs 패턴: role=tablist/tab/tabpanel, ←/→/Home/End 자동 활성화) */
export default function Tabs<T extends string>({
  items,
  value,
  onChange,
  fill,
  className,
  panelClassName,
  ...aria
}: TabsProps<T>) {
  const baseId = useId();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const enabled = items.map((t, i) => (t.disabled ? -1 : i)).filter((i) => i >= 0);
  const active = items.find((t) => t.value === value) ?? items[enabled[0] ?? 0];

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (enabled.length === 0) return;
    const pos = Math.max(0, enabled.indexOf(index));
    let next: number | undefined;
    if (e.key === 'ArrowRight') next = enabled[(pos + 1) % enabled.length];
    else if (e.key === 'ArrowLeft') next = enabled[(pos - 1 + enabled.length) % enabled.length];
    else if (e.key === 'Home') next = enabled[0];
    else if (e.key === 'End') next = enabled[enabled.length - 1];
    if (next === undefined) return;
    e.preventDefault();
    onChange(items[next].value);
    refs.current[next]?.focus();
  };

  const tabId = (v: string) => `${baseId}-tab-${v}`;
  const panelId = (v: string) => `${baseId}-panel-${v}`;

  return (
    <div className={className}>
      <div role="tablist" aria-label={aria['aria-label']} className={`${s.list}${fill ? ` ${s.fill}` : ''}`}>
        {items.map((t, i) => {
          const selected = active?.value === t.value;
          return (
            <button
              key={t.value}
              ref={(el) => {
                refs.current[i] = el;
              }}
              id={tabId(t.value)}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls={panelId(t.value)}
              tabIndex={selected ? 0 : -1}
              disabled={t.disabled}
              className={`${s.tab}${selected ? ` ${s.selected}` : ''}`}
              onClick={() => onChange(t.value)}
              onKeyDown={(e) => onKeyDown(e, i)}
            >
              {t.label}
              {t.count != null ? <span className={`${s.count} num`}>{t.count}</span> : null}
            </button>
          );
        })}
      </div>
      {active ? (
        <div
          role="tabpanel"
          id={panelId(active.value)}
          aria-labelledby={tabId(active.value)}
          tabIndex={0}
          className={`${s.panel}${panelClassName ? ` ${panelClassName}` : ''}`}
        >
          {active.panel}
        </div>
      ) : null}
    </div>
  );
}
