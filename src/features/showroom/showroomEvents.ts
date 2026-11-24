import type { ShowroomPost } from '../../domain/types';

export type ShowroomPostChangeListener = (id: string, next: ShowroomPost | null) => void;

const listeners = new Set<ShowroomPostChangeListener>();

/** 쇼룸 게시물 변경(좋아요/삭제 등)을 구독 중인 모든 소비자에게 브로드캐스트 */
export function emitShowroomPostChange(id: string, next: ShowroomPost | null): void {
  for (const listener of [...listeners]) {
    listener(id, next);
  }
}

/** 쇼룸 게시물 변경 이벤트 구독 (구독 해제 함수 반환) */
export function subscribeShowroomPostChange(listener: ShowroomPostChangeListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
