import type { Room, ShowroomPost } from '../../../domain/types';
import type { CatalogReader } from '../../../domain/catalog';
import { collectCustomSpecs } from '../../../domain/room';
import { normalizePosts } from '../../../domain/migrate';
import { RoomAccessError, type RepositoryContext, type RoomRepository, type ShowroomRepository, type StorageMode } from './RoomRepository';
import { STORAGE_KEYS, defaultStorage, readJson, writeJson, type KeyValueStorage } from './kv';

export interface LocalShowroomOptions {
  storage?: KeyValueStorage;
  /** 기본 제공 샘플 게시물 (`data/sampleRooms` SAMPLE_POSTS) */
  samples?: ShowroomPost[];
}

type Counter = Record<string, number>;

/** 리믹스 사본 제목 (구 remixPost와 동일) */
export const remixTitle = (post: ShowroomPost) => `${post.room.title} (리믹스)`;

/** localStorage `dyr:showroom`(내 게시물)·`dyr:likes`·`dyr:remix` + 샘플 병합 (구 로컬 저장 모듈의 쇼룸 부분) */
export class LocalShowroomRepository implements ShowroomRepository {
  readonly mode: StorageMode;
  private readonly storage: KeyValueStorage;
  private readonly samples: ShowroomPost[];

  constructor(
    private readonly ctx: RepositoryContext,
    private readonly catalog: CatalogReader,
    private readonly rooms: Pick<RoomRepository, 'clone'>,
    opts: LocalShowroomOptions = {},
  ) {
    this.mode = ctx.mode;
    this.storage = opts.storage ?? defaultStorage();
    this.samples = opts.samples ?? [];
  }

  private mine(): ShowroomPost[] {
    return normalizePosts(readJson<unknown>(this.storage, STORAGE_KEYS.showroom, []));
  }

  private counter(key: string): Counter {
    const v = readJson<unknown>(this.storage, key, {});
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Counter) : {};
  }

  private all(): ShowroomPost[] {
    const likes = this.counter(STORAGE_KEYS.likes);
    const remix = this.counter(STORAGE_KEYS.remix);
    return [...this.mine(), ...this.samples].map((p) => ({
      ...p,
      likes: p.likes + (likes[p.id] ?? 0),
      remixCount: p.remixCount + (remix[p.id] ?? 0),
      likedByMe: !!likes[p.id],
    }));
  }

  async list(limit?: number): Promise<ShowroomPost[]> {
    const all = this.all();
    return limit && limit > 0 ? all.slice(0, limit) : all;
  }

  async get(id: string): Promise<ShowroomPost | null> {
    return this.all().find((p) => p.id === id) ?? null;
  }

  /** 같은 방 재게시는 교체(맨 앞으로) */
  async publish(post: ShowroomPost): Promise<ShowroomPost> {
    const enriched: ShowroomPost = {
      ...post,
      room: collectCustomSpecs(post.room, this.catalog),
    };
    const authorId = this.ctx.user?.id ?? post.authorId;
    if (authorId) enriched.authorId = authorId;
    const rest = this.mine().filter((p) => p.room.id !== enriched.room.id && p.id !== enriched.id);
    writeJson(this.storage, STORAGE_KEYS.showroom, [enriched, ...rest]);
    return enriched;
  }

  async remove(id: string): Promise<void> {
    writeJson(this.storage, STORAGE_KEYS.showroom, this.mine().filter((p) => p.id !== id));
  }

  async toggleLike(id: string): Promise<{ liked: boolean; likes: number }> {
    const likes = this.counter(STORAGE_KEYS.likes);
    const liked = !likes[id];
    if (liked) likes[id] = 1;
    else delete likes[id];
    writeJson(this.storage, STORAGE_KEYS.likes, likes);
    const post = this.all().find((p) => p.id === id);
    return { liked, likes: post?.likes ?? (liked ? 1 : 0) };
  }

  isLiked(id: string): boolean {
    return !!this.counter(STORAGE_KEYS.likes)[id];
  }

  /** 원본 리믹스 수 +1(`dyr:remix`) + 내 저장함에 새 id로 복제 */
  async remix(post: ShowroomPost): Promise<Room> {
    const room = await this.rooms.clone(post.room, { title: remixTitle(post), remixedFrom: post.id });
    const remix = this.counter(STORAGE_KEYS.remix);
    remix[post.id] = (remix[post.id] ?? 0) + 1;
    try {
      writeJson(this.storage, STORAGE_KEYS.remix, remix);
    } catch (e) {
      if (!(e instanceof RoomAccessError)) throw e;
      // 카운터 저장 실패는 무시 — 복제본은 이미 저장됨
    }
    return room;
  }
}
