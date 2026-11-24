import type { FurnitureCategory, FurnitureSpec, Room } from './types';
import { normalizeSpec } from './migrate';

/** 읽기 전용 카탈로그 뷰 — 엔진·도메인 연산은 이 인터페이스만 받는다 */
export interface CatalogReader {
  get(id: string): FurnitureSpec | undefined;
  /** 사용자 AI 가구 → 기본 카탈로그 순 */
  list(): FurnitureSpec[];
  byCategory(category: FurnitureCategory | 'all' | 'ai'): FurnitureSpec[];
  search(query: string, category?: FurnitureCategory | 'all' | 'ai'): FurnitureSpec[];
}

/** 사용자 AI 가구 영속 — 기본 구현은 localStorage `dyr:custom_furniture` (기존 키 유지) */
export interface CatalogStorage {
  load(): FurnitureSpec[];
  save(specs: FurnitureSpec[]): void;
}

export const CUSTOM_FURNITURE_KEY = 'dyr:custom_furniture';

export function localStorageCatalogStorage(key = CUSTOM_FURNITURE_KEY): CatalogStorage {
  return {
    load() {
      try {
        const raw = globalThis.localStorage?.getItem(key);
        const parsed: unknown = raw ? JSON.parse(raw) : [];
        return Array.isArray(parsed) ? parsed.map(normalizeSpec).filter((s): s is FurnitureSpec => !!s) : [];
      } catch {
        return [];
      }
    },
    save(specs) {
      try {
        globalThis.localStorage?.setItem(key, JSON.stringify(specs));
      } catch {
        // 저장 공간 부족 — 메모리 상태는 유지
      }
    },
  };
}

export const memoryCatalogStorage = (initial: FurnitureSpec[] = []): CatalogStorage => {
  let data = [...initial];
  return { load: () => [...data], save: (s) => void (data = [...s]) };
};

const matches = (s: FurnitureSpec, q: string) => {
  const t = q.trim().toLowerCase();
  if (!t) return true;
  return [s.name, s.brand, s.material, s.prompt].some((v) => v?.toLowerCase().includes(t));
};

/**
 * 카탈로그 레지스트리 — 기본 카탈로그(불변) + 사용자 AI 가구(영속) + 방 범위 스펙(scoped).
 * 전역 가변 Map을 대체한다. 방을 읽는다고 레지스트리가 바뀌지 않는다.
 */
export class CatalogRegistry implements CatalogReader {
  private readonly base = new Map<string, FurnitureSpec>();
  private user = new Map<string, FurnitureSpec>();
  private readonly listeners = new Set<() => void>();

  constructor(base: FurnitureSpec[], private readonly storage: CatalogStorage = memoryCatalogStorage()) {
    for (const s of base) this.base.set(s.id, s);
    for (const s of storage.load()) if (!this.base.has(s.id)) this.user.set(s.id, { ...s, source: 'ai' });
  }

  get(id: string): FurnitureSpec | undefined {
    return this.user.get(id) ?? this.base.get(id);
  }

  list(): FurnitureSpec[] {
    return [...this.user.values(), ...this.base.values()];
  }

  userFurniture(): FurnitureSpec[] {
    return [...this.user.values()];
  }

  byCategory(category: FurnitureCategory | 'all' | 'ai'): FurnitureSpec[] {
    if (category === 'all') return this.list();
    if (category === 'ai') return this.userFurniture();
    return this.list().filter((s) => s.category === category);
  }

  search(query: string, category: FurnitureCategory | 'all' | 'ai' = 'all'): FurnitureSpec[] {
    return this.byCategory(category).filter((s) => matches(s, query));
  }

  isBase(id: string) {
    return this.base.has(id);
  }

  addUserFurniture(spec: FurnitureSpec): FurnitureSpec {
    const normalized: FurnitureSpec = { ...spec, source: 'ai' };
    this.user = new Map([[normalized.id, normalized], ...this.user]);
    this.persist();
    return normalized;
  }

  removeUserFurniture(id: string): void {
    if (this.base.has(id) || !this.user.delete(id)) return;
    this.persist();
  }

  /** 방에 내장된 customSpecs를 우선 조회하는 읽기 뷰 — 레지스트리는 오염되지 않음 */
  scoped(room: Pick<Room, 'customSpecs'>): CatalogReader {
    const local = new Map<string, FurnitureSpec>();
    for (const s of room.customSpecs ?? []) if (s?.id) local.set(s.id, s);
    if (local.size === 0) return this;
    const parent = this;
    const merged = () => [...Array.from(local.values()).filter((s) => !parent.user.has(s.id)), ...parent.list()];
    return {
      get: (id) => parent.get(id) ?? local.get(id),
      list: merged,
      byCategory: (c) => (c === 'all' ? merged() : c === 'ai' ? merged().filter((s) => s.source === 'ai') : merged().filter((s) => s.category === c)),
      search: (q, c = 'all') => (c === 'all' ? merged() : c === 'ai' ? merged().filter((s) => s.source === 'ai') : merged().filter((s) => s.category === c)).filter((s) => matches(s, q)),
    };
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  }

  private persist() {
    this.storage.save(this.userFurniture());
    for (const l of this.listeners) l();
  }
}
