import s from './Spinner.module.css';

export interface SpinnerProps {
  size?: 'sm' | 'md' | 'lg';
  /** primary: 잉크 블루 / current: 부모 글자색 */
  tone?: 'primary' | 'current';
  /** 지정하면 role="status"로 읽힘. 없으면 장식용 */
  label?: string;
  className?: string;
}

export default function Spinner({ size = 'md', tone = 'primary', label, className }: SpinnerProps) {
  const cls = [s.spinner, s[size], s[tone], className ?? ''].filter(Boolean).join(' ');
  if (!label) return <span className={cls} aria-hidden="true" />;
  return (
    <span role="status" className={s.wrap}>
      <span className={cls} aria-hidden="true" />
      <span className="sr-only">{label}</span>
    </span>
  );
}
