/**
 * 저장소 진입점 — 실제 HTTP 클라이언트·localStorage·샘플로 조합한다.
 * `services/api`(import.meta.env)를 import하므로 node 테스트는 `compose.ts`를 직접 쓸 것.
 */
import type { CatalogReader } from '../../../domain/catalog';
import { SAMPLE_POSTS } from '../../../data/sampleRooms';
import { createDefaultShowroomApi, roomsApi } from '../../../services/api';
import type { RepositoryContext } from './RoomRepository';
import { composeRepositories, type Repositories } from './compose';
import { SyncQueue } from './syncQueue';

/** 앱 전역 동기화 대기열 (구 roomDbService.pendingSync와 같은 수명). 세션 스토어가 상태를 구독한다 */
export const appSyncQueue = new SyncQueue({
  upload: (room) => roomsApi.upsertRoom(room),
  // 구 코드와 동일 — Header가 이 이벤트로 로그인 창을 연다
  onAuthRequired: () => {
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('auth:required'));
  },
});

export function createRepositories(ctx: RepositoryContext, catalog: CatalogReader): Repositories {
  return composeRepositories(ctx, catalog, {
    roomsApi,
    showroomApi: createDefaultShowroomApi(() => !!ctx.user),
    syncQueue: appSyncQueue,
    samples: SAMPLE_POSTS,
  });
}

export { composeRepositories, type Repositories, type RepositoryDeps } from './compose';
export * from './RoomRepository';
export { LocalRoomRepository, isVisible } from './LocalRoomRepository';
export { CloudRoomRepository } from './CloudRoomRepository';
export { SyncedRoomRepository } from './SyncedRoomRepository';
export { LocalShowroomRepository, remixTitle } from './LocalShowroomRepository';
export { CloudShowroomRepository } from './CloudShowroomRepository';
export { SyncQueue, type SyncQueueOptions } from './syncQueue';
export { STORAGE_KEYS, memoryStorage, type KeyValueStorage } from './kv';
