import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, EmptyState, Field, Segmented, Spinner, useToast } from '../../design/components';
import type { ShowroomPost } from '../../domain/types';
import { useRepositories } from '../../app/providers';
import { errorText } from '../rooms/roomMeta';
import PostCard from './PostCard';
import { usePostActions } from './usePostActions';
import page from '../../app/Page.module.css';

type Sort = 'popular' | 'latest' | 'remix';

const SORT_KEY: Record<Sort, (p: ShowroomPost) => number> = {
  popular: (p) => p.likes,
  latest: (p) => p.sharedAt,
  remix: (p) => p.remixCount,
};

/** 쇼룸 갤러리: 검색 · 정렬 · 카드 그리드 */
export default function ShowroomPage() {
  const nav = useNavigate();
  const toast = useToast();
  const { showroom } = useRepositories();
  const [posts, setPosts] = useState<ShowroomPost[] | null>(null);
  const [sort, setSort] = useState<Sort>('popular');
  const [query, setQuery] = useState('');

  useEffect(() => {
    let alive = true;
    setPosts(null);
    showroom
      .list()
      .then((list) => alive && setPosts(list))
      .catch((err: unknown) => {
        if (!alive) return;
        setPosts([]);
        toast.show(errorText(err, '쇼룸을 불러오지 못했습니다.'), 'error');
      });
    return () => {
      alive = false;
    };
  }, [showroom, toast]);

  const actions = usePostActions((id, next) =>
    setPosts((cur) => (cur ? (next ? cur.map((p) => (p.id === id ? next : p)) : cur.filter((p) => p.id !== id)) : cur)),
  );

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    const all = posts ?? [];
    const filtered = q ? all.filter((p) => `${p.room.title} ${p.author} ${p.description}`.toLowerCase().includes(q)) : all;
    return [...filtered].sort((a, b) => SORT_KEY[sort](b) - SORT_KEY[sort](a));
  }, [posts, sort, query]);

  return (
    <div className={page.page}>
      <div className={page.head}>
        <h1 className={page.title}>쇼룸</h1>
        <p className={page.sub}>다른 사람의 방을 둘러보고, 마음에 들면 리믹스해 내 방으로 가져오세요.</p>
      </div>
      <div className={page.toolbar}>
        <Field
          className={page.search}
          label="쇼룸 검색"
          hideLabel
          type="search"
          placeholder="제목 · 작성자 · 소개글 검색"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <Segmented<Sort>
          aria-label="정렬 기준"
          size="sm"
          value={sort}
          onChange={setSort}
          options={[
            { value: 'popular', label: '인기순' },
            { value: 'latest', label: '최신순' },
            { value: 'remix', label: '리믹스순' },
          ]}
        />
      </div>

      {posts === null ? (
        <div className={page.loading}>
          <Spinner label="쇼룸을 불러오는 중" />
        </div>
      ) : posts.length === 0 ? (
        <EmptyState
          title="아직 게시된 쇼룸이 없습니다"
          description="방을 만들고 공유하기에서 쇼룸에 게시해 보세요."
          action={
            <Button variant="primary" onClick={() => nav('/')}>
              새 방 만들기
            </Button>
          }
        />
      ) : list.length === 0 ? (
        <EmptyState
          plain
          title={`"${query}" 검색 결과가 없습니다`}
          action={<Button onClick={() => setQuery('')}>검색 초기화</Button>}
        />
      ) : (
        <div className={page.grid}>
          {list.map((p) => (
            <PostCard
              key={p.id}
              post={p}
              liked={actions.isLiked(p)}
              mine={actions.isMine(p)}
              onLike={() => void actions.like(p)}
              onRemix={() => void actions.remix(p)}
              onRemove={() => void actions.remove(p)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
