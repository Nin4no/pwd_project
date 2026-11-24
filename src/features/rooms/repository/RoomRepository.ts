import type { Room, ShowroomPost, User } from '../../../domain/types';

/**
 * 저장소 계약 (WP1에서 구현: Local · Cloud · Synced).
 * - 모든 메서드는 정규화된(normalizeRoom) 값을 반환한다.
 * - `save`는 로컬 저장이 성공하면 즉시 resolve. 클라우드 반영은 큐(SyncedRoomRepository)가 담당하고 `syncStatus`로 노출.
 * - 소유권 규칙(현행 유지): cloud 모드에서 로그인 사용자는 본인 방만, 비로그인은 소유자 없는 방만. local 모드는 소유자 없는 방 + 본인 방.
 */
export type SyncStatus = 'saved' | 'syncing' | 'error';
export type StorageMode = 'cloud' | 'local';

export interface DraftStore {
  get(): Room | null;
  set(room: Room): void;
  clear(): void;
}

export class RoomAccessError extends Error {
  constructor(public readonly kind: 'not-found' | 'forbidden' | 'unauthorized' | 'network', message?: string) {
    super(message ?? kind);
    this.name = 'RoomAccessError';
  }
}

export interface RoomRepository {
  readonly mode: StorageMode;
  list(): Promise<Room[]>;
  /** 없으면 null. 권한 문제는 RoomAccessError('forbidden' | 'unauthorized')로 reject */
  get(id: string): Promise<Room | null>;
  /** 저장 후 최종 Room(소유자·updatedAt·customSpecs 반영) 반환 */
  save(room: Room): Promise<Room>;
  remove(id: string): Promise<void>;
  /** 새 id로 복제 저장 (리믹스·공유 가져오기). remixedFrom은 게시물 id */
  clone(src: Room, opts?: { title?: string; remixedFrom?: string }): Promise<Room>;
  readonly draft: DraftStore;
  syncStatus(): SyncStatus;
  onSyncStatus(listener: (status: SyncStatus) => void): () => void;
  /** 온라인 복귀·로그인 직후 보류 큐 재전송 */
  flush(): Promise<void>;
}

export interface ShowroomRepository {
  readonly mode: StorageMode;
  list(limit?: number): Promise<ShowroomPost[]>;
  get(id: string): Promise<ShowroomPost | null>;
  /** 게시(같은 방 재게시는 교체). 게시물 제목은 post.room.title, 작성자 표시명은 post.author */
  publish(post: ShowroomPost): Promise<ShowroomPost>;
  remove(id: string): Promise<void>;
  toggleLike(id: string): Promise<{ liked: boolean; likes: number }>;
  /** 원본 리믹스 수 +1과 내 저장함 복제를 한 번에 */
  remix(post: ShowroomPost): Promise<Room>;
  isLiked(id: string): boolean;
}

/** 저장소 팩토리 입력 — 세션 스토어가 제공 */
export interface RepositoryContext {
  mode: StorageMode;
  user: User | null;
}
