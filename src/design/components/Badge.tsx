import type { ReactNode } from 'react';
import s from './Badge.module.css';

export type BadgeTone = 'neutral' | 'info' | 'ai' | 'danger' | 'success';

export interface BadgeProps {
  tone?: BadgeTone;
  children: ReactNode;
  className?: string;
  title?: string;
}

/** 작은 상태 배지 (AI 가구·충돌 경고·정보 등). 글자만, 이모지 없음 */
export default function Badge({ tone = 'neutral', children, className, title }: BadgeProps) {
  return (
    <span className={`${s.badge} ${s[tone]}${className ? ` ${className}` : ''}`} title={title}>
      {children}
    </span>
  );
}
