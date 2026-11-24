import { useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import IconButton from './IconButton';
import { useDialog } from './useDialog';
import s from './Modal.module.css';

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  /** 제목 아래 보조 설명 */
  description?: ReactNode;
  children: ReactNode;
  /** 하단 버튼 줄 */
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
  /** 배경 클릭으로 닫기 (기본 true) */
  dismissable?: boolean;
  className?: string;
}

export function CloseIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <path d="M5 5l10 10M15 5L5 15" />
    </svg>
  );
}

/** 중앙 다이얼로그. 포커스 트랩·Esc·스크롤 잠금·aria-modal */
export default function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
  dismissable = true,
  className,
}: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descId = useId();
  useDialog(open, panelRef, onClose);

  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div
      className={s.backdrop}
      onMouseDown={(e) => {
        if (dismissable && e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        data-dialog-panel=""
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        tabIndex={-1}
        className={`${s.panel} ${s[size]}${className ? ` ${className}` : ''}`}
      >
        <div className={s.head}>
          <div className={s.titles}>
            <h2 id={titleId} className={s.title}>
              {title}
            </h2>
            {description ? (
              <p id={descId} className={s.desc}>
                {description}
              </p>
            ) : null}
          </div>
          <IconButton aria-label="닫기" icon={<CloseIcon />} size="sm" onClick={onClose} />
        </div>
        <div className={s.body}>{children}</div>
        {footer ? <div className={s.footer}>{footer}</div> : null}
      </div>
    </div>,
    document.body,
  );
}
