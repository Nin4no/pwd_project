import { useEffect, useState } from 'react';
import { useRepositories } from '../../app/providers';
import { SAMPLE_POSTS } from '../../data/sampleRooms';
import type { ShowroomPost } from '../../domain/types';
import { subscribeShowroomPostChange } from './showroomEvents';

/** 좋아요 내림차순으로 상위 N개 쇼룸 게시물 추출 (불변) */
export function selectPopularPosts(posts: readonly ShowroomPost[], limit = 3): ShowroomPost[] {
  return [...posts].sort((a, b) => b.likes - a.likes).slice(0, limit);
}

/** 인기 쇼룸 게시물 조회 훅 (초기 페인트는 SAMPLE_POSTS 폴백으로 즉시 제공) */
export function usePopularPosts(limit = 3): { posts: ShowroomPost[]; loading: boolean } {
  const { showroom } = useRepositories();
  const [posts, setPosts] = useState<ShowroomPost[]>(() => selectPopularPosts(SAMPLE_POSTS, limit));
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    showroom
      .list()
      .then((list) => {
        if (!alive) return;
        setPosts(list.length > 0 ? selectPopularPosts(list, limit) : selectPopularPosts(SAMPLE_POSTS, limit));
        setLoading(false);
      })
      .catch(() => {
        if (!alive) return;
        setPosts(selectPopularPosts(SAMPLE_POSTS, limit));
        setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [showroom, limit]);

  useEffect(() => {
    return subscribeShowroomPostChange((id, next) => {
      setPosts((cur) => {
        if (next === null) {
          const filtered = cur.filter((p) => p.id !== id);
          return filtered.length > 0 ? filtered : selectPopularPosts(SAMPLE_POSTS, limit);
        }
        return cur.map((p) => (p.id === id ? { ...p, likes: next.likes, likedByMe: next.likedByMe } : p));
      });
    });
  }, [limit]);

  return { posts, loading };
}
