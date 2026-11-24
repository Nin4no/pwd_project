import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ProviderState, User } from '../../src/domain/types';
import {
  createSessionStore,
  type SupabaseAuthLike,
  type SupabaseMfaFactorLike,
  type SupabaseMfaLike,
  type SyncSource,
} from '../../src/features/session/createSessionStore';
import { hashPassword } from '../../src/features/session/localUsers';
import { memoryStorage, STORAGE_KEYS } from '../../src/features/rooms/repository/kv';
import { AuthApiError, createAuthApi, DEFAULT_PROVIDERS, type AuthApi } from '../../src/services/api/auth.api';
import { serverCode, type HttpClients } from '../../src/services/api/client';

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
  assert.equal(again?.id, u.id);
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
  assert.equal(u?.id, 'sb-1');
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


interface FakeMfaOptions {
  initialFactors?: SupabaseMfaFactorLike[];
  currentLevel?: 'aal1' | 'aal2' | null;
  nextLevel?: 'aal1' | 'aal2' | null;
  validCode?: string;
  enrollQrCode?: string;
  emitOnSignIn?: boolean;
  session?: unknown;
}

function fakeSupabaseWithMfa(opts: FakeMfaOptions = {}) {
  const calls: string[] = [];
  let listener: ((e: string, s: unknown | null) => void) | null = null;
  let session: unknown | null = opts.session ?? null;
  let factors: SupabaseMfaFactorLike[] = (opts.initialFactors ?? []).map((f) => ({ ...f }));
  let currentLevel: 'aal1' | 'aal2' | null = opts.currentLevel ?? 'aal1';
  let nextLevel: 'aal1' | 'aal2' | null =
    opts.nextLevel ?? (factors.some((f) => f.status === 'verified') ? 'aal2' : 'aal1');
  const validCode = opts.validCode ?? '123456';
  let enrollSeq = 0;

  const mfa: SupabaseMfaLike = {
    async getAuthenticatorAssuranceLevel() {
      calls.push('mfa.getAal');
      return { data: { currentLevel, nextLevel }, error: null };
    },
    async listFactors() {
      calls.push('mfa.listFactors');
      return {
        data: {
          all: factors.map((f) => ({ ...f })),
          totp: factors.filter((f) => f.factor_type === 'totp' && f.status === 'verified'),
        },
        error: null,
      };
    },
    async enroll(params) {
      calls.push(`mfa.enroll:${params.friendlyName ?? ''}`);
      const id = `factor-new-${++enrollSeq}`;
      factors.push({
        id,
        friendly_name: params.friendlyName,
        factor_type: 'totp',
        status: 'unverified',
      });
      return {
        data: {
          id,
          type: 'totp',
          friendly_name: params.friendlyName,
          totp: {
            qr_code: opts.enrollQrCode ?? 'data:image/svg+xml;utf-8,<svg xmlns="http://www.w3.org/2000/svg"></svg>',
            secret: 'JBSWY3DPEHPK3PXP',
            uri: 'otpauth://totp/app?secret=JBSWY3DPEHPK3PXP',
          },
        },
        error: null,
      };
    },
    async challengeAndVerify({ factorId, code }) {
      calls.push(`mfa.challengeAndVerify:${factorId}:${code}`);
      if (code !== validCode) {
        return { data: null, error: { code: 'invalid_totp', message: 'Invalid TOTP code supplied' } };
      }
      factors = factors.map((f) => (f.id === factorId ? { ...f, status: 'verified' } : f));
      currentLevel = 'aal2';
      nextLevel = 'aal2';
      return { data: { access_token: 'aal2-jwt' }, error: null };
    },
    async unenroll({ factorId }) {
      calls.push(`mfa.unenroll:${factorId}`);
      const target = factors.find((f) => f.id === factorId);
      if (target?.status === 'verified' && currentLevel !== 'aal2') {
        return { data: null, error: { code: 'insufficient_aal', message: 'AAL2 required to unenroll' } };
      }
      factors = factors.filter((f) => f.id !== factorId);
      const stillVerified = factors.some((f) => f.status === 'verified');
      nextLevel = stillVerified ? 'aal2' : 'aal1';
      if (!stillVerified) currentLevel = 'aal1';
      return { data: { id: factorId }, error: null };
    },
  };

  const auth: SupabaseAuthLike = {
    signInWithPassword: async ({ email }) => {
      calls.push('signInWithPassword');
      session = { user: { id: me.id, email } };
      if (opts.emitOnSignIn) listener?.('SIGNED_IN', session);
      return { data: { session }, error: null };
    },
    signUp: async () => (calls.push('signUp'), { data: { session: null, user: { id: 'pending-1' } }, error: null }),
    signOut: async () => {
      calls.push('signOut');
      session = null;
      currentLevel = null;
    },
    signInWithOAuth: async () => ({ error: null }),
    getSession: async () => ({ data: { session } }),
    onAuthStateChange: (cb) => {
      listener = cb;
      return { data: { subscription: { unsubscribe: () => void (listener = null) } } };
    },
    mfa,
  };

  return {
    auth,
    calls,
    getLevel: () => currentLevel,
    setLevel: (lvl: 'aal1' | 'aal2' | null) => {
      currentLevel = lvl;
    },
    emit: (event: string, s: unknown | null) => listener?.(event, s),
  };
}

