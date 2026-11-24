import type { User } from '../../domain/types';
import { uid } from '../../domain/ids';
import { STORAGE_KEYS, readJson, type KeyValueStorage } from '../rooms/repository/kv';

/** local 모드 사용자 레코드 (`dyr:users`, 구 StoredUserRecord와 같은 형식) */
export interface StoredUserRecord {
  id: string;
  email: string;
  displayName: string;
  passwordHash: string;
  createdAt: number;
}

export const newUserId = () => uid('usr_');

const INVALID = '등록되지 않은 이메일이거나 비밀번호가 올바르지 않습니다.';

/** SHA-256 hex (WebCrypto 없으면 구 코드와 같은 FNV 폴백) */
export async function hashPassword(password: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (subtle && typeof subtle.digest === 'function') {
    try {
      const buf = await subtle.digest('SHA-256', new TextEncoder().encode(password));
      return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
    } catch {
      // 아래 폴백
    }
  }
  let hash = 0x811c9dc5;
  for (let i = 0; i < password.length; i++) {
    hash ^= password.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `hash_${(hash >>> 0).toString(16)}_${password.length}`;
}

/** 브라우저 안에서만 쓰는 가짜 계정 저장소 (Supabase 미설정 시) */
export class LocalUserDirectory {
  constructor(private readonly storage: KeyValueStorage) {}

  private all(): StoredUserRecord[] {
    const v = readJson<unknown>(this.storage, STORAGE_KEYS.users, []);
    return Array.isArray(v) ? (v as StoredUserRecord[]) : [];
  }

  private save(users: StoredUserRecord[]) {
    try {
      this.storage.setItem(STORAGE_KEYS.users, JSON.stringify(users));
    } catch (e) {
      console.error('Failed to save local users', e);
    }
  }

  private find(email: string) {
    const key = email.toLowerCase();
    return this.all().find((u) => u.email.toLowerCase() === key);
  }

  async verify(email: string, password: string): Promise<User> {
    const found = this.find(email);
    if (!found || found.passwordHash !== (await hashPassword(password))) throw new Error(INVALID);
    return { id: found.id, email: found.email, displayName: found.displayName, provider: 'local', createdAt: found.createdAt };
  }

  async register(email: string, password: string, displayName: string, now = Date.now()): Promise<User> {
    if (this.find(email)) throw new Error('이미 등록된 이메일 주소입니다.');
    const user: User = { id: newUserId(), email, displayName, provider: 'local', createdAt: now };
    this.save([...this.all(), { id: user.id, email, displayName, passwordHash: await hashPassword(password), createdAt: now }]);
    return user;
  }

  /** 표시명 변경을 계정 레코드에도 반영 (다음 로그인 때 유지) */
  rename(id: string, displayName: string): void {
    const users = this.all();
    const u = users.find((x) => x.id === id);
    if (!u) return;
    u.displayName = displayName;
    this.save(users);
  }
}
