import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { RevealState } from '../../design/motion/scrollReveal';
import { useSectionScrollMotion } from '../../design/motion/useSectionScrollMotion';
import s from './HomeSection.module.css';

export interface HomeSectionProps {
  id?: string;
  titleId: string;
  title: string;
  moreTo: string;
  moreLabel: string;
  framed?: boolean;
  tone?: 'base' | 'tint';
  isLastSection?: boolean;
  children: ReactNode | ((revealState: RevealState) => ReactNode);
}

function splitTrailingArrow(label: string): { text: string; hasArrow: boolean } {
  if (label.endsWith(' →')) {
    return { text: label.slice(0, -2), hasArrow: true };
  }
  return { text: label, hasArrow: false };
}

export default function HomeSection({
  id,
  titleId,
  title,
  moreTo,
  moreLabel,
  framed = false,
  tone = 'base',
  isLastSection = false,
  children,
}: HomeSectionProps) {
  // 컨테이너 단일 진입 원칙: 스크롤 연계 다층 코레오그래피(useSectionScrollMotion)가 섹션 진입·퇴장을 단독 구동
  const revealState: RevealState = 'instant';
  const {
    sectionRef,
    headEnterRef,
    headExitRef,
    bodyEnterRef,
    bodyExitRef,
    markTLRef,
    markTRRef,
    markBLRef,
    markBRRef,
  } = useSectionScrollMotion<HTMLElement, HTMLDivElement>({
    isLastSection,
  });
  const { text: moreText, hasArrow } = splitTrailingArrow(moreLabel);
  const content = typeof children === 'function' ? children(revealState) : children;

  return (
    <section
      id={id}
      ref={sectionRef}
      className={`${s.section}${tone === 'tint' ? ` ${s.sectionTint}` : ''}`}
      data-reveal={revealState}
      data-last-section={isLastSection ? 'true' : undefined}
      aria-labelledby={titleId}
    >
      <div className={s.inner}>
        <div ref={headExitRef} className={s.headExit}>
          <div ref={headEnterRef} className={s.head}>
            <h2 id={titleId} className={s.title}>
              {title}
            </h2>
            <Link to={moreTo} className={s.more}>
              <span>{moreText}</span>
              {hasArrow ? (
                <span className={s.moreArrow} aria-hidden="true">
                  →
                </span>
              ) : null}
            </Link>
          </div>
        </div>
        <div ref={bodyExitRef} className={s.bodyExit}>
          {framed ? (
            <div className={s.frame}>
              <span ref={markTLRef} className={`${s.mark} ${s.tl}`} aria-hidden="true" />
              <span ref={markTRRef} className={`${s.mark} ${s.tr}`} aria-hidden="true" />
              <span ref={markBLRef} className={`${s.mark} ${s.bl}`} aria-hidden="true" />
              <span ref={markBRRef} className={`${s.mark} ${s.br}`} aria-hidden="true" />
              <div ref={bodyEnterRef} className={s.frameBody}>
                {content}
              </div>
            </div>
          ) : (
            <div ref={bodyEnterRef} className={s.body}>
              {content}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
