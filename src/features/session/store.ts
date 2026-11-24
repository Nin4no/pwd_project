/**
 * 앱 세션 스토어 (실제 Supabase·HTTP 배선). 로직은 `createSessionStore.ts` — node 테스트는 그쪽을 직접 쓸 것.
 * 사용: `useSessionStore((s) => s.user)` / 비React: `useSessionStore.getState()`, `useSessionStore.subscribe(...)`.
 */
import { useStore } from 'zustand';
import { supabase } from '../../services/api/supabase';
import { authApiService } from '../../services/api';
import { appSyncQueue } from '../rooms/repository';
import { createSessionStore, type SessionStore, type SupabaseAuthLike } from './createSessionStore';

export const sessionStore = createSessionStore({
  supabaseAuth: (supabase?.auth as unknown as SupabaseAuthLike | undefined) ?? null,
  authApi: authApiService,
  syncQueue: appSyncQueue,
});

// 구 AuthService 생성자처럼 모듈 로드 시 1회 구독 (HMR·테스트에서는 window 없음 → 생략)
if (typeof window !== 'undefined') sessionStore.getState().init();

type BoundSessionStore = {
  <T>(selector: (s: SessionStore) => T): T;
} & typeof sessionStore;

export const useSessionStore: BoundSessionStore = Object.assign(
  <T,>(selector: (s: SessionStore) => T) => useStore(sessionStore, selector),
  sessionStore,
);

export type {
  AuthNotice,
  MfaAal,
  MfaChallengeState,
  MfaEnrollmentDraft,
  MfaFactorSummary,
  MfaState,
  SessionActions,
  SessionState,
  SessionStore,
  SupabaseMfaLike,
} from './createSessionStore';