test('cloud MFA: 미등록 사용자(aal1/aal1)는 추가 조회 없이 기존과 동일하게 로그인', async () => {
  const sb = fakeSupabaseWithMfa({ currentLevel: 'aal1', nextLevel: 'aal1' });
  const api = fakeAuthApi();
  const queue = fakeQueue();
  const store = createSessionStore({ supabaseAuth: sb.auth, authApi: api, syncQueue: queue, storage: memoryStorage() });

  store.getState().openAuthModal();
  const u = await store.getState().signIn('a@b.c', 'pw');
  assert.equal(u?.id, 'sb-1');
  assert.equal(store.getState().mfaChallenge, null);
  assert.equal(store.getState().authModalOpen, false);
  assert.equal(store.getState().mfa.supported, true);
  assert.equal(store.getState().mfa.enrolled, false);
  assert.deepEqual(api.calls, ['me']);
  assert.equal(queue.flushes, 1);
  assert.ok(!sb.calls.includes('mfa.listFactors'));
});

test('cloud MFA: 등록 사용자는 mfaChallenge에서 일시 정지 후 6자리 OTP 검증으로 로그인 완료 (onAuthStateChange 레이스 안전)', async () => {
  const sb = fakeSupabaseWithMfa({
    initialFactors: [{ id: 'totp-1', friendly_name: '내 폰', factor_type: 'totp', status: 'verified' }],
    currentLevel: 'aal1',
    nextLevel: 'aal2',
    validCode: '123456',
    emitOnSignIn: true,
  });
  const api = fakeAuthApi();
  const queue = fakeQueue();
  const store = createSessionStore({
    supabaseAuth: sb.auth,
    authApi: api,
    syncQueue: queue,
    storage: memoryStorage(),
    defer: (fn) => fn(),
  });
  const off = store.getState().init();
  await tick();

  store.getState().openAuthModal();
  const signedIn = await store.getState().signIn('a@b.c', 'pw');
  assert.equal(signedIn, null);
  assert.equal(store.getState().user, null);
  assert.equal(store.getState().authModalOpen, true);
  assert.deepEqual(store.getState().mfaChallenge, { factorId: 'totp-1', email: 'a@b.c' });
  assert.equal(api.calls.includes('me'), false);
  assert.equal(queue.flushes, 0);

  // 잘못된 형식 / 잘못된 코드 검증 시 mfaChallenge 유지
  await assert.rejects(store.getState().verifyMfaChallenge('12ab'), (e: unknown) => (e as { code?: string })?.code === 'mfa_invalid_code');
  assert.ok(store.getState().mfaChallenge);
  await assert.rejects(store.getState().verifyMfaChallenge('999999'), (e: unknown) => (e as { code?: string })?.code === 'invalid_totp');
  assert.ok(store.getState().mfaChallenge);
  assert.equal(store.getState().user, null);

  // 올바른 6자리 코드 검증 → me() 로드 + 동기화 + 모달 닫힘
  const verified = await store.getState().verifyMfaChallenge('123456');
  assert.equal(verified?.id, 'sb-1');
  assert.equal(store.getState().user?.id, 'sb-1');
  assert.equal(store.getState().mfaChallenge, null);
  assert.equal(store.getState().authModalOpen, false);
  assert.equal(store.getState().mfa.currentLevel, 'aal2');
  assert.equal(store.getState().mfa.enrolled, true);
  assert.equal(queue.flushes, 1);

  off();
});

