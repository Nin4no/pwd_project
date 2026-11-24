import type { Room } from '../../domain/types';
import { normalizeRoom } from '../../domain/migrate';
import { call, enc, unwrap, type HttpClients } from './client';
import { RoomAccessError } from '../../features/rooms/repository/RoomRepository';

/** 서버 `/api/rooms` (isAuthenticated) — 응답은 `{ data }` */
export interface RoomsApi {
  listRooms(): Promise<Room[]>;
  getRoom(id: string): Promise<Room>;
  upsertRoom(room: Room): Promise<Room>;
  deleteRoom(id: string): Promise<void>;
}

const asRoom = (raw: unknown): Room => {
  const room = normalizeRoom(raw);
  if (!room) throw new RoomAccessError('network', '방 데이터 형식이 올바르지 않습니다.');
  return room;
};

export function createRoomsApi({ authApi }: Pick<HttpClients, 'authApi'>): RoomsApi {
  return {
    listRooms: () =>
      call(async () => {
        const list = unwrap<unknown>(await authApi.get('/api/rooms'), 'rooms');
        if (!Array.isArray(list)) throw new RoomAccessError('network', '방 목록 응답이 올바르지 않습니다.');
        return list.map(normalizeRoom).filter((r): r is Room => !!r);
      }),
    getRoom: (id) => call(async () => asRoom(unwrap(await authApi.get(`/api/rooms/${enc(id)}`), 'room'))),
    upsertRoom: (room) => call(async () => asRoom(unwrap(await authApi.put(`/api/rooms/${enc(room.id)}`, room), 'room'))),
    deleteRoom: (id) =>
      call(async () => {
        await authApi.delete(`/api/rooms/${enc(id)}`);
      }),
  };
}
