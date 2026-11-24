/**
 * 기본 배선 — 실제 axios 인스턴스(`../http`, Supabase 토큰 인터셉터)로 api 모듈을 만든다.
 * `import.meta.env`에 의존하므로 node 테스트에서는 import하지 말고 각 `create*Api`에 가짜 클라이언트를 주입할 것.
 */
import { authApi, publicApi } from './http';
import type { HttpClients } from './client';
import { createRoomsApi } from './rooms.api';
import { createShowroomApi } from './showroom.api';
import { createAuthApi } from './auth.api';
import { createAiApi } from './ai.api';

export const httpClients: HttpClients = { authApi, publicApi };
export const roomsApi = createRoomsApi(httpClients);
export const authApiService = createAuthApi(httpClients);
export const aiApi = createAiApi(httpClients);
export const createDefaultShowroomApi = (isLoggedIn: () => boolean) => createShowroomApi(httpClients, isLoggedIn);

export type { HttpClients, HttpClient } from './client';
export type { RoomsApi } from './rooms.api';
export type { ShowroomApi, CreatePostBody } from './showroom.api';
export type { AuthApi } from './auth.api';
export type { AiApi, GenerateFurnitureResponse, AnalyzeRoomPhotoResponse } from './ai.api';
