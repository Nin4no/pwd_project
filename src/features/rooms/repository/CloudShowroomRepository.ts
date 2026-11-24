import type { Room, ShowroomPost } from '../../../domain/types';
import type { CatalogReader } from '../../../domain/catalog';
import { collectCustomSpecs } from '../../../domain/room';
import type { ShowroomApi } from '../../../services/api/showroom.api';
import { RoomAccessError, type ShowroomRepository, type StorageMode } from './RoomRepository';

export interface CloudShowroomOptions {
  /** 서버 리믹스 결과를 로컬 저장함에 캐시 (구 remixShowroomPost의 saveRoomLocally) */
  cacheRoom?: (room: Room) => void;
}

/** 서버 `/api/showroom` 래퍼. 좋아요 여부는 서버 likedByMe를 메모리에 기억해 isLiked로 동기 조회 */
export class CloudShowroomRepository implements ShowroomRepository {
  readonly mode: StorageMode = 'cloud';
  private readonly liked = new Map<string, boolean>();

  constructor(
    private readonly api: ShowroomApi,
    private readonly catalog: CatalogReader,
    private readonly opts: CloudShowroomOptions = {},
  ) {}

  private remember(posts: ShowroomPost[]) {
    for (const p of posts) if (typeof p.likedByMe === 'boolean') this.liked.set(p.id, p.likedByMe);
    return posts;
  }

  async list(limit?: number): Promise<ShowroomPost[]> {
    return this.remember(await this.api.listPosts(limit));
  }

  async get(id: string): Promise<ShowroomPost | null> {
    try {
      const post = await this.api.getPost(id);
      this.remember([post]);
      return post;
    } catch (e) {
      if (e instanceof RoomAccessError && e.kind === 'not-found') return null;
      throw e;
    }
  }

  async publish(post: ShowroomPost): Promise<ShowroomPost> {
    const room = collectCustomSpecs(post.room, this.catalog);
    return this.api.createPost({ id: post.id, room, author: post.author, description: post.description });
  }

  remove(id: string): Promise<void> {
    return this.api.deletePost(id);
  }

  async toggleLike(id: string): Promise<{ liked: boolean; likes: number }> {
    const res = await this.api.likePost(id);
    this.liked.set(id, res.liked);
    return res;
  }

  isLiked(id: string): boolean {
    return this.liked.get(id) ?? false;
  }

  /** 서버 RPC 1회(원본 remix_count +1 + 내 방 생성) */
  async remix(post: ShowroomPost): Promise<Room> {
    const room = await this.api.remixPost(post.id);
    try {
      this.opts.cacheRoom?.(room);
    } catch (err) {
      console.warn('Remixed room could not be cached', err);
    }
    return room;
  }
}
