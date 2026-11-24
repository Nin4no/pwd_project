import type { Room } from '../../../domain/types';
import { cloneRoom } from '../../../domain/room';
import type { RepositoryContext, RoomRepository, StorageMode, SyncStatus } from './RoomRepository';
import { isVisible, type LocalRoomRepository } from './LocalRoomRepository';
import type { CloudRoomRepository } from './CloudRoomRepository';
import type { SyncQueue } from './syncQueue';

/**
 * 로컬 우선 저장소 (cloud 모드).
 * - save: 로컬 저장 즉시 resolve → 로그인 상태면 syncQueue로 서버 반영
 * - get: 로컬 → 없으면 서버(200 캐시 / 404 null / 401·403 reject)
 * - list: 로컬 + (로그인 시) 서버 병합, 같은 id는 updatedAt 최신 우선. 서버 실패 시 로컬만
 */
export class SyncedRoomRepository implements RoomRepository {
  readonly mode: StorageMode;

  constructor(
    private readonly local: LocalRoomRepository,
    private readonly cloud: CloudRoomRepository,
    private readonly queue: SyncQueue,
    private readonly ctx: RepositoryContext,
    private readonly now: () => number = Date.now,
  ) {
    this.mode = ctx.mode;
  }

  get draft() {
    return this.local.draft;
  }

  private get cloudActive() {
    return this.ctx.mode === 'cloud' && !!this.ctx.user;
  }

  async list(): Promise<Room[]> {
    const local = await this.local.list();
    if (!this.cloudActive) return local;
    let remote: Room[];
    try {
      remote = await this.cloud.list();
    } catch (err) {
      console.warn('Cloud rooms could not be loaded', err);
      return local;
    }
    const byId = new Map(local.map((r) => [r.id, r]));
    const newer: Room[] = [];
    for (const r of remote) {
      const mine = byId.get(r.id);
      // 아직 올라가지 않은 로컬 변경(대기열)은 덮어쓰지 않음
      if (mine && (mine.updatedAt >= r.updatedAt || this.queue.has(r.id))) continue;
      byId.set(r.id, r);
      newer.push(r);
    }
    if (newer.length) {
      try {
        this.local.put(newer);
      } catch (err) {
        console.warn('Cloud rooms could not be cached', err);
      }
    }
    return Array.from(byId.values())
      .filter((r) => isVisible(r, this.ctx))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async get(id: string): Promise<Room | null> {
    const local = await this.local.get(id);
    if (local || this.ctx.mode !== 'cloud') return local;
    const remote = await this.cloud.get(id);
    if (remote) {
      try {
        this.local.put([remote]);
      } catch (err) {
        console.warn('Cloud room could not be cached', err);
      }
    }
    return remote;
  }

  async save(room: Room): Promise<Room> {
    const saved = await this.local.save(room);
    if (this.cloudActive) this.queue.enqueue(saved);
    return saved;
  }

  async remove(id: string): Promise<void> {
    await this.local.remove(id);
    this.queue.discard(id);
    if (!this.cloudActive) return;
    try {
      await this.cloud.remove(id);
    } catch (err) {
      // 구 deleteCloudRoom과 동일: 서버 삭제 실패는 로그만
      console.warn('deleteCloudRoom failed', err);
    }
  }

  clone(src: Room, opts: { title?: string; remixedFrom?: string } = {}): Promise<Room> {
    return this.save(cloneRoom(src, { ...opts, now: this.now() }));
  }

  syncStatus(): SyncStatus {
    return this.queue.status();
  }

  onSyncStatus(listener: (status: SyncStatus) => void): () => void {
    return this.queue.subscribe(listener);
  }

  flush(): Promise<void> {
    return this.queue.flush();
  }
}
