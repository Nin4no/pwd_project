import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import s from './HomeSection.module.css';

export interface HomeSectionProps {
  titleId: string;
  title: string;
  moreTo: string;
  moreLabel: string;
  framed?: boolean;
  children: ReactNode;
}

export default function HomeSection({
  titleId,
  title,
  moreTo,
  moreLabel,
  framed = false,
  children,
}: HomeSectionProps) {
  return (
    <section aria-labelledby={titleId}>
      <div className={s.head}>
        <h2 id={titleId} className={s.title}>
          {title}
        </h2>
        <Link to={moreTo} className={s.more}>
          {moreLabel}
        </Link>
      </div>
      {framed ? (
        <div className={s.frame}>
          <span className={`${s.mark} ${s.tl}`} aria-hidden="true" />
          <span className={`${s.mark} ${s.tr}`} aria-hidden="true" />
          <span className={`${s.mark} ${s.bl}`} aria-hidden="true" />
          <span className={`${s.mark} ${s.br}`} aria-hidden="true" />
          {children}
        </div>
      ) : (
        children
      )}
    </section>
  );
}
