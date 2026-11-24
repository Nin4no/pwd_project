import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import Spinner from './Spinner';
import s from './Button.module.css';

export type ButtonVariant = 'primary' | 'brand' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** 진행 중: 스피너 표시 + 비활성. 라벨 폭은 유지 */
  loading?: boolean;
  /** 라벨 앞 아이콘 (단색 SVG) */
  icon?: ReactNode;
  /** 부모 폭 채우기 */
  block?: boolean;
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', loading = false, icon, block, className, children, disabled, type = 'button', ...rest },
  ref,
) {
  const cls = [s.btn, s[variant], s[size], block ? s.block : '', loading ? s.loading : '', className ?? '']
    .filter(Boolean)
    .join(' ');
  return (
    <button ref={ref} type={type} className={cls} disabled={disabled || loading} aria-busy={loading || undefined} {...rest}>
      {loading ? (
        <span className={s.spin} aria-hidden="true">
          <Spinner size="sm" tone="current" />
        </span>
      ) : null}
      <span className={s.inner}>
        {icon ? (
          <span className={s.icon} aria-hidden="true">
            {icon}
          </span>
        ) : null}
        {children != null && children !== false ? <span className={s.label}>{children}</span> : null}
      </span>
    </button>
  );
});

export default Button;
