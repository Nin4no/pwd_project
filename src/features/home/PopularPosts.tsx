import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { EmptyState, HeartBurst, Spinner } from '../../design/components';
import type { ShowroomPost } from '../../domain/types';
import { useRepositories } from '../../app/providers';
import RoomThumb from '../rooms/RoomThumb';
import { formatPyeong } from '../rooms/roomMeta';
import { HeartIcon } from '../showroom/PostCard';
import { subscribeShowroomPostChange } from '../showroom/showroomEvents';
import { usePostActions } from '../showroom/usePostActions';
import page from '../../app/Page.module.css';
import CardCarousel from './CardCarousel';
import HomeSection from './HomeSection';
import c from './HomeCards.module.css';

const MAX_POPULAR_POSTS = 12;

/** 인기 쇼룸 (좋아요순 최대 12개, 카드 캐러셀) → 쇼룸 갤러리 */
export default function PopularPosts() {
  const { showroom } = useRepositories();
  const [posts, setPosts] = useState<ShowroomPost[] | null>(null);

  useEffect(() => {
    let alive = true;
    showroom
      .list()
      .then((list) => alive && setPosts(list))
      .catch(() => alive && setPosts([]));
    return () => {
      alive = false;
    };
  }, [showroom]);

  useEffect(() => {
    return subscribeShowroomPostChange((id, next) => {
      setPosts((cur) =>
        cur
          ? next
            ? cur.map((p) => (p.id === id ? { ...p, likes: next.likes, likedByMe: next.likedByMe } : p))
            : cur.filter((p) => p.id !== id)
          : cur,
      );
    });
  }, []);

  const actions = usePostActions((id, next) =>
    setPosts((cur) => (cur ? (next ? cur.map((p) => (p.id === id ? next : p)) : cur.filter((p) => p.id !== id)) : cur)),
  );
  const popular = useMemo(
    () => [...(posts ?? [])].sort((a, b) => b.likes - a.likes).slice(0, MAX_POPULAR_POSTS),
    [posts],
  );
  const prevLiked = useRef<Record<string, boolean>>({});
  const [bursts, setBursts] = useState<Record<string, number>>({});

  useEffect(() => {
    const prev = prevLiked.current;
    const next: Record<string, boolean> = {};
    const turnedOn: string[] = [];
    for (const p of popular) {
      const liked = actions.isLiked(p);
      next[p.id] = liked;
      if (p.id in prev && !prev[p.id] && liked) {
        turnedOn.push(p.id);
      }
    }
    prevLiked.current = next;
    if (turnedOn.length > 0) {
      setBursts((cur) => {
        const updated = { ...cur };
        for (const id of turnedOn) updated[id] = (updated[id] ?? 0) + 1;
        return updated;
      });
    }
  }, [popular, actions]);

  return (
    <HomeSection
      titleId="popular-title"
      title="인기 쇼룸"
      moreTo="/showroom"
      moreLabel="쇼룸 갤러리 →"
      framed={posts !== null && popular.length > 0}
    >
      {posts === null ? (
        <div className={page.loading}>
          <Spinner label="인기 쇼룸을 불러오는 중" />
        </div>
      ) : popular.length === 0 ? (
        <EmptyState plain title="표시할 쇼룸 게시물이 없습니다" />
      ) : (
        <CardCarousel label="인기 쇼룸 목록" itemCount={popular.length}>
          {popular.map((p) => {
            const href = `/showroom/${p.id}`;
            const liked = actions.isLiked(p);
            const py = formatPyeong(p.room);
            return (
              <article key={p.id} className={c.card}>
                <Link to={href} className={c.thumb} aria-label={`${p.room.title} 자세히 보기`}>
                  <RoomThumb room={p.room} />
                  <span className={c.thumbLike} title="좋아요 수">
                    <span className={c.heart} aria-hidden="true">
                      <HeartIcon filled />
                    </span>
                    {p.likes}
                  </span>
                </Link>
                <div className={c.body}>
                  <div className={c.head}>
                    <h3 className={c.title} title={p.room.title}>
                      {p.room.title}
                    </h3>
                    <span className={c.pill}>
                      {py}
                      <span className={c.unit}>평</span>
                    </span>
                  </div>
                  <ul className={c.info}>
                    <li title={p.author}>작성자 · {p.author}</li>
                    <li>
                      배치 가구 <span className="num">{p.room.furniture.length}</span>개 · 리믹스{' '}
                      <span className="num">{p.remixCount}</span>회
                    </li>
                  </ul>
                  {p.description ? <p className={c.desc}>{p.description}</p> : null}
                  <div className={c.foot}>
                    <button
                      type="button"
                      className={`${c.likePill}${liked ? ` ${c.liked}` : ''}`}
                      aria-pressed={liked}
                      aria-label={`좋아요 ${p.likes}개${liked ? ', 누름' : ''}`}
                      onClick={() => void actions.like(p)}
                    >
                      <span className={c.heart} aria-hidden="true">
                        <HeartIcon filled={liked} />
                      </span>
                      {p.likes}
                      <HeartBurst trigger={bursts[p.id] ?? 0} />
                    </button>
                    <Link to={href} className={c.more}>
                      자세히 보기 →
                    </Link>
                  </div>
                </div>
              </article>
            );
          })}
        </CardCarousel>
      )}
    </HomeSection>
  );
}