test('cloud MFA: cancelMfaChallenge는 로컬 aal1 세션을 로그아웃하고 mfaChallenge를 정리', async () => {
  const sb = fakeSupabaseWithMfa({
    initialFactors: [{ id: 'totp-1', factor_type: 'totp', status: 'verified' }],
    currentLevel: 'aal1',
    nextLevel: 'aal2',
  });
  const store = createSessionStore({ supabaseAuth: sb.auth, authApi: fakeAuthApi(), storage: memoryStorage() });

  await store.getState().signIn('a@b.c', 'pw');
  assert.equal(store.getState().mfaChallenge?.factorId, 'totp-1');

  await store.getState().cancelMfaChallenge();
  assert.equal(store.getState().mfaChallenge, null);
  assert.equal(store.getState().user, null);
  assert.ok(sb.calls.includes('signOut'));
  assert.equal(store.getState().mfa.enrolled, false);
});

test('cloud MFA: init 시 기존 aal1 세션(nextLevel=aal2)은 mfaChallenge 모달을 열고 me()를 호출하지 않음', async () => {
  const sb = fakeSupabaseWithMfa({
    session: { user: { id: me.id, email: 'a@b.c' } },
    initialFactors: [{ id: 'totp-1', factor_type: 'totp', status: 'verified' }],
    currentLevel: 'aal1',
    nextLevel: 'aal2',
  });
  const api = fakeAuthApi();
  const store = createSessionStore({ supabaseAuth: sb.auth, authApi: api, storage: memoryStorage(), defer: (fn) => fn() });

  const off = store.getState().init();
  await tick();
  assert.equal(store.getState().user, null);
  assert.equal(store.getState().authModalOpen, true);
  assert.deepEqual(store.getState().mfaChallenge, { factorId: 'totp-1', email: 'a@b.c' });
  assert.equal(api.calls.includes('me'), false);
  off();
});

test('cloud MFA: startMfaEnroll(미완료 factor 정리 + QR prefix 보존) → cancel / confirm → unenrollMfa', async () => {
  const sb = fakeSupabaseWithMfa({
    initialFactors: [{ id: 'stale-unverified', factor_type: 'totp', status: 'unverified' }],
    currentLevel: 'aal1',
    nextLevel: 'aal1',
    validCode: '654321',
  });
  const store = createSessionStore({ supabaseAuth: sb.auth, authApi: fakeAuthApi(), storage: memoryStorage() });

  const draft1 = await store.getState().startMfaEnroll('테스트 기기');
  assert.ok(sb.calls.includes('mfa.unenroll:stale-unverified'));
  assert.equal(draft1.qrCode.startsWith('data:image/svg+xml;utf-8,'), true);
  assert.equal(draft1.qrCode.indexOf('data:image/svg+xml;utf-8,', 1), -1);
  assert.equal(store.getState().mfa.enrollment?.factorId, draft1.factorId);

  await store.getState().cancelMfaEnroll();
  assert.equal(store.getState().mfa.enrollment, null);
  assert.ok(sb.calls.includes(`mfa.unenroll:${draft1.factorId}`));

  const draft2 = await store.getState().startMfaEnroll();
  await store.getState().confirmMfaEnroll('654321');
  assert.equal(store.getState().mfa.enrollment, null);
  assert.equal(store.getState().mfa.enrolled, true);
  assert.equal(store.getState().mfa.currentLevel, 'aal2');
  assert.ok(store.getState().mfa.factors.some((f) => f.id === draft2.factorId && f.status === 'verified'));

  await store.getState().unenrollMfa(draft2.factorId);
  assert.equal(store.getState().mfa.enrolled, false);
  assert.equal(store.getState().mfa.currentLevel, 'aal1');
  assert.equal(store.getState().mfa.factors.length, 0);

  // raw <svg 방어적 data URI 변환 확인
  const sbRaw = fakeSupabaseWithMfa({ enrollQrCode: '<svg><rect /></svg>' });
  const storeRaw = createSessionStore({ supabaseAuth: sbRaw.auth, authApi: fakeAuthApi(), storage: memoryStorage() });
  const rawDraft = await storeRaw.getState().startMfaEnroll();
  assert.ok(rawDraft.qrCode.startsWith('data:image/svg+xml;utf-8,'));
});

