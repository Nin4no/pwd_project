import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Button, EmptyState, Spinner, useToast } from '../../design/components';
import type { ShowroomPost } from '../../domain/types';
import { downloadRoomJSON, shareUrl } from '../../domain/share';
import { useRepositories } from '../../app/providers';
import { copyText, errorText, formatDate } from '../rooms/roomMeta';
import { LikeButton } from './PostCard';
import { FurnitureList, RoomStats, RoomViewer3D } from './RoomViewer';
import { usePostActions } from './usePostActions';
import page from '../../app/Page.module.css';

/** 쇼룸 상세: 읽기 전용 3D 뷰어 + 좋아요(likedByMe 초기값)·리믹스·(내 글) 삭제 */
export default function ShowroomViewPage() {
  const { postId = '' } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const { showroom } = useRepositories();
  const [post, setPost] = useState<ShowroomPost | null | undefined>(undefined);

  useEffect(() => {
    let alive = true;
    setPost(undefined);
    showroom
      .get(postId)
      .then((p) => alive && setPost(p))
      .catch((err: unknown) => {
        if (!alive) return;
        setPost(null);
        toast.show(errorText(err, '게시물을 불러오지 못했습니다.'), 'error');
      });
    return () => {
      alive = false;
    };
  }, [showroom, postId, toast]);

  const actions = usePostActions((_id, next) => {
    if (next) setPost(next);
    else nav('/showroom');
  });

  if (post === undefined) {
    return (
      <div className={page.page}>
        <div className={page.loading}>
          <Spinner label="게시물을 불러오는 중" />
        </div>
      </div>
    );
  }

  if (!post) {
    return (
      <div className={page.page}>
        <EmptyState
          title="게시물을 찾을 수 없습니다"
          description="삭제되었거나 주소가 잘못되었습니다."
          action={
            <Button variant="primary" onClick={() => nav('/showroom')}>
              쇼룸 갤러리로
            </Button>
          }
        />
      </div>
    );
  }

  const copyLink = async () => {
    if (await copyText(shareUrl(post.room))) toast.show('공유 링크가 복사되었습니다.');
  };

  return (
    <div className={page.page}>
      <div className={page.back}>
        <Link to="/showroom">← 쇼룸 갤러리</Link>
      </div>
      <div className={page.viewerLayout}>
        <RoomViewer3D room={post.room} />
        <aside className={page.panel} aria-label="게시물 정보">
          <div>
            <h1 className={page.panelTitle}>{post.room.title}</h1>
            <div className={page.panelMeta}>
              <span>
                작성자 <b>{post.author}</b>
              </span>
              <span className="num">{formatDate(post.sharedAt)}</span>
              <span>
                리믹스 <span className="num">{post.remixCount}</span>회
              </span>
            </div>
          </div>
          {post.description ? <p className={page.panelDesc}>{post.description}</p> : null}
          <RoomStats room={post.room} />
          <div className={page.row}>
            <LikeButton size="md" liked={actions.isLiked(post)} likes={post.likes} onClick={() => void actions.like(post)} />
            <Button variant="primary" onClick={() => void actions.remix(post)} title="이 방 구조와 가구 배치를 내 저장함으로 복제">
              리믹스
            </Button>
          </div>
          <div className={page.row}>
            <Button variant="ghost" size="sm" onClick={() => void copyLink()}>
              링크 복사
            </Button>
            <Button variant="ghost" size="sm" onClick={() => downloadRoomJSON(post.room)}>
              JSON 다운로드
            </Button>
            {actions.isMine(post) ? (
              <Button variant="danger" size="sm" onClick={() => void actions.remove(post)}>
                삭제
              </Button>
            ) : null}
          </div>
          <details className={page.accordion}>
            <summary className={page.accordionSummary}>배치된 가구 ({post.room.furniture.length})</summary>
            <FurnitureList room={post.room} />
          </details>
        </aside>
      </div>
    </div>
  );
}
