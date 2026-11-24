import { RoomAccessError } from '../../features/rooms/repository/RoomRepository';

/**
 * api 모듈이 쓰는 최소 HTTP 클라이언트 형태 (axios 인스턴스와 호환).
 * 테스트에서는 가짜 객체를 주입한다 — 이 파일은 `../http`(import.meta.env 사용)를 import하지 않는다.
 */
export interface HttpClient {
  get<T = unknown>(url: string, config?: { params?: Record<string, unknown> }): Promise<{ data: T }>;
  post<T = unknown>(url: string, body?: unknown): Promise<{ data: T }>;
  put<T = unknown>(url: string, body?: unknown): Promise<{ data: T }>;
  delete<T = unknown>(url: string): Promise<{ data: T }>;
}

export interface HttpClients {
  /** Supabase 세션 토큰을 붙이는 클라이언트 */
  authApi: HttpClient;
  /** 토큰 없이 호출 */
  publicApi: HttpClient;
}

/** 서버 응답 `{ data }` 언래핑. 구 코드처럼 `{ data: { room } }` 등 한 겹 더 싼 형태도 허용 */
export function unwrap<T = unknown>(res: { data: unknown }, inner?: string): T {
  const body = res?.data as Record<string, unknown> | undefined;
  const data = (body && typeof body === 'object' && 'data' in body ? body.data : body) as Record<string, unknown> | undefined;
  if (inner && data && typeof data === 'object' && inner in data) return data[inner] as T;
  return data as T;
}

export function statusOf(error: unknown): number | undefined {
  const e = error as { response?: { status?: unknown }; status?: unknown } | null;
  const s = e?.response?.status ?? e?.status;
  return typeof s === 'number' ? s : undefined;
}

export function serverMessage(error: unknown): string | undefined {
  const e = error as { response?: { data?: { message?: unknown; error?: { message?: unknown } } }; message?: unknown } | null;
  const m = e?.response?.data?.message ?? e?.response?.data?.error?.message ?? e?.message;
  return typeof m === 'string' && m ? m : undefined;
}

/** HTTP 오류 → RoomAccessError (401 unauthorized / 403 forbidden / 404 not-found / 그 외 network). status는 보존 */
export function toAccessError(error: unknown): RoomAccessError {
  if (error instanceof RoomAccessError) return error;
  const status = statusOf(error);
  const kind = status === 401 ? 'unauthorized' : status === 403 ? 'forbidden' : status === 404 ? 'not-found' : 'network';
  const out = new RoomAccessError(kind, serverMessage(error));
  (out as RoomAccessError & { status?: number }).status = status;
  return out;
}

export async function call<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    throw toAccessError(e);
  }
}

export const enc = encodeURIComponent;
