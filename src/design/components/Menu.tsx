import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import IconButton from './IconButton';
import s from './Menu.module.css';

export interface MenuItem {
  key: string;
  label: ReactNode;
  onSelect: () => void;
  icon?: ReactNode;
  danger?: boolean;
  disabled?: boolean;
  /** 이 항목 위에 구분선 */
  divider?: boolean;
}

export interface MenuProps {
  items: MenuItem[];
  /** 트리거 버튼 이름 (기본 "더 보기") */
  'aria-label'?: string;
  /** 트리거 내용 (기본 ⋯ 아이콘 버튼) */
  trigger?: ReactNode;
  /** 메뉴가 열리는 쪽 — 트리거 기준 정렬 (기본 end: 오른쪽 끝 맞춤) */
  align?: 'start' | 'end';
  /** 위로 열기 (하단 툴바용) */
  placement?: 'bottom' | 'top';
  className?: string;
}

function DotsIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor">
      <circle cx="4.5" cy="10" r="1.6" />
      <circle cx="10" cy="10" r="1.6" />
      <circle cx="15.5" cy="10" r="1.6" />
    </svg>
  );
}

/** ⋯ 드롭다운. 바깥 클릭·Esc 닫힘, role="menu", 트리거 쪽에서 자라나는 진입 */
export default function Menu({ items, trigger, align = 'end', placement = 'bottom', className, ...aria }: MenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const menuId = useId();
  const label = aria['aria-label'] ?? '더 보기';
  const enabled = items.map((it, i) => (it.disabled ? -1 : i)).filter((i) => i >= 0);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    itemRefs.current[enabled[0] ?? 0]?.focus();
    return () => document.removeEventListener('pointerdown', onDown);
    // 열릴 때 한 번만 첫 항목 포커스
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const close = (refocus = true) => {
    setOpen(false);
    if (refocus) triggerRef.current?.focus();
  };

  const onMenuKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const cur = itemRefs.current.findIndex((el) => el === document.activeElement);
    const pos = enabled.indexOf(cur);
    let next: number | undefined;
    if (e.key === 'ArrowDown') next = enabled[(pos + 1) % enabled.length];
    else if (e.key === 'ArrowUp') next = enabled[(pos - 1 + enabled.length) % enabled.length];
    else if (e.key === 'Home') next = enabled[0];
    else if (e.key === 'End') next = enabled[enabled.length - 1];
    else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
      return;
    } else if (e.key === 'Tab') {
      close(false);
      return;
    }
    if (next === undefined) return;
    e.preventDefault();
    itemRefs.current[next]?.focus();
  };

  const posCls = `${s[align]} ${s[placement]}`;

  return (
    <div ref={rootRef} className={`${s.root}${className ? ` ${className}` : ''}`}>
      {trigger ? (
        <button
          ref={triggerRef}
          type="button"
          className={s.trigger}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-controls={open ? menuId : undefined}
          aria-label={aria['aria-label']}
          onClick={() => setOpen((v) => !v)}
        >
          {trigger}
        </button>
      ) : (
        <IconButton
          ref={triggerRef}
          aria-label={label}
          icon={<DotsIcon />}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-controls={open ? menuId : undefined}
          pressed={undefined}
          onClick={() => setOpen((v) => !v)}
        />
      )}
      {open ? (
        <div id={menuId} role="menu" aria-label={label} className={`${s.menu} ${posCls}`} onKeyDown={onMenuKey}>
          {items.map((it, i) => (
            <div key={it.key} role="none">
              {it.divider && i > 0 ? <div role="separator" className={s.sep} /> : null}
              <button
                ref={(el) => {
                  itemRefs.current[i] = el;
                }}
                type="button"
                role="menuitem"
                tabIndex={-1}
                disabled={it.disabled}
                className={`${s.item}${it.danger ? ` ${s.danger}` : ''}`}
                onClick={() => {
                  close();
                  it.onSelect();
                }}
              >
                {it.icon ? (
                  <span className={s.icon} aria-hidden="true">
                    {it.icon}
                  </span>
                ) : null}
                <span className={s.label}>{it.label}</span>
              </button>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
