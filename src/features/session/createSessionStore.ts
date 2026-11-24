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

type AuthResult<D> = Promise<{ data: D; error: { message?: string } | null }>;

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
}

export interface SessionActions {
  /** onAuthStateChange·getSession·providers·syncStatus 구독 시작. 해제 함수 반환 */
  init(): () => void;
  signIn(email: string, password: string): Promise<User>;
  signUp(email: string, password: string, displayName: string): Promise<User>;
  signOut(): Promise<void>;
  socialLogin(provider: SocialProvider): Promise<void>;
  updateProfile(displayName: string, avatar?: string): Promise<User>;
  deactivate(): Promise<void>;
  checkAuthStatus(): Promise<User | null>;
  loadProviders(): Promise<ProviderState>;
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

/** 구 `AuthService` + `AuthContext` 의미 그대로의 세션 스토어 (React·import.meta.env 비의존) */
export function createSessionStore(deps: SessionDeps): StoreApi<SessionStore> {
  const storage = deps.storage ?? defaultStorage();
  const sb = deps.supabaseAuth;
  const mode: StorageMode = sb ? 'cloud' : 'local';
  const users = new LocalUserDirectory(storage);
  const origin = deps.origin ?? (() => (typeof window !== 'undefined' ? window.location.origin : ''));
  const defer = deps.defer ?? ((fn) => void setTimeout(fn, 0));

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

    const handleSession = async (session: unknown | null) => {
      if (!session) return setUser(null);
      try {
        setUser(await deps.authApi.me());
      } catch {
        setUser(null);
      }
    };

    /** signIn/signUp 공통: loading·authError 처리 + 성공 시 창 닫기 */
    const withAuthUi = async <T>(fallback: string, fn: () => Promise<T>): Promise<T> => {
      set({ loading: true, authError: '' });
      try {
        const out = await fn();
        get().closeAuthModal();
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
          const user = sb
            ? await (async () => {
                const { error } = await sb.signInWithPassword({ email: trimmed, password });
                if (error) throw new Error(error.message || '로그인에 실패했습니다.');
                return deps.authApi.me();
              })()
            : await users.verify(trimmed, password);
          setUser(user);
          return user;
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
          if (error) throw new Error(error.message || '회원가입에 실패했습니다.');
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
          set({ authError: '' });
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
          setUser(null);
          return null;
        }
        const user = await deps.authApi.me();
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

      openAuthModal: () => set({ authError: '', authNotice: null, authModalOpen: true }),
      closeAuthModal: () => set({ authNotice: null, authModalOpen: false }),
      requireLogin: (reason) =>
        set({ authError: '', authNotice: { title: '로그인이 필요합니다', message: reason, tone: 'info' }, authModalOpen: true }),
      showAuthFailure: (notice) => set({ authError: '', authNotice: notice, authModalOpen: true }),
    };
  });
}
