import type { ProviderState, User } from '../../domain/types';
import { unwrap, type HttpClients } from './client';

/** 서버 `/api/auth/*`·`/api/users/*` — 구 `backend.ts` AuthService의 HTTP 호출 부분 */
export interface AuthApi {
  /** GET /api/auth/me (isAuthenticated) */
  me(): Promise<User>;
  /** GET /api/auth/providers (공개) */
  providers(): Promise<ProviderState>;
  /** PUT /api/users/profile */
  updateProfile(displayName: string, avatar?: string): Promise<Partial<User>>;
  /** DELETE /api/users/account */
  deactivate(): Promise<void>;
}

const toTime = (v: unknown): number | undefined =>
  typeof v === 'number' ? v : typeof v === 'string' && v ? new Date(v).getTime() : undefined;

/** 서버·Supabase 사용자 레코드 → User (구 normalizeUser와 동일 규칙) */
export function normalizeUser(raw: Record<string, any>): User {
  const email: string = raw.email ?? '';
  return {
    id: raw.id,
    email,
    displayName: raw.displayName ?? raw.display_name ?? raw.name ?? (email ? email.split('@')[0] : '사용자'),
    avatar: raw.avatar ?? null,
    provider: raw.provider ?? 'supabase',
    isActive: raw.isActive ?? raw.is_active ?? true,
    createdAt: toTime(raw.createdAt) ?? toTime(raw.created_at) ?? Date.now(),
    updatedAt: toTime(raw.updatedAt) ?? toTime(raw.updated_at),
  };
}

export const DEFAULT_PROVIDERS: ProviderState = {
  email: { provider: 'email', enabled: true },
  google: { provider: 'google', enabled: false },
  naver: { provider: 'custom:naver', enabled: false },
};

export function createAuthApi({ authApi, publicApi }: HttpClients): AuthApi {
  return {
    async me() {
      const raw = unwrap<Record<string, any> | undefined>(await authApi.get('/api/auth/me'), 'user');
      if (!raw?.id) throw new Error('Authenticated profile is unavailable.');
      return normalizeUser(raw);
    },
    async providers() {
      const data = unwrap<ProviderState | undefined>(await publicApi.get('/api/auth/providers'));
      if (!data?.google || !data?.naver) throw new Error('Provider response is invalid.');
      return data;
    },
    async updateProfile(displayName, avatar) {
      const raw = unwrap<Record<string, any> | undefined>(
        await authApi.put('/api/users/profile', { display_name: displayName, avatar }),
        'user',
      );
      const out: Partial<User> = {};
      const name = raw?.displayName ?? raw?.display_name;
      if (typeof name === 'string') out.displayName = name;
      if (raw?.avatar !== undefined) out.avatar = raw.avatar;
      return out;
    },
    async deactivate() {
      await authApi.delete('/api/users/account');
    },
  };
}
