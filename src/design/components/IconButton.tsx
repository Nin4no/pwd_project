import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import s from './IconButton.module.css';

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label' | 'children'> {
  /** 스크린리더 이름 (필수) — title 기본값으로도 사용 */
  'aria-label': string;
  icon: ReactNode;
  size?: 'sm' | 'md' | 'lg';
  variant?: 'ghost' | 'secondary' | 'primary' | 'danger';
  /** 토글 상태 (aria-pressed) */
  pressed?: boolean;
}

const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { icon, size = 'md', variant = 'ghost', pressed, className, type = 'button', title, ...rest },
  ref,
) {
  const cls = [s.btn, s[size], s[variant], pressed ? s.pressed : '', className ?? ''].filter(Boolean).join(' ');
  return (
    <button ref={ref} type={type} className={cls} title={title ?? rest['aria-label']} aria-pressed={pressed} {...rest}>
      <span className={s.icon} aria-hidden="true">
        {icon}
      </span>
    </button>
  );
});

export default IconButton;
