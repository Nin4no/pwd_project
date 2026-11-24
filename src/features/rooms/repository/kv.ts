import { RoomAccessError } from './RoomRepository';

/** localStorage와 호환되는 최소 키-값 저장소 (테스트는 메모리 구현 주입) */
export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** 구 코드와 같은 localStorage 키 (값 형식도 동일) */
export const STORAGE_KEYS = {
  rooms: 'dyr:rooms',
  draft: 'dyr:draft',
  showroom: 'dyr:showroom',
  likes: 'dyr:likes',
  remix: 'dyr:remix',
  users: 'dyr:users',
  session: 'dyr:session',
} as const;

export const QUOTA_MESSAGE = '브라우저 저장 공간이 부족합니다. 저장함에서 오래된 방을 삭제해 주세요.';

/** 브라우저 localStorage — 없거나 접근이 막혀 있으면 아무것도 저장하지 않는 저장소 */
export function defaultStorage(): KeyValueStorage {
  try {
    const ls = (globalThis as { localStorage?: KeyValueStorage }).localStorage;
    if (ls) return ls;
  } catch {
    // 접근 차단 (프라이빗 모드 등)
  }
  return { getItem: () => null, setItem: () => undefined, removeItem: () => undefined };
}

export function readJson<T>(storage: KeyValueStorage, key: string, fallback: T): T {
  try {
    const raw = storage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

/** 쓰기 실패(용량 초과 등)는 RoomAccessError('network')로 — UI가 토스트로 표시 */
export function writeJson(storage: KeyValueStorage, key: string, value: unknown): void {
  try {
    storage.setItem(key, JSON.stringify(value));
  } catch {
    throw new RoomAccessError('network', QUOTA_MESSAGE);
  }
}

/** 테스트·SSR용 메모리 저장소 */
export function memoryStorage(initial: Record<string, string> = {}): KeyValueStorage & { dump(): Record<string, string> } {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, String(v)),
    removeItem: (k) => void map.delete(k),
    dump: () => Object.fromEntries(map),
  };
}
