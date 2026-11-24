import { createStore, type StoreApi } from 'zustand/vanilla';
import type { ProviderState, SocialProvider, User } from '../../domain/types';
import { DEFAULT_PROVIDERS, type AuthApi } from '../../services/api/auth.api';
import type { StorageMode, SyncStatus } from '../rooms/repository/RoomRepository';
import { STORAGE_KEYS, defaultStorage, readJson, type KeyValueStorage } from '../rooms/repository/kv';
import { LocalUserDirectory, newUserId } from './localUsers';

export interface AuthNotice {
  title: string;
  message: string;
  /** error: 빨간 글씨(로그인 실패) / info: 파란 글씨(로그인 필요 안내) */
  tone?: 'error' | 'info';
}

export type MfaAal = 'aal1' | 'aal2' | null;

export interface MfaFactorSummary {
  id: string;
  friendlyName?: string;
  status: 'verified' | 'unverified';
}

export interface MfaEnrollmentDraft {
  factorId: string;
  qrCode: string;
  secret: string;
  uri: string;
}

export interface MfaChallengeState {
  factorId: string;
  email?: string;
}

export interface MfaState {
  supported: boolean;
  loading: boolean;
  enrolled: boolean;
  currentLevel: MfaAal;
  nextLevel: MfaAal;
  factors: MfaFactorSummary[];
  enrollment: MfaEnrollmentDraft | null;
}

type AuthErrorLike = { message?: string; code?: string; status?: number };
type AuthResult<D> = Promise<{ data: D; error: AuthErrorLike | null }>;

export interface SupabaseMfaFactorLike {
  id: string;
  friendly_name?: string;
  factor_type: string;
  status: 'verified' | 'unverified';
}

/** supabase-js `auth.mfa` 중 쓰는 부분만 (테스트는 가짜 주입) */
export interface SupabaseMfaLike {
  enroll(params: { factorType: 'totp'; friendlyName?: string; issuer?: string }): AuthResult<{
    id: string;
    type?: string;
    friendly_name?: string;
    totp: { qr_code: string; secret: string; uri: string };
  } | null>;
  challengeAndVerify(params: { factorId: string; code: string }): AuthResult<unknown>;
  listFactors(): AuthResult<{
    all: SupabaseMfaFactorLike[];
    totp?: SupabaseMfaFactorLike[];
  } | null>;
  unenroll(params: { factorId: string }): AuthResult<{ id: string } | null>;
  getAuthenticatorAssuranceLevel(jwt?: string): AuthResult<{
    currentLevel: string | null;
    nextLevel: string | null;
  } | null>;
}

/** supabase-js `auth` 중 쓰는 부분만 (테스트는 가짜 주입) */
export interface SupabaseAuthLike {
  signInWithPassword(c: { email: string; password: string }): AuthResult<unknown>;
  signUp(c: { email: string; password: string; options?: Record<string, unknown> }): AuthResult<{
    session?: unknown | null;
    user?: { id?: string } | null;
  }>;
  signOut(o?: { scope?: 'local' | 'global' | 'others' }): Promise<unknown>;
  signInWithOAuth(c: { provider: SocialProvider; options?: Record<string, unknown> }): Promise<{ error: unknown }>;
  getSession(): Promise<{ data: { session: unknown | null } }>;
  onAuthStateChange(cb: (event: string, session: unknown | null) => void): { data: { subscription: { unsubscribe(): void } } };
  mfa?: SupabaseMfaLike;
}

/** 동기화 대기열 중 세션이 쓰는 부분 (SyncQueue 호환) */
export interface SyncSource {
  status(): SyncStatus;
  subscribe(listener: (s: SyncStatus) => void): () => void;
  flush(): Promise<void>;
}

