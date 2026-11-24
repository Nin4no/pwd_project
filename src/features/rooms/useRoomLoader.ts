import { useEffect, useRef, useState } from 'react';
import type { Room } from '../../domain/types';
import type { RoomStatus } from '../studio/types';
import { RoomAccessError, type RoomRepository } from './repository/RoomRepository';

export interface RoomLoadResult {
  room: Room | null;
  status: RoomStatus;
}

/**
 * 순수 로딩 분기 (구 state/useRoomLoader.ts와 같은 의미):
 * 초안 → draft / 로컬·서버 조회(`repository.get`) 200 ready · 없음 not-found · 403 forbidden · 401 unauthorized.
 * 네트워크 등 기타 오류는 구 코드처럼 not-found로 본다.
 */
export async function loadRoom(repository: Pick<RoomRepository, 'get' | 'draft'>, roomId: string, isDraft: boolean): Promise<RoomLoadResult> {
  if (isDraft) {
    const draft = repository.draft.get();
    return { room: draft, status: draft ? 'ready' : 'not-found' };
  }
  try {
    const room = await repository.get(roomId);
    return room ? { room, status: 'ready' } : { room: null, status: 'not-found' };
  } catch (err) {
    if (err instanceof RoomAccessError && (err.kind === 'unauthorized' || err.kind === 'forbidden')) {
      return { room: null, status: err.kind };
    }
    return { room: null, status: 'not-found' };
  }
}

export interface UseRoomLoaderOptions {
  roomId: string;
  isDraft: boolean;
  repository: Pick<RoomRepository, 'get' | 'draft'>;
  /** 401일 때 (예: 세션 스토어 requireLogin). 최신 함수만 참조 — effect 재실행 트리거 아님 */
  onUnauthorized?: () => void;
}

/** Studio 딥링크 로더. 히스토리는 Studio 스토어(WP3) 몫이고 여기서는 { room, status }만 돌려준다 */
export function useRoomLoader({ roomId, isDraft, repository, onUnauthorized }: UseRoomLoaderOptions): RoomLoadResult {
  const [result, setResult] = useState<RoomLoadResult>({ room: null, status: 'loading' });
  const onUnauthorizedRef = useRef(onUnauthorized);
  onUnauthorizedRef.current = onUnauthorized;

  useEffect(() => {
    let active = true;
    setResult({ room: null, status: 'loading' });
    void loadRoom(repository, roomId, isDraft).then((next) => {
      if (!active) return;
      setResult(next);
      if (next.status === 'unauthorized') onUnauthorizedRef.current?.();
    });
    return () => {
      active = false;
    };
  }, [roomId, isDraft, repository]);

  return result;
}
