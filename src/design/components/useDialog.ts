import { useEffect, useRef, type RefObject } from 'react';

export const DIALOG_OPEN_EVENT = 'dyr:dialog-open';

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

let scrollLocks = 0;
let savedOverflow = '';

function lockScroll(): () => void {
  if (scrollLocks === 0) {
    savedOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
  }
  scrollLocks += 1;
  return () => {
    scrollLocks -= 1;
    if (scrollLocks === 0) document.body.style.overflow = savedOverflow;
  };
}

/**
 * 모달·시트 공통 동작: 포커스 트랩(Tab 순환), Esc 닫기, body 스크롤 잠금,
 * 열릴 때 첫 포커스 이동 / 닫힐 때 이전 포커스 복귀.
 */
export function useDialog(open: boolean, panelRef: RefObject<HTMLElement>, onClose: () => void) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    if (document.body.style.cursor) {
      document.body.style.cursor = '';
    }
    window.dispatchEvent(new Event(DIALOG_OPEN_EVENT));
    const prev = document.activeElement as HTMLElement | null;
    const unlock = lockScroll();
    const panel = panelRef.current;
    const first = panel?.querySelector<HTMLElement>('[data-autofocus]') ?? panel?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? panel)?.focus({ preventScroll: true });

    const onKey = (e: KeyboardEvent) => {
      const el = panelRef.current;
      if (!el) return;
      if (e.key === 'Escape') {
        // 가장 위에 열린 대화상자만 닫힘
        const dialogs = document.querySelectorAll('[data-dialog-panel]');
        if (dialogs[dialogs.length - 1] !== el) return;
        e.stopPropagation();
        closeRef.current();
        return;
      }
      if (e.key !== 'Tab') return;
      const items = Array.from(el.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((n) => n.offsetParent !== null);
      if (items.length === 0) {
        e.preventDefault();
        el.focus();
        return;
      }
      const head = items[0];
      const tail = items[items.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === head || !el.contains(active))) {
        e.preventDefault();
        tail.focus();
      } else if (!e.shiftKey && (active === tail || !el.contains(active))) {
        e.preventDefault();
        head.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      unlock();
      if (prev && document.contains(prev)) prev.focus({ preventScroll: true });
    };
  }, [open, panelRef]);
}
