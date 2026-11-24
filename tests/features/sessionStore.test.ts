import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ProviderState, User } from '../../src/domain/types';
import { createSessionStore, type SupabaseAuthLike, type SyncSource } from '../../src/features/session/createSessionStore';
import { hashPassword } from '../../src/features/session/localUsers';
import { memoryStorage, STORAGE_KEYS } from '../../src/features/rooms/repository/kv';
import { DEFAULT_PROVIDERS, type AuthApi } from '../../src/services/api/auth.api';

const me: User = { id: 'sb-1', email: 'a@b.c', displayName: 'A', provider: 'supabase', createdAt: 1 };
const tick = async (n = 5) => {
  for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r));
};

function fakeAuthApi(over: Partial<AuthApi> = {}): AuthApi & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    me: async () => (calls.push('me'), me),
    providers: async () => {
      calls.push('providers');
      throw new Error('down');
    },
    updateProfile: async (displayName) => (calls.push('updateProfile'), { displayName }),
    deactivate: async () => void calls.push('deactivate'),
    ...over,
  };
}

function fakeSupabase(opts: { signInError?: string; session?: unknown } = {}) {
  const calls: string[] = [];
  let listener: ((e: string, s: unknown | null) => void) | null = null;
  let session = opts.session ?? null;
  const auth: SupabaseAuthLike = {
    signInWithPassword: async () => {
      calls.push('signInWithPassword');
      if (opts.signInError) return { data: {}, error: { message: opts.signInError } };
      session = { user: { id: me.id } };
      return { data: { session }, error: null };
    },
    signUp: async () => (calls.push('signUp'), { data: { session: null, user: { id: 'pending-1' } }, error: null }),
    signOut: async () => {
      calls.push('signOut');
      session = null;
    },
    signInWithOAuth: async ({ provider, options }) => (calls.push(`oauth:${provider}:${String(options?.redirectTo)}`), { error: null }),
    getSession: async () => ({ data: { session } }),
    onAuthStateChange: (cb) => {
      listener = cb;
      return { data: { subscription: { unsubscribe: () => void (listener = null) } } };
    },
  };
  return { auth, calls, emit: (s: unknown | null) => listener?.('SIGNED_IN', s), hasListener: () => !!listener };
}

function fakeQueue(): SyncSource & { flushes: number; set(s: 'saved' | 'syncing' | 'error'): void } {
  const ls = new Set<(s: 'saved' | 'syncing' | 'error') => void>();
  let cur: 'saved' | 'syncing' | 'error' = 'saved';
  return {
    flushes: 0,
    status: () => cur,
    subscribe: (l) => (ls.add(l), l(cur), () => void ls.delete(l)),
    async flush() {
      this.flushes++;
    },
    set(s) {
      cur = s;
      ls.forEach((l) => l(s));
    },
  };
}

test('local: 회원가입(SHA-256 저장)·로그아웃·로그인, dyr:users·dyr:session', async () => {
  const storage = memoryStorage();
  const store = createSessionStore({ supabaseAuth: null, authApi: fakeAuthApi(), storage });
  const s = store.getState();
  assert.equal(s.mode, 'local');
  assert.equal(s.isCloud, false);
  const u = await s.signUp(' kim@x.io ', 'pw1234', '');
  assert.equal(u.displayName, 'kim');
  assert.equal(u.provider, 'local');
  const users = JSON.parse(storage.getItem(STORAGE_KEYS.users)!);
  assert.equal(users[0].passwordHash, await hashPassword('pw1234'));
  assert.equal(JSON.parse(storage.getItem(STORAGE_KEYS.session)!).id, u.id);
  await store.getState().signOut();
  assert.equal(store.getState().user, null);
  assert.equal(storage.getItem(STORAGE_KEYS.session), null);
  const again = await store.getState().signIn('KIM@x.io', 'pw1234');
  assert.equal(again.id, u.id);
  // 새로고침 시 dyr:session 복원
  assert.equal(createSessionStore({ supabaseAuth: null, authApi: fakeAuthApi(), storage }).getState().user?.id, u.id);
});

test('local: 잘못된 비밀번호·중복 가입은 authError 설정 후 reject, loading 해제', async () => {
  const store = createSessionStore({ supabaseAuth: null, authApi: fakeAuthApi(), storage: memoryStorage() });
  await store.getState().signUp('a@a.a', 'pw', 'A');
  await assert.rejects(store.getState().signUp('A@a.a', 'pw', 'B'), /이미 등록된/);
  assert.equal(store.getState().authError, '이미 등록된 이메일 주소입니다.');
  await assert.rejects(store.getState().signIn('a@a.a', 'nope'), /올바르지 않습니다/);
  assert.equal(store.getState().loading, false);
  await assert.rejects(store.getState().socialLogin('google'), /Supabase 인증이 설정되지 않았습니다/);
});

