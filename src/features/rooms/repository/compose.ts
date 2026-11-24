import type { ShowroomPost } from '../../../domain/types';
import type { CatalogReader } from '../../../domain/catalog';
import type { RoomsApi } from '../../../services/api/rooms.api';
import type { ShowroomApi } from '../../../services/api/showroom.api';
import type { RepositoryContext, RoomRepository, ShowroomRepository } from './RoomRepository';
import { LocalRoomRepository } from './LocalRoomRepository';
import { CloudRoomRepository } from './CloudRoomRepository';
import { SyncedRoomRepository } from './SyncedRoomRepository';
import { LocalShowroomRepository } from './LocalShowroomRepository';
import { CloudShowroomRepository } from './CloudShowroomRepository';
import type { SyncQueue } from './syncQueue';
import type { KeyValueStorage } from './kv';

export interface Repositories {
  rooms: RoomRepository;
  showroom: ShowroomRepository;
}

/** 외부 의존성 (테스트는 가짜 api·메모리 저장소 주입) */
export interface RepositoryDeps {
  roomsApi: RoomsApi;
  showroomApi: ShowroomApi;
  /** 앱 수명 동안 하나 — 재로그인 후에도 보류 항목을 이어서 보냄 */
  syncQueue: SyncQueue;
  storage?: KeyValueStorage;
  samples?: ShowroomPost[];
  now?: () => number;
}

/**
 * 모드·로그인 상태에 따른 조합 (React·import.meta.env 비의존 — 테스트 가능).
 * - local 모드: 방·쇼룸 모두 localStorage
 * - cloud 모드: 방은 Synced(로컬 우선 + 큐), 쇼룸은 서버
 */
export function composeRepositories(ctx: RepositoryContext, catalog: CatalogReader, deps: RepositoryDeps): Repositories {
  const local = new LocalRoomRepository(ctx, catalog, { storage: deps.storage, now: deps.now });
  if (ctx.mode === 'local') {
    return {
      rooms: local,
      showroom: new LocalShowroomRepository(ctx, catalog, local, { storage: deps.storage, samples: deps.samples }),
    };
  }
  const cloud = new CloudRoomRepository(deps.roomsApi, ctx, catalog, local.draft, deps.now);
  const rooms = new SyncedRoomRepository(local, cloud, deps.syncQueue, ctx, deps.now);
  const showroom = new CloudShowroomRepository(deps.showroomApi, catalog, {
    cacheRoom: (room) => local.put([room]),
  });
  return { rooms, showroom };
}
