import type { Room } from '../../../domain/types';
import type { CatalogReader } from '../../../domain/catalog';
import { cloneRoom, collectCustomSpecs } from '../../../domain/room';
import { normalizeRooms } from '../../../domain/migrate';
import type { RoomsApi } from '../../../services/api/rooms.api';
import { RoomAccessError, type DraftStore, type RepositoryContext, type RoomRepository, type StorageMode, type SyncStatus } from './RoomRepository';

/** 서버 `/api/rooms` 래퍼. 초안은 로컬 DraftStore를 받아 쓴다(서버에 초안 개념 없음) */
export class CloudRoomRepository implements RoomRepository {
  readonly mode: StorageMode = 'cloud';

  constructor(
    private readonly api: RoomsApi,
    private readonly ctx: RepositoryContext,
    private readonly catalog: CatalogReader,
    readonly draft: DraftStore,
    private readonly now: () => number = Date.now,
  ) {}

  async list(): Promise<Room[]> {
    return normalizeRooms(await this.api.listRooms());
  }

  /** 404는 null, 401/403은 RoomAccessError로 reject */
  async get(id: string): Promise<Room | null> {
    try {
      return await this.api.getRoom(id);
    } catch (e) {
      if (e instanceof RoomAccessError && e.kind === 'not-found') return null;
      throw e;
    }
  }

  async save(room: Room): Promise<Room> {
    const next: Room = { ...collectCustomSpecs(room, this.catalog), updatedAt: this.now() };
    const owner = this.ctx.user?.id ?? room.ownerId;
    if (owner) next.ownerId = owner;
    return this.api.upsertRoom(next);
  }

  remove(id: string): Promise<void> {
    return this.api.deleteRoom(id);
  }

  clone(src: Room, opts: { title?: string; remixedFrom?: string } = {}): Promise<Room> {
    return this.save(cloneRoom(src, { ...opts, now: this.now() }));
  }

  syncStatus(): SyncStatus {
    return 'saved';
  }

  onSyncStatus(listener: (status: SyncStatus) => void): () => void {
    listener('saved');
    return () => undefined;
  }

  async flush(): Promise<void> {}
}