test('인증 창: openAuthModal·requireLogin·showAuthFailure·closeAuthModal, 로그인 성공 시 닫힘', async () => {
  const store = createSessionStore({ supabaseAuth: null, authApi: fakeAuthApi(), storage: memoryStorage() });
  store.getState().requireLogin('쇼룸에 공유하려면 로그인해 주세요.');
  assert.equal(store.getState().authModalOpen, true);
  assert.deepEqual(store.getState().authNotice, { title: '로그인이 필요합니다', message: '쇼룸에 공유하려면 로그인해 주세요.', tone: 'info' });
  store.getState().showAuthFailure({ title: '실패', message: '취소됨' });
  assert.equal(store.getState().authNotice?.title, '실패');
  store.getState().openAuthModal();
  assert.equal(store.getState().authNotice, null);
  await store.getState().signUp('z@z.z', 'pw', 'Z');
  assert.equal(store.getState().authModalOpen, false);
});

test('cloud: 로그인 → /api/auth/me 프로필 + 보류 동기화 flush, 실패 메시지는 authError', async () => {
  const sb = fakeSupabase();
  const api = fakeAuthApi();
  const queue = fakeQueue();
  const store = createSessionStore({ supabaseAuth: sb.auth, authApi: api, syncQueue: queue, storage: memoryStorage() });
  assert.equal(store.getState().mode, 'cloud');
  assert.equal(store.getState().user, null);
  const u = await store.getState().signIn('a@b.c', 'pw');
  assert.equal(u.id, 'sb-1');
  assert.deepEqual(api.calls, ['me']);
  assert.equal(queue.flushes, 1);

  const bad = createSessionStore({ supabaseAuth: fakeSupabase({ signInError: 'Invalid login credentials' }).auth, authApi: fakeAuthApi(), storage: memoryStorage() });
  await assert.rejects(bad.getState().signIn('a@b.c', 'x'));
  assert.equal(bad.getState().authError, 'Invalid login credentials');
});

test('cloud: init — onAuthStateChange 구독·기존 세션 복원·providers 폴백·syncStatus 반영', async () => {
  const sb = fakeSupabase({ session: { user: { id: me.id } } });
  const queue = fakeQueue();
  const store = createSessionStore({ supabaseAuth: sb.auth, authApi: fakeAuthApi(), syncQueue: queue, storage: memoryStorage(), defer: (fn) => fn() });
  const off = store.getState().init();
  await tick();
  assert.equal(store.getState().user?.id, 'sb-1');
  assert.deepEqual(store.getState().providers, DEFAULT_PROVIDERS);
  queue.set('error');
  assert.equal(store.getState().syncStatus, 'error');
  sb.emit(null); // 다른 탭 로그아웃 등
  await tick();
  assert.equal(store.getState().user, null);
  off();
  assert.equal(sb.hasListener(), false);
});

test('cloud: providers 서버 값 사용, 소셜 로그인 redirectTo, 메일 인증 대기 가입은 세션 없음', async () => {
  const providers: ProviderState = { ...DEFAULT_PROVIDERS, google: { provider: 'google', enabled: true } };
  const sb = fakeSupabase();
  const store = createSessionStore({
    supabaseAuth: sb.auth,
    authApi: fakeAuthApi({ providers: async () => providers }),
    storage: memoryStorage(),
    origin: () => 'https://app.test',
  });
  assert.equal((await store.getState().loadProviders()).google.enabled, true);
  await store.getState().socialLogin('custom:naver');
  assert.ok(sb.calls.includes('oauth:custom:naver:https://app.test/auth/callback'));
  const pending = await store.getState().signUp('new@x.io', 'pw', '새사람');
  assert.equal(pending.id, 'pending-1');
  assert.equal(store.getState().user, null);
});

test('updateProfile·deactivate·checkAuthStatus', async () => {
  const sb = fakeSupabase();
  const api = fakeAuthApi();
  const store = createSessionStore({ supabaseAuth: sb.auth, authApi: api, storage: memoryStorage() });
  await assert.rejects(store.getState().updateProfile('X'), /로그인이 필요합니다/);
  assert.equal(await store.getState().checkAuthStatus(), null);
  await store.getState().signIn('a@b.c', 'pw');
  assert.equal((await store.getState().checkAuthStatus())?.id, 'sb-1');
  const u = await store.getState().updateProfile('새 이름');
  assert.equal(u.displayName, '새 이름');
  assert.equal(store.getState().user?.displayName, '새 이름');
  await store.getState().deactivate();
  assert.ok(api.calls.includes('deactivate'));
  assert.ok(sb.calls.includes('signOut'));
  assert.equal(store.getState().user, null);
});