test('cloud MFA: 로그인 중 aal2 step-up 후 회원 탈퇴(deactivate) 흐름 + 모달 유지', async () => {
  const sb = fakeSupabaseWithMfa({
    initialFactors: [{ id: 'totp-1', factor_type: 'totp', status: 'verified' }],
    currentLevel: 'aal2',
    nextLevel: 'aal2',
    validCode: '246810',
  });
  const api = fakeAuthApi({
    deactivate: async () => {
      if (sb.getLevel() !== 'aal2') {
        throw new AuthApiError('2단계 인증(OTP) 확인 후 다시 시도해 주세요.', {
          status: 403,
          code: 'MFA_STEP_UP_REQUIRED',
        });
      }
    },
  });
  const store = createSessionStore({ supabaseAuth: sb.auth, authApi: api, storage: memoryStorage() });

  await store.getState().signIn('a@b.c', 'pw');
  assert.equal(store.getState().user?.id, 'sb-1');

  // 세션이 aal1 상태로 내려간 상황(예: 재접속 후 step-up 요구)
  sb.setLevel('aal1');
  store.getState().openAuthModal();
  await store.getState().loadMfaStatus();
  assert.equal(store.getState().mfa.currentLevel, 'aal1');

  await assert.rejects(
    store.getState().deactivate(),
    (err: unknown) => err instanceof AuthApiError && err.status === 403 && err.code === 'MFA_STEP_UP_REQUIRED',
  );
  // 실패 시 로그아웃되지 않고 모달도 열려 있음
  assert.equal(store.getState().user?.id, 'sb-1');
  assert.equal(store.getState().authModalOpen, true);

  // 인세션 step-up → 모달을 닫지 않고 aal2로 승격
  const stepped = await store.getState().verifyMfaChallenge('246810');
  assert.equal(stepped?.id, 'sb-1');
  assert.equal(store.getState().mfa.currentLevel, 'aal2');
  assert.equal(store.getState().authModalOpen, true);

  // step-up 이후 탈퇴 성공 → signOut + 모달 닫힘 + mfa 초기화
  await store.getState().deactivate();
  assert.equal(store.getState().user, null);
  assert.equal(store.getState().authModalOpen, false);
  assert.equal(store.getState().mfaChallenge, null);
  assert.equal(store.getState().mfa.enrolled, false);
});

test('auth.api: deactivate/updateProfile은 서버 JSON { message, code }를 AuthApiError로 변환', async () => {
  const axiosLikeErr = {
    message: 'Request failed with status code 403',
    code: 'ERR_BAD_REQUEST',
    response: {
      status: 403,
      data: {
        message: '2단계 인증(OTP) 확인 후 다시 시도해 주세요.',
        code: 'MFA_STEP_UP_REQUIRED',
        error: { message: '2단계 인증(OTP) 확인 후 다시 시도해 주세요.', code: 'MFA_STEP_UP_REQUIRED' },
      },
    },
  };
  const nestedOnlyErr = {
    response: {
      status: 400,
      data: { error: { message: '잘못된 닉네임', code: 'INVALID_PROFILE' } },
    },
  };
  assert.equal(serverCode(axiosLikeErr), 'MFA_STEP_UP_REQUIRED');
  assert.equal(serverCode(nestedOnlyErr), 'INVALID_PROFILE');
  assert.equal(serverCode({ code: 'ERR_BAD_REQUEST' }), undefined);

  const clients: HttpClients = {
    publicApi: {
      get: async () => ({ data: {} }),
      post: async () => ({ data: {} }),
      put: async () => ({ data: {} }),
      delete: async () => ({ data: {} }),
    },
    authApi: {
      get: async () => ({ data: {} }),
      post: async () => ({ data: {} }),
      put: async () => {
        throw nestedOnlyErr;
      },
      delete: async () => {
        throw axiosLikeErr;
      },
    },
  };
  const authApi = createAuthApi(clients);

  await assert.rejects(authApi.deactivate(), (err: unknown) => {
    assert.ok(err instanceof AuthApiError);
    assert.equal(err.status, 403);
    assert.equal(err.code, 'MFA_STEP_UP_REQUIRED');
    assert.equal(err.message, '2단계 인증(OTP) 확인 후 다시 시도해 주세요.');
    return true;
  });

  await assert.rejects(authApi.updateProfile('bad'), (err: unknown) => {
    assert.ok(err instanceof AuthApiError);
    assert.equal(err.status, 400);
    assert.equal(err.code, 'INVALID_PROFILE');
    assert.equal(err.message, '잘못된 닉네임');
    return true;
  });
});
