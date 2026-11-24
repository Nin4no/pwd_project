import type { ReactNode } from 'react';
import s from './EmptyState.module.css';

export interface EmptyStateProps {
  title: ReactNode;
  description?: ReactNode;
  /** 주행동 버튼 (Button 등) */
  action?: ReactNode;
  /** 모눈 배경 없이 여백만 */
  plain?: boolean;
  className?: string;
}

/** 빈 상태: 모눈 바탕 + 네 모서리 재단 마크 + 제목 + CTA */
export default function EmptyState({ title, description, action, plain, className }: EmptyStateProps) {
  return (
    <div className={`${s.wrap}${plain ? '' : ' grid-paper'}${className ? ` ${className}` : ''}`}>
      <span className={`${s.mark} ${s.tl}`} aria-hidden="true" />
      <span className={`${s.mark} ${s.tr}`} aria-hidden="true" />
      <span className={`${s.mark} ${s.bl}`} aria-hidden="true" />
      <span className={`${s.mark} ${s.br}`} aria-hidden="true" />
      <p className={s.title}>{title}</p>
      {description ? <p className={s.desc}>{description}</p> : null}
      {action ? <div className={s.action}>{action}</div> : null}
    </div>
  );
}
