import { useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import IconButton from './IconButton';
import { CloseIcon } from './Modal';
import { useDialog } from './useDialog';
import s from './Sheet.module.css';

export interface SheetProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  /** 데스크톱 드로어 폭 */
  width?: 'md' | 'lg';
  /** 배경 딤 + 클릭 닫기 (기본 true). false면 뒤 화면 조작 가능한 비모달 드로어 */
  modal?: boolean;
  className?: string;
}

/** 우측 드로어(데스크톱) / 하단 시트(≤768px). 위저드·AI 드로어 용 */
export default function Sheet({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  width = 'md',
  modal = true,
  className,
}: SheetProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descId = useId();
  useDialog(open && modal, panelRef, onClose);

  if (!open || typeof document === 'undefined') return null;

  const panel = (
    <div
      ref={panelRef}
      data-dialog-panel={modal ? '' : undefined}
      role="dialog"
      aria-modal={modal ? 'true' : undefined}
      aria-labelledby={titleId}
      aria-describedby={description ? descId : undefined}
      tabIndex={-1}
      className={`${s.panel} ${s[width]}${className ? ` ${className}` : ''}`}
    >
      <span className={s.grip} aria-hidden="true" />
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
  );

  return createPortal(
    modal ? (
      <div
        className={s.backdrop}
        onMouseDown={(e) => {
          if (e.target === e.currentTarget) onClose();
        }}
      >
        {panel}
      </div>
    ) : (
      panel
    ),
    document.body,
  );
}