export interface SessionDeps {
  /** null이면 local 모드 (구 authConfigured=false) */
  supabaseAuth: SupabaseAuthLike | null;
  authApi: AuthApi;
  syncQueue?: SyncSource;
  storage?: KeyValueStorage;
  /** OAuth·메일 인증 redirect 기준 (기본: window.location.origin) */
  origin?: () => string;
  /** onAuthStateChange 콜백 지연 실행 (supabase 내부 락 회피, 기본 setTimeout 0) */
  defer?: (fn: () => void) => void;
}

export interface SessionState {
  user: User | null;
  mode: StorageMode;
  isCloud: boolean;
  loading: boolean;
  authError: string;
  providers: ProviderState;
  syncStatus: SyncStatus;
  authModalOpen: boolean;
  authNotice: AuthNotice | null;
  mfa: MfaState;
  mfaChallenge: MfaChallengeState | null;
}

export interface SessionActions {
  /** onAuthStateChange·getSession·providers·syncStatus 구독 시작. 해제 함수 반환 */
  init(): () => void;
  signIn(email: string, password: string): Promise<User | null>;
  signUp(email: string, password: string, displayName: string): Promise<User>;
  signOut(): Promise<void>;
  socialLogin(provider: SocialProvider): Promise<void>;
  updateProfile(displayName: string, avatar?: string): Promise<User>;
  deactivate(): Promise<void>;
  checkAuthStatus(): Promise<User | null>;
  loadProviders(): Promise<ProviderState>;
  loadMfaStatus(): Promise<MfaState>;
  startMfaEnroll(friendlyName?: string): Promise<MfaEnrollmentDraft>;
  confirmMfaEnroll(code: string): Promise<void>;
  cancelMfaEnroll(): Promise<void>;
  verifyMfaChallenge(code: string, factorId?: string): Promise<User | null>;
  cancelMfaChallenge(): Promise<void>;
  unenrollMfa(factorId?: string): Promise<void>;
  openAuthModal(): void;
  closeAuthModal(): void;
  /** 로그인이 필요한 기능을 눌렀을 때 — 이유를 안내하며 로그인 창을 엶 */
  requireLogin(reason: string): void;
  /** 로그인 창을 열면서 실패 사유를 빨간 글씨로 보여 줌 */
  showAuthFailure(notice: AuthNotice): void;
}

export type SessionStore = SessionState & SessionActions;

const errMsg = (e: unknown, fallback: string): string => {
  const m = (e as { message?: unknown } | null)?.message;
  return typeof m === 'string' && m ? m : fallback;
};

const toMfaAal = (level: string | null | undefined): MfaAal =>
  level === 'aal1' || level === 'aal2' ? level : null;

const createInitialMfaState = (supported: boolean): MfaState => ({
  supported,
  loading: false,
  enrolled: false,
  currentLevel: null,
  nextLevel: null,
  factors: [],
  enrollment: null,
});

function toSupabaseError(
  error: AuthErrorLike | null | undefined,
  fallback: string,
): Error & { code?: string; status?: number } {
  const err = new Error(error?.message || fallback) as Error & { code?: string; status?: number };
  if (error?.code) err.code = error.code;
  if (typeof error?.status === 'number') err.status = error.status;
  return err;
}

function codedError(code: string, message: string): Error & { code: string } {
  const err = new Error(message) as Error & { code: string };
  err.code = code;
  return err;
}

function normalizeTotpCode(code: string): string {
  const clean = code.replace(/\s+/g, '');
  if (!/^\d{6}$/.test(clean)) {
    throw codedError('mfa_invalid_code', '6자리 숫자 인증 코드를 입력해 주세요.');
  }
  return clean;
}

function normalizeQrCode(qr: string): string {
  const trimmed = qr.trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('data:')) return trimmed;
  if (trimmed.startsWith('<svg')) return `data:image/svg+xml;utf-8,${encodeURIComponent(trimmed)}`;
  return trimmed;
}

function sessionEmail(session: unknown): string | undefined {
  if (!session || typeof session !== 'object') return undefined;
  const email = (session as { user?: { email?: unknown } }).user?.email;
  return typeof email === 'string' && email ? email : undefined;
}

