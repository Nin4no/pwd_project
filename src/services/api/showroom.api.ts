import type { Room, ShowroomPost } from '../../domain/types';
import { normalizePost, normalizeRoom } from '../../domain/migrate';
import { call, enc, unwrap, type HttpClients } from './client';
import { RoomAccessError } from '../../features/rooms/repository/RoomRepository';

export interface CreatePostBody {
  id: string;
  room: Room;
  author?: string;
  description?: string;
}

/** 서버 `/api/showroom` — 목록·조회는 optionalAuth, 나머지는 isAuthenticated */
export interface ShowroomApi {
  listPosts(limit?: number): Promise<ShowroomPost[]>;
  getPost(id: string): Promise<ShowroomPost>;
  createPost(body: CreatePostBody): Promise<ShowroomPost>;
  deletePost(id: string): Promise<void>;
  likePost(id: string): Promise<{ liked: boolean; likes: number }>;
  remixPost(id: string): Promise<Room>;
}

const asPost = (raw: unknown): ShowroomPost => {
  const post = normalizePost(raw);
  if (!post) throw new RoomAccessError('network', '게시물 응답이 올바르지 않습니다.');
  return post;
};

/** `isLoggedIn()`이 true면 optionalAuth 라우트에도 토큰을 붙인다(likedByMe 계산용) */
export function createShowroomApi({ authApi, publicApi }: HttpClients, isLoggedIn: () => boolean = () => true): ShowroomApi {
  const optional = () => (isLoggedIn() ? authApi : publicApi);
  return {
    listPosts: (limit) =>
      call(async () => {
        const list = unwrap<unknown>(await optional().get('/api/showroom', { params: limit ? { limit } : undefined }), 'posts');
        if (!Array.isArray(list)) throw new RoomAccessError('network', '쇼룸 응답이 올바르지 않습니다.');
        return list.map(normalizePost).filter((p): p is ShowroomPost => !!p);
      }),
    getPost: (id) => call(async () => asPost(unwrap(await optional().get(`/api/showroom/${enc(id)}`), 'post'))),
    createPost: (body) =>
      call(async () =>
        asPost(
          unwrap(
            await authApi.post('/api/showroom', { id: body.id, room: body.room, author: body.author, description: body.description }),
            'post',
          ),
        ),
      ),
    deletePost: (id) =>
      call(async () => {
        await authApi.delete(`/api/showroom/${enc(id)}`);
      }),
    likePost: (id) =>
      call(async () => {
        const d = unwrap<{ liked?: unknown; likes?: unknown }>(await authApi.post(`/api/showroom/${enc(id)}/like`));
        return { liked: Boolean(d?.liked), likes: typeof d?.likes === 'number' ? d.likes : 0 };
      }),
    remixPost: (id) =>
      call(async () => {
        const room = normalizeRoom(unwrap(await authApi.post(`/api/showroom/${enc(id)}/remix`), 'room'));
        if (!room) throw new RoomAccessError('network', '리믹스 응답이 올바르지 않습니다.');
        return room;
      }),
  };
}
