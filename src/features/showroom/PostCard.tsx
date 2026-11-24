import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge, Button, HeartBurst } from '../../design/components';
import type { ShowroomPost } from '../../domain/types';
import RoomThumb from '../rooms/RoomThumb';
import { formatPyeong } from '../rooms/roomMeta';
import s from './PostCard.module.css';

export function HeartIcon({ filled }: { filled: boolean }) {
  return (
    <svg viewBox="0 0 20 20" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round">
      <path d="M10 16.5s-6.5-3.9-6.5-8.6A3.6 3.6 0 0 1 10 5.6a3.6 3.6 0 0 1 6.5 2.3c0 4.7-6.5 8.6-6.5 8.6z" />
    </svg>
  );
}

export function LikeButton({ liked, likes, onClick, size = 'sm' }: { liked: boolean; likes: number; onClick: () => void; size?: 'sm' | 'md' }) {
  const prevLiked = useRef(liked);
  const [burst, setBurst] = useState(0);

  useEffect(() => {
    if (!prevLiked.current && liked) {
      setBurst((n) => n + 1);
    }
    prevLiked.current = liked;
  }, [liked]);

  return (
    <button
      type="button"
      className={`${s.like} ${s[size]}${liked ? ` ${s.liked}` : ''}`}
      aria-pressed={liked}
      aria-label={`좋아요 ${likes}개${liked ? ', 누름' : ''}`}
      onClick={onClick}
    >
      <span className={s.heart} aria-hidden="true">
        <HeartIcon filled={liked} />
      </span>
      <span className="num">{likes}</span>
      <HeartBurst trigger={burst} />
    </button>
  );
}

export interface PostCardProps {
  post: ShowroomPost;
  liked: boolean;
  mine: boolean;
  onLike: () => void;
  onRemix?: () => void;
  onRemove?: () => void;
}

/** 쇼룸 카드: 썸네일 · 제목 · 평수 · 작성자 · 좋아요 · 리믹스 · (내 글) 삭제 */
export default function PostCard({ post, liked, mine, onLike, onRemix, onRemove }: PostCardProps) {
  const href = `/showroom/${post.id}`;
  return (
    <article className={s.card}>
      <Link to={href} className={s.thumb} aria-label={`${post.room.title} 자세히 보기`}>
        <RoomThumb room={post.room} />
      </Link>
      <div className={s.body}>
        <div className={s.head}>
          <Link to={href} className={s.title} title={post.room.title}>
            {post.room.title}
          </Link>
          <span className={s.area}>
            <span className="num">{formatPyeong(post.room)}</span>평
          </span>
        </div>
        <div className={s.meta}>
          <span className={s.author} title={post.author}>
            {post.author}
          </span>
          {mine ? <Badge tone="info">내 게시물</Badge> : null}
          <span className={s.metaDim}>
            리믹스 <span className="num">{post.remixCount}</span>
          </span>
        </div>
        <div className={s.foot}>
          <LikeButton liked={liked} likes={post.likes} onClick={onLike} />
          <div className={s.actions}>
            {mine && onRemove ? (
              <Button variant="ghost" size="sm" onClick={onRemove}>
                삭제
              </Button>
            ) : null}
            {onRemix ? (
              <Button variant="secondary" size="sm" onClick={onRemix} title="내 저장함으로 복제해 편집">
                리믹스
              </Button>
            ) : null}
          </div>
        </div>
      </div>
    </article>
  );
}
