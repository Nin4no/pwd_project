import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button, HeartBurst, Spinner } from '../../design/components';
import { createRoom } from '../../domain/room';
import { rectWalls } from '../../engine/geometry';
import { useRepositories } from '../../app/providers';
import { ROUTES } from '../../app/router';
import { SAMPLE_POSTS } from '../../data/sampleRooms';
import { HeartIcon } from '../showroom/PostCard';
import { usePopularPosts } from '../showroom/usePopularShowroom';
import { usePostActions } from '../showroom/usePostActions';
import type { SceneApi } from '../studio/build/RoomCanvas.types';
import PopularPosts from './PopularPosts';
import RecentRooms from './RecentRooms';
import {
  createShowcaseAutoSlideController,
  type ShowcaseAutoSlideController,
} from './showcaseAutoSlide';
import TemplateChips, { type RoomTemplate } from './TemplateChips';
import page from '../../app/Page.module.css';
import s from './Home.module.css';

const RoomViewer3D = lazy(() => import('../showroom/RoomViewer').then((m) => ({ default: m.RoomViewer3D })));

/** 홈: 에디토리얼 3D 쇼케이스 히어로 · 최근 작업 · 인기 쇼룸 */
export default function HomePage() {
  const nav = useNavigate();
  const { rooms } = useRepositories();
  const { posts: popularPosts } = usePopularPosts(3);
  const [slideIdx, setSlideIdx] = useState(0);
  const [paused, setPaused] = useState(false);
  const totalSlides = popularPosts.length;
  const activePost = popularPosts[slideIdx % Math.max(totalSlides, 1)] ?? SAMPLE_POSTS[0];
  const postActions = usePostActions();
  const activeLiked = postActions.isLiked(activePost);
  const prevLikedByPostRef = useRef<Record<string, boolean>>({});
  const [bursts, setBursts] = useState<Record<string, number>>({});

  useEffect(() => {
    const prev = prevLikedByPostRef.current;
    if (activePost.id in prev && !prev[activePost.id] && activeLiked) {
      setBursts((cur) => ({ ...cur, [activePost.id]: (cur[activePost.id] ?? 0) + 1 }));
    }
    prev[activePost.id] = activeLiked;
  }, [activePost.id, activeLiked]);

  const viewerApiRef = useRef<SceneApi | null>(null);
  const autoSlideCtrlRef = useRef<ShowcaseAutoSlideController | null>(null);
  const prevPostIdRef = useRef(activePost.id);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const outgoingRef = useRef<HTMLCanvasElement | null>(null);
  const captionInnerRef = useRef<HTMLDivElement | null>(null);
  const stageAnimRef = useRef<Animation | null>(null);
  const outAnimRef = useRef<Animation | null>(null);
  const capAnimRef = useRef<Animation | null>(null);
  const mountedRef = useRef(false);
  const dirRef = useRef<'next' | 'prev'>('next');
  const hasSnapshotRef = useRef(false);

  useEffect(() => {
    const ctrl = createShowcaseAutoSlideController({
      onPauseChange: setPaused,
    });
    autoSlideCtrlRef.current = ctrl;
    const handleRelease = () => ctrl.onPointerUpOrCancel();
    window.addEventListener('pointerup', handleRelease);
    window.addEventListener('pointercancel', handleRelease);
    window.addEventListener('blur', handleRelease);
    return () => {
      window.removeEventListener('pointerup', handleRelease);
      window.removeEventListener('pointercancel', handleRelease);
      window.removeEventListener('blur', handleRelease);
      ctrl.dispose();
      if (autoSlideCtrlRef.current === ctrl) {
        autoSlideCtrlRef.current = null;
      }
    };
  }, []);

  const handleShowcaseRotate = useCallback(() => {
    autoSlideCtrlRef.current?.onRotate();
  }, []);

  const stepSlide = useCallback(
    (dir: 'next' | 'prev') => {
      if (totalSlides <= 1) return;
      autoSlideCtrlRef.current?.onSlideChanged();
      const outEl = outgoingRef.current;
      hasSnapshotRef.current = Boolean(outEl && viewerApiRef.current?.snapshotTo?.(outEl));
      dirRef.current = dir;
      setSlideIdx((i) => (dir === 'next' ? (i + 1) % totalSlides : (i - 1 + totalSlides) % totalSlides));
    },
    [totalSlides]
  );

  const goPrev = () => stepSlide('prev');
  const goNext = () => stepSlide('next');

  useLayoutEffect(() => {
    if (prevPostIdRef.current === activePost.id) return;
    prevPostIdRef.current = activePost.id;
    viewerApiRef.current?.resetView?.({ immediate: true });
  }, [activePost.id]);

  useEffect(() => {
    if (paused || totalSlides <= 1) return;
    const timer = window.setInterval(() => {
      stepSlide('next');
    }, 4500);
    return () => window.clearInterval(timer);
  }, [paused, totalSlides, slideIdx, stepSlide]);

  useLayoutEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true;
      return;
    }

    stageAnimRef.current?.cancel();
    outAnimRef.current?.cancel();
    capAnimRef.current?.cancel();

    const stageEl = stageRef.current;
    if (!stageEl || typeof stageEl.animate !== 'function') return;

    const easing =
      window.getComputedStyle(stageEl).getPropertyValue('--ease-out').trim() ||
      'cubic-bezier(0.23, 1, 0.32, 1)';
    const reduced =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const dir = dirRef.current;

    stageAnimRef.current = stageEl.animate(
      reduced
        ? [{ opacity: 0 }, { opacity: 1 }]
        : [
            { transform: `translate3d(${dir === 'next' ? '44px' : '-44px'}, 0, 0)`, opacity: 0 },
            { transform: 'translate3d(0, 0, 0)', opacity: 1 },
          ],
      { duration: reduced ? 160 : 420, easing, fill: 'backwards' }
    );

    const outEl = outgoingRef.current;
    if (hasSnapshotRef.current && outEl && typeof outEl.animate === 'function') {
      outAnimRef.current = outEl.animate(
        reduced
          ? [{ opacity: 1 }, { opacity: 0 }]
          : [
              { transform: 'translate3d(0, 0, 0)', opacity: 1 },
              { transform: `translate3d(${dir === 'next' ? '-44px' : '44px'}, 0, 0)`, opacity: 0 },
            ],
        { duration: reduced ? 140 : 360, easing, fill: 'forwards' }
      );
    }

    const capEl = captionInnerRef.current;
    if (capEl && typeof capEl.animate === 'function') {
      capAnimRef.current = capEl.animate(
        reduced
          ? [{ opacity: 0 }, { opacity: 1 }]
          : [
              { transform: `translate3d(${dir === 'next' ? '14px' : '-14px'}, 0, 0)`, opacity: 0 },
              { transform: 'translate3d(0, 0, 0)', opacity: 1 },
            ],
        { duration: reduced ? 140 : 300, easing, fill: 'backwards' }
      );
    }
  }, [slideIdx]);

  useEffect(() => {
    return () => {
      stageAnimRef.current?.cancel();
      outAnimRef.current?.cancel();
      capAnimRef.current?.cancel();
    };
  }, []);

  /** 새 초안을 draft에 두고 스튜디오로 (스튜디오 스토어 load('draft')가 읽음) */
  const startDraft = (query: string, init: Parameters<typeof createRoom>[0]) => {
    try {
      rooms.draft.set(createRoom(init));
    } catch {
      // 저장 공간 부족이어도 스튜디오에서 다시 저장 시 안내됨
    }
    nav(`/studio/draft?${query}`);
  };

  const drawPlan = () => startDraft('mode=plan', { title: '새 방', walls: [] });
  const fromTemplate = (t: RoomTemplate) =>
    startDraft('mode=build', { title: `${t.label} (${t.w}×${t.d}m)`, walls: rectWalls(t.w, t.d), wallHeight: t.h });

  return (
    <>
      <section className={`${s.hero} grid-paper`}>
        <div className={s.heroRow}>
          <div className={s.heroInner}>
            <div className={s.eyebrow}>
              <span className={s.eyebrowTag}>ATELIER 3D</span>
            </div>
            <h1 className={s.heroTitle}>나만의 방을 3D로</h1>
            <div className={s.heroSubBlock}>
              <p className={s.heroSub}>치수대로 그리고, 가구를 직접 배치해보세요.</p>
              <div className={s.heroScaleRow} aria-hidden="true">
                <span className={s.heroDim} />
                <span className={`${s.eyebrowMeta} num`}>1 : 50</span>
              </div>
            </div>
            <p className={s.heroNote}>
              설치 없이 브라우저에서 바로 —<br />
              모눈종이에 쓱 그리면 실제 비율의 3D 방이 완성됩니다.
            </p>
            <div className={s.ctas}>
              <Button variant="brand" size="lg" className={s.primaryCta} onClick={drawPlan}>
                새 방 만들기
              </Button>
              <Link className={s.textCta} to={ROUTES.showroom}>
                쇼룸 둘러보기 →
              </Link>
            </div>
            <TemplateChips onPick={fromTemplate} />
          </div>

          <div
            className={s.showcase}
            aria-label="실시간 3D 공간 미리보기"
            onPointerEnter={(e) => autoSlideCtrlRef.current?.onPointerEnter(e.pointerType)}
            onPointerLeave={() => autoSlideCtrlRef.current?.onPointerLeave()}
            onPointerDown={() => autoSlideCtrlRef.current?.onPointerDown()}
          >
            <canvas ref={outgoingRef} className={s.showcaseOutgoing} aria-hidden="true" />
            <div ref={stageRef} className={s.showcaseStage}>
              <Suspense
                fallback={
                  <div className={s.showcaseFallback}>
                    <Spinner size="md" label="3D 공간 불러오는 중" />
                  </div>
                }
              >
                <RoomViewer3D
                  room={activePost.room}
                  showControls={false}
                  showCompass={false}
                  keyboardEnabled={false}
                  zoomEnabled={false}
                  onRotate={handleShowcaseRotate}
                  apiRef={viewerApiRef}
                />
              </Suspense>
            </div>
            <div className={s.showcaseCaption}>
              <div ref={captionInnerRef} className={s.showcaseCaptionInner}>
                <span className={s.showcaseTitle} title={activePost.room.title}>
                  {activePost.room.title}
                </span>
                <div className={s.showcaseLikeWrap}>
                  <button
                    type="button"
                    className={`${s.showcaseLikeBtn}${activeLiked ? ` ${s.showcaseLiked}` : ''}`}
                    aria-pressed={activeLiked}
                    aria-label={`좋아요 ${activePost.likes}개${activeLiked ? ', 누름' : ''}`}
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={() => void postActions.like(activePost)}
                  >
                    <span className={s.showcaseHeart} aria-hidden="true">
                      <HeartIcon filled={activeLiked} />
                    </span>
                    <span className="num">{activePost.likes}</span>
                    <HeartBurst trigger={bursts[activePost.id] ?? 0} />
                  </button>
                </div>
              </div>
            </div>
            {totalSlides > 1 ? (
              <>
                <button
                  type="button"
                  className={`${s.showcaseNav} ${s.showcasePrev}`}
                  onClick={goPrev}
                  aria-label="이전 인기 쇼룸"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="m15 18-6-6 6-6" />
                  </svg>
                </button>
                <button
                  type="button"
                  className={`${s.showcaseNav} ${s.showcaseNext}`}
                  onClick={goNext}
                  aria-label="다음 인기 쇼룸"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="m9 18 6-6-6-6" />
                  </svg>
                </button>
              </>
            ) : null}
          </div>
        </div>
      </section>
      <div className={page.page}>
        <RecentRooms onStart={drawPlan} />
        <PopularPosts />
      </div>
    </>
  );
}