function extractTotpFactors(data: { all: SupabaseMfaFactorLike[]; totp?: SupabaseMfaFactorLike[] } | null | undefined): MfaFactorSummary[] {
  if (!data) return [];
  const rawAll = Array.isArray(data.all) ? data.all : [];
  const rawTotp = rawAll.length > 0
    ? rawAll.filter((f) => f.factor_type === 'totp')
    : (Array.isArray(data.totp) ? data.totp : []);
  return rawTotp.map((f) => ({
    id: f.id,
    friendlyName: f.friendly_name,
    status: f.status,
  }));
}

/** 구 `AuthService` + `AuthContext` 의미 그대로의 세션 스토어 (React·import.meta.env 비의존) */
export function createSessionStore(deps: SessionDeps): StoreApi<SessionStore> {
  const storage = deps.storage ?? defaultStorage();
  const sb = deps.supabaseAuth;
  const mode: StorageMode = sb ? 'cloud' : 'local';
  const mfaSupported = Boolean(sb?.mfa);
  const users = new LocalUserDirectory(storage);
  const origin = deps.origin ?? (() => (typeof window !== 'undefined' ? window.location.origin : ''));
  const defer = deps.defer ?? ((fn) => void setTimeout(fn, 0));

  let sessionSeq = 0;
  let signInInFlight = false;
  let mfaVerifyInFlight = false;

  return createStore<SessionStore>()((set, get) => {
    /** 구 setSession: 상태 + `dyr:session` 기록. 로그인(사용자 변경)되면 보류 동기화 재전송 */
    const setUser = (user: User | null) => {
      const prev = get().user;
      try {
        if (user) storage.setItem(STORAGE_KEYS.session, JSON.stringify(user));
        else storage.removeItem(STORAGE_KEYS.session);
      } catch (e) {
        console.error('Failed to save session', e);
      }
      set({ user, loading: false });
      if (user && mode === 'cloud' && prev?.id !== user.id) void deps.syncQueue?.flush().catch(() => undefined);
    };

    /** AAL 점검 — MFA 미등록(nextLevel !== 'aal2')이면 추가 호출 없이 즉시 null 반환 */
    const checkMfaChallengeNeeded = async (
      session: unknown,
      fallbackEmail?: string,
    ): Promise<MfaChallengeState | null> => {
      if (!sb?.mfa) return null;
      const aalRes = await sb.mfa.getAuthenticatorAssuranceLevel();
      if (aalRes.error || !aalRes.data) return null;

      const currentLevel = toMfaAal(aalRes.data.currentLevel);
      const nextLevel = toMfaAal(aalRes.data.nextLevel);

      set((st) => ({
        mfa: {
          ...st.mfa,
          supported: true,
          currentLevel,
          nextLevel,
          enrolled: nextLevel === 'aal2' ? true : st.mfa.enrolled,
        },
      }));

      if (nextLevel === 'aal2' && currentLevel !== 'aal2') {
        const factorsRes = await sb.mfa.listFactors();
        if (factorsRes.error || !factorsRes.data) return null;
        const factors = extractTotpFactors(factorsRes.data);
        const verified = factors.find((f) => f.status === 'verified');
        if (verified) {
          set((st) => ({
            mfa: {
              ...st.mfa,
              supported: true,
              enrolled: true,
              currentLevel,
              nextLevel,
              factors,
            },
          }));
          return {
            factorId: verified.id,
            email: fallbackEmail ?? sessionEmail(session) ?? get().mfaChallenge?.email,
          };
        }
      }

      return null;
    };

    const handleSession = async (session: unknown | null) => {
      if (signInInFlight || mfaVerifyInFlight) return;
      const seq = ++sessionSeq;
      if (!session) {
        set({ mfaChallenge: null, mfa: createInitialMfaState(mfaSupported) });
        setUser(null);
        return;
      }
      try {
        const challenge = await checkMfaChallengeNeeded(session);
        if (seq !== sessionSeq) return;
        if (challenge) {
          set({ mfaChallenge: challenge, authModalOpen: true, authError: '' });
          setUser(null);
          return;
        }
        const user = await deps.authApi.me();
        if (seq !== sessionSeq) return;
        set({ mfaChallenge: null });
        setUser(user);
      } catch {
        if (seq !== sessionSeq) return;
        setUser(null);
      }
    };

    /** signIn/signUp 공통: loading·authError 처리 + 성공 시(MFA 챌린지 없을 때만) 창 닫기 */
    const withAuthUi = async <T>(fallback: string, fn: () => Promise<T>): Promise<T> => {
      set({ loading: true, authError: '' });
      try {
        const out = await fn();
        if (!get().mfaChallenge) get().closeAuthModal();
        return out;
      } catch (e) {
        set({ authError: errMsg(e, fallback) });
        throw e;
      } finally {
        set({ loading: false });
      }
    };

    return {
      user: sb ? null : readJson<User | null>(storage, STORAGE_KEYS.session, null),
      mode,
      isCloud: mode === 'cloud',
      loading: false,
      authError: '',
      providers: DEFAULT_PROVIDERS,
      syncStatus: deps.syncQueue?.status() ?? 'saved',
      authModalOpen: false,
      authNotice: null,
      mfa: createInitialMfaState(mfaSupported),
      mfaChallenge: null,

      init() {
        const offs: Array<() => void> = [];
        if (deps.syncQueue) offs.push(deps.syncQueue.subscribe((syncStatus) => set({ syncStatus })));
        if (sb) {
          const { data } = sb.onAuthStateChange((_event, session) => defer(() => void handleSession(session)));
          offs.push(() => data.subscription.unsubscribe());
          sb.getSession()
            .then(({ data: d }) => (d?.session ? handleSession(d.session) : undefined))
            .catch(() => undefined);
        }
        void get().loadProviders();
        return () => offs.forEach((off) => off());
      },

      signIn: (email, password) =>
        withAuthUi('로그인에 실패했습니다.', async () => {
          const trimmed = email.trim();
          if (!sb) {
            const user = await users.verify(trimmed, password);
            setUser(user);
            return user;
          }
          signInInFlight = true;
          try {
            const seq = ++sessionSeq;
            const { data, error } = await sb.signInWithPassword({ email: trimmed, password });
            if (error) throw toSupabaseError(error, '로그인에 실패했습니다.');
            const session = (data as { session?: unknown } | null)?.session ?? null;
            const challenge = await checkMfaChallengeNeeded(session, trimmed);
            if (seq !== sessionSeq) return null;
            if (challenge) {
              set({ mfaChallenge: challenge, authModalOpen: true, authError: '' });
              setUser(null);
              return null;
            }
            const user = await deps.authApi.me();
            if (seq !== sessionSeq) return null;
            set({ mfaChallenge: null });
            setUser(user);
            return user;
          } finally {
            signInInFlight = false;
          }
        }),

      signUp: (email, password, displayName) =>
        withAuthUi('회원가입에 실패했습니다.', async () => {
          const trimmed = email.trim();
          const name = displayName.trim() || trimmed.split('@')[0];
          if (!sb) {
            const user = await users.register(trimmed, password, name);
            setUser(user);
            return user;
          }
          const { data, error } = await sb.signUp({
            email: trimmed,
            password,
            options: {
              data: { displayName: name, display_name: name, name },
              emailRedirectTo: `${origin()}/auth/callback`,
            },
          });
          if (error) throw toSupabaseError(error, '회원가입에 실패했습니다.');
          if (data.session) {
            const user = await deps.authApi.me();
            setUser(user);
            return user;
          }
          // 메일 인증 대기 — 세션 없이 임시 사용자만 반환 (구 코드와 동일)
          const temp: User = { id: data.user?.id ?? newUserId(), email: trimmed, displayName: name, provider: 'supabase', createdAt: Date.now() };
          return temp;
        }),

      async signOut() {
        sessionSeq++;
        set({ loading: true });
        try {
          if (sb) {
            try {
              await sb.signOut({ scope: 'local' });
            } catch (e) {
              console.warn('Supabase signOut error', e);
            }
          }
          setUser(null);
          set({ authError: '', mfaChallenge: null, mfa: createInitialMfaState(mfaSupported) });
        } finally {
          set({ loading: false });
        }
      },

      async socialLogin(provider) {
        if (!sb) throw new Error('Supabase 인증이 설정되지 않았습니다.');
        const { error } = await sb.signInWithOAuth({ provider, options: { redirectTo: `${origin()}/auth/callback` } });
        if (error) throw error;
      },

      async updateProfile(displayName, avatar) {
        const current = get().user;
        if (!current) throw new Error('로그인이 필요합니다.');
        let next: User = { ...current, displayName, avatar: avatar ?? current.avatar };
        if (sb) {
          const res = await deps.authApi.updateProfile(displayName, avatar);
          next = { ...current, displayName: res.displayName ?? displayName, avatar: res.avatar ?? avatar ?? current.avatar };
        } else {
          users.rename(current.id, displayName);
        }
        setUser(next);
        return next;
      },

      async deactivate() {
        if (sb) await deps.authApi.deactivate();
        await get().signOut();
        get().closeAuthModal();
      },

      async checkAuthStatus() {
        if (!sb) return get().user;
        const { data } = await sb.getSession();
        if (!data.session) {
          set({ mfaChallenge: null, mfa: createInitialMfaState(mfaSupported) });
          setUser(null);
          return null;
        }
        const challenge = await checkMfaChallengeNeeded(data.session);
        if (challenge) {
          set({ mfaChallenge: challenge, authModalOpen: true, authError: '' });
          setUser(null);
          return null;
        }
        const user = await deps.authApi.me();
        set({ mfaChallenge: null });
        setUser(user);
        return user;
      },

      async loadProviders() {
        let providers = DEFAULT_PROVIDERS;
        if (sb) {
          try {
            providers = await deps.authApi.providers();
          } catch {
            // 서버 응답 불가 시 기본값 폴백
          }
        }
        set({ providers });
        return providers;
      },

      async loadMfaStatus() {
        if (!sb?.mfa) {
          const unsupported = createInitialMfaState(false);
          set({ mfa: unsupported });
          return unsupported;
        }
        set((st) => ({ mfa: { ...st.mfa, supported: true, loading: true } }));
        try {
          const [aalRes, factorsRes] = await Promise.all([
            sb.mfa.getAuthenticatorAssuranceLevel(),
            sb.mfa.listFactors(),
          ]);
          if (aalRes.error) throw toSupabaseError(aalRes.error, '2단계 인증 상태를 확인하지 못했습니다.');
          if (factorsRes.error) throw toSupabaseError(factorsRes.error, '2단계 인증 목록을 불러오지 못했습니다.');

          const factors = extractTotpFactors(factorsRes.data);
          const currentLevel = toMfaAal(aalRes.data?.currentLevel);
          const nextLevel = toMfaAal(aalRes.data?.nextLevel);
          const enrolled = factors.some((f) => f.status === 'verified');
          const curEnrollment = get().mfa.enrollment;
          const enrollment =
            curEnrollment && factors.some((f) => f.id === curEnrollment.factorId && f.status === 'unverified')
              ? curEnrollment
              : null;

          const nextMfa: MfaState = {
            supported: true,
            loading: false,
            enrolled,
            currentLevel,
            nextLevel,
            factors,
            enrollment,
          };
          set({ mfa: nextMfa });
          return nextMfa;
        } catch (e) {
          set((st) => ({ mfa: { ...st.mfa, loading: false } }));
          throw e;
        }
      },

      async startMfaEnroll(friendlyName) {
        if (!sb?.mfa) throw codedError('mfa_enrollment_failed', '2단계 인증을 지원하지 않는 환경입니다.');
        set((st) => ({ mfa: { ...st.mfa, supported: true, loading: true } }));
        try {
          const listed = await sb.mfa.listFactors();
          if (!listed.error && listed.data) {
            const stale = extractTotpFactors(listed.data).filter((f) => f.status === 'unverified');
            for (const f of stale) {
              await sb.mfa.unenroll({ factorId: f.id }).catch(() => undefined);
            }
          }

          const cleanName = friendlyName?.trim();
          const enrolledRes = await sb.mfa.enroll({
            factorType: 'totp',
            friendlyName: cleanName || '내 방 꾸미기',
          });
          if (enrolledRes.error || !enrolledRes.data?.totp) {
            throw toSupabaseError(enrolledRes.error, '2단계 인증 설정을 시작하지 못했습니다.');
          }

          const draft: MfaEnrollmentDraft = {
            factorId: enrolledRes.data.id,
            qrCode: normalizeQrCode(enrolledRes.data.totp.qr_code),
            secret: enrolledRes.data.totp.secret,
            uri: enrolledRes.data.totp.uri,
          };

          set((st) => ({
            mfa: {
              ...st.mfa,
              supported: true,
              loading: false,
              enrollment: draft,
              factors: [
                ...st.mfa.factors.filter((f) => f.status === 'verified' && f.id !== draft.factorId),
                { id: draft.factorId, friendlyName: enrolledRes.data?.friendly_name ?? (cleanName || '내 방 꾸미기'), status: 'unverified' },
              ],
            },
          }));
          return draft;
        } catch (e) {
          set((st) => ({ mfa: { ...st.mfa, loading: false } }));
          throw e;
        }
      },

      async confirmMfaEnroll(code) {
        if (!sb?.mfa) throw codedError('mfa_enrollment_failed', '2단계 인증을 지원하지 않는 환경입니다.');
        const draft = get().mfa.enrollment;
        if (!draft) throw codedError('mfa_enrollment_failed', '진행 중인 2단계 인증 설정이 없습니다.');
        const clean = normalizeTotpCode(code);

        set((st) => ({ mfa: { ...st.mfa, loading: true } }));
        try {
          const res = await sb.mfa.challengeAndVerify({ factorId: draft.factorId, code: clean });
          if (res.error) throw toSupabaseError(res.error, '인증 코드 확인에 실패했습니다.');
          set((st) => ({ mfa: { ...st.mfa, enrollment: null } }));
          await get().loadMfaStatus();
        } catch (e) {
          set((st) => ({ mfa: { ...st.mfa, loading: false } }));
          throw e;
        }
      },

      async cancelMfaEnroll() {
        const draft = get().mfa.enrollment;
        if (!sb?.mfa || !draft) {
          set((st) => ({ mfa: { ...st.mfa, enrollment: null } }));
          return;
        }
        set((st) => ({ mfa: { ...st.mfa, loading: true } }));
        try {
          await sb.mfa.unenroll({ factorId: draft.factorId }).catch(() => undefined);
          set((st) => ({ mfa: { ...st.mfa, enrollment: null } }));
          await get().loadMfaStatus().catch(() => undefined);
        } finally {
          set((st) => ({ mfa: { ...st.mfa, loading: false, enrollment: null } }));
        }
      },

      async verifyMfaChallenge(code, factorId) {
        if (!sb?.mfa) throw codedError('mfa_enrollment_failed', '2단계 인증을 지원하지 않는 환경입니다.');
        const challenge = get().mfaChallenge;
        let clean: string;
        try {
          clean = normalizeTotpCode(code);
        } catch (e) {
          if (challenge) set({ authError: errMsg(e, '6자리 숫자 인증 코드를 입력해 주세요.') });
          throw e;
        }

        if (challenge) {
          const targetFactorId = factorId ?? challenge.factorId;
          mfaVerifyInFlight = true;
          const seq = ++sessionSeq;
          set((st) => ({ loading: true, authError: '', mfa: { ...st.mfa, loading: true } }));
          try {
            const res = await sb.mfa.challengeAndVerify({ factorId: targetFactorId, code: clean });
            if (res.error) throw toSupabaseError(res.error, '인증 코드 확인에 실패했습니다.');
            if (seq !== sessionSeq) return null;
            set({ mfaChallenge: null });
            const user = await deps.authApi.me();
            if (seq !== sessionSeq) return null;
            setUser(user);
            await get().loadMfaStatus().catch(() => undefined);
            get().closeAuthModal();
            return user;
          } catch (e) {
            set({ authError: errMsg(e, '인증 코드 확인에 실패했습니다.') });
            throw e;
          } finally {
            mfaVerifyInFlight = false;
            set((st) => ({ loading: false, mfa: { ...st.mfa, loading: false } }));
          }
        }

        // 이미 로그인된 세션에서 aal2 step-up (모달은 닫지 않음)
        let targetFactorId = factorId ?? get().mfa.factors.find((f) => f.status === 'verified')?.id;
        if (!targetFactorId) {
          const status = await get().loadMfaStatus();
          targetFactorId = status.factors.find((f) => f.status === 'verified')?.id;
        }
        if (!targetFactorId) {
          throw codedError('mfa_factor_not_found', '등록된 2단계 인증 수단을 찾을 수 없습니다.');
        }

        set((st) => ({ mfa: { ...st.mfa, loading: true } }));
        try {
          const res = await sb.mfa.challengeAndVerify({ factorId: targetFactorId, code: clean });
          if (res.error) throw toSupabaseError(res.error, '인증 코드 확인에 실패했습니다.');
          await get().loadMfaStatus();
          return get().user;
        } catch (e) {
          set((st) => ({ mfa: { ...st.mfa, loading: false } }));
          throw e;
        }
      },

      async cancelMfaChallenge() {
        sessionSeq++;
        set({
          loading: true,
          authError: '',
          mfaChallenge: null,
          mfa: createInitialMfaState(mfaSupported),
        });
        try {
          if (sb) {
            try {
              await sb.signOut({ scope: 'local' });
            } catch (e) {
              console.warn('Supabase signOut error', e);
            }
          }
          setUser(null);
        } finally {
          set({ loading: false });
        }
      },

      async unenrollMfa(factorId) {
        if (!sb?.mfa) throw codedError('mfa_enrollment_failed', '2단계 인증을 지원하지 않는 환경입니다.');
        let targetFactorId =
          factorId ??
          get().mfa.factors.find((f) => f.status === 'verified')?.id ??
          get().mfa.factors[0]?.id;
        if (!targetFactorId) {
          const status = await get().loadMfaStatus();
          targetFactorId =
            status.factors.find((f) => f.status === 'verified')?.id ?? status.factors[0]?.id;
        }
        if (!targetFactorId) {
          throw codedError('mfa_factor_not_found', '해제할 2단계 인증 수단이 없습니다.');
        }

        set((st) => ({ mfa: { ...st.mfa, loading: true } }));
        try {
          const res = await sb.mfa.unenroll({ factorId: targetFactorId });
          if (res.error) throw toSupabaseError(res.error, '2단계 인증 해제에 실패했습니다.');
          set((st) => ({ mfa: { ...st.mfa, enrollment: null } }));
          await get().loadMfaStatus();
        } catch (e) {
          set((st) => ({ mfa: { ...st.mfa, loading: false } }));
          throw e;
        }
      },

      openAuthModal: () => set({ authError: '', authNotice: null, authModalOpen: true }),
      closeAuthModal: () => set({ authNotice: null, authModalOpen: false }),
      requireLogin: (reason) =>
        set({ authError: '', authNotice: { title: '로그인이 필요합니다', message: reason, tone: 'info' }, authModalOpen: true }),
      showAuthFailure: (notice) => set({ authError: '', authNotice: notice, authModalOpen: true }),
    };
  });
}
