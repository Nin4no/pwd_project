import { useNavigate } from 'react-router-dom';
import { useToast } from '../../design/components';
import type { ShowroomPost } from '../../domain/types';
import { useRepositories } from '../../app/providers';
import { errorText } from '../rooms/roomMeta';
import { useSessionStore } from '../session/store';
import { emitShowroomPostChange } from './showroomEvents';

/**
 * 쇼룸 게시물 동작 공통 (현행 규칙 유지):
 * cloud 모드 비로그인은 좋아요·리믹스·삭제 → requireLogin, local 모드는 로그인 없이 동작.
 * 성공 시 바뀐 게시물을 onChange로 돌려준다(삭제는 null).
 */
export function usePostActions(onChange?: (id: string, next: ShowroomPost | null) => void) {
  const nav = useNavigate();
  const toast = useToast();
  const { showroom } = useRepositories();
  const user = useSessionStore((st) => st.user);
  const requireLogin = useSessionStore((st) => st.requireLogin);
  const gated = (reason: string) => {
    if (showroom.mode === 'cloud' && !user) {
      requireLogin(reason);
      return true;
    }
    return false;
  };

  const like = async (post: ShowroomPost) => {
    if (gated('좋아요를 누르려면 로그인해 주세요.')) return;
    try {
      const res = await showroom.toggleLike(post.id);
      const next: ShowroomPost = { ...post, likes: res.likes, likedByMe: res.liked };
      onChange?.(post.id, next);
      emitShowroomPostChange(post.id, next);
    } catch (err) {
      toast.show(errorText(err, '좋아요를 반영하지 못했습니다.'), 'error');
    }
  };

  const remix = async (post: ShowroomPost) => {
    if (gated('리믹스하려면 로그인해 주세요.')) return;
    try {
      const room = await showroom.remix(post);
      nav(`/studio/${room.id}`);
    } catch (err) {
      toast.show(errorText(err, '리믹스하지 못했습니다.'), 'error');
    }
  };

  const remove = async (post: ShowroomPost): Promise<boolean> => {
    if (gated('이 기능을 쓰려면 로그인해 주세요.')) return false;
    if (!window.confirm('이 게시물을 쇼룸에서 삭제할까요?')) return false;
    try {
      await showroom.remove(post.id);
      onChange?.(post.id, null);
      emitShowroomPostChange(post.id, null);
      toast.show('게시물이 삭제되었습니다.');
      return true;
    } catch (err) {
      toast.show(errorText(err, '게시물을 삭제하지 못했습니다.'), 'error');
      return false;
    }
  };

  /** 좋아요 표시: 서버 likedByMe 우선, 없으면 저장소 기록 */
  const isLiked = (post: ShowroomPost) => (typeof post.likedByMe === 'boolean' ? post.likedByMe : showroom.isLiked(post.id));

  /** 내 글: 샘플 아님 + (local 모드이거나 작성자 본인) */
  const isMine = (post: ShowroomPost) => !post.builtin && (showroom.mode === 'local' || (!!user && post.authorId === user.id));

  return { like, remix, remove, isLiked, isMine };
}
