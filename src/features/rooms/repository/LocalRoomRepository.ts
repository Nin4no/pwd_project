import type { Room } from '../../../domain/types';
import type { CatalogReader } from '../../../domain/catalog';
import { cloneRoom, collectCustomSpecs } from '../../../domain/room';
import { normalizeRoom, normalizeRooms } from '../../../domain/migrate';
import type { DraftStore, RepositoryContext, RoomRepository, StorageMode, SyncStatus } from './RoomRepository';
import { STORAGE_KEYS, defaultStorage, readJson, writeJson, type KeyValueStorage } from './kv';

export interface LocalRoomRepositoryOptions {
  storage?: KeyValueStorage;
  now?: () => number;
}

/** 소유권 필터 — cloud: 로그인은 본인 방만 / 비로그인은 소유자 없는 방만, local: 로그인은 소유자 없는 방 + 본인 방 / 비로그인은 모든 방(구 코드 호환, Fable 결정) */
export function isVisible(room: Room, ctx: RepositoryContext): boolean {
  const uid = ctx.user?.id;
  if (ctx.mode === 'cloud') return uid ? room.ownerId === uid : !room.ownerId;
  return !uid || !room.ownerId || room.ownerId === uid;
}

const byUpdatedDesc = (a: Room, b: Room) => b.updatedAt - a.updatedAt;

export function localDraftStore(storage: KeyValueStorage, catalog: CatalogReader): DraftStore {
  return {
    get: () => normalizeRoom(readJson<unknown>(storage, STORAGE_KEYS.draft, null)),
    set(room) {
      try {
        writeJson(storage, STORAGE_KEYS.draft, collectCustomSpecs(room, catalog));
      } catch {
        // 초안은 best-effort (구 코드도 실패 시 저장하지 않음)
      }
    },
    clear: () => storage.removeItem(STORAGE_KEYS.draft),
  };
}

/** localStorage `dyr:rooms`·`dyr:draft` (구 로컬 저장 모듈과 같은 키·형식) */
export class LocalRoomRepository implements RoomRepository {
  readonly mode: StorageMode;
  readonly draft: DraftStore;
  private readonly storage: KeyValueStorage;
  private readonly now: () => number;

  constructor(private readonly ctx: RepositoryContext, private readonly catalog: CatalogReader, opts: LocalRoomRepositoryOptions = {}) {
    this.mode = ctx.mode;
    this.storage = opts.storage ?? defaultStorage();
    this.now = opts.now ?? Date.now;
    this.draft = localDraftStore(this.storage, catalog);
  }

  /** 필터 없이 전체 (정규화) */
  readAll(): Room[] {
    return normalizeRooms(readJson<unknown>(this.storage, STORAGE_KEYS.rooms, []));
  }

  private writeAll(rooms: Room[]) {
    writeJson(this.storage, STORAGE_KEYS.rooms, rooms);
  }

  async list(): Promise<Room[]> {
    return this.readAll().filter((r) => isVisible(r, this.ctx)).sort(byUpdatedDesc);
  }

  /** 소유권 필터에 걸리면 로컬에 없는 것으로 본다(null) — 권한 판정은 서버가 한다 */
  async get(id: string): Promise<Room | null> {
    const found = this.readAll().find((r) => r.id === id);
    return found && isVisible(found, this.ctx) ? found : null;
  }

  async save(room: Room): Promise<Room> {
    const next: Room = { ...collectCustomSpecs(room, this.catalog), updatedAt: this.now() };
    const owner = this.ctx.user?.id ?? room.ownerId;
    if (owner) next.ownerId = owner;
    this.upsert([next]);
    return next;
  }

  /** 서버에서 받은 방을 그대로 캐시 (updatedAt 유지). 소유자가 비어 있으면 현재 사용자로 채움 */
  put(rooms: Room[]): void {
    const uid = this.ctx.user?.id;
    this.upsert(rooms.map((r) => (r.ownerId || !uid ? r : { ...r, ownerId: uid })));
  }

  private upsert(rooms: Room[]) {
    const all = this.readAll();
    for (const room of rooms) {
      const idx = all.findIndex((r) => r.id === room.id);
      if (idx >= 0) all[idx] = room;
      else all.push(room);
    }
    this.writeAll(all);
  }

  async remove(id: string): Promise<void> {
    this.writeAll(this.readAll().filter((r) => r.id !== id));
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

  async flush(): Promise<void> {
    // 로컬 전용 — 보낼 것이 없음
  }
}
