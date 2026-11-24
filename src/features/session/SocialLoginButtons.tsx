import { useState } from 'react';
import { authConfigured } from '../../services/api/supabase';
import type { SocialProvider } from '../../domain/types';
import { classifyAuthError, type AuthErrorInfo } from './authErrors';
import { useSessionStore } from './store';
import s from './SocialLoginButtons.module.css';

export const PENDING_OAUTH_PROVIDER_KEY = 'dyr_pending_oauth_provider';

const BUTTONS = [
  { key: 'google', provider: 'google', label: 'Google 계정으로 계속하기', mark: 'G' },
  { key: 'naver', provider: 'custom:naver', label: '네이버 계정으로 계속하기', mark: 'N' },
] as const satisfies ReadonlyArray<{ key: 'google' | 'naver'; provider: SocialProvider; label: string; mark: string }>;

/** Google·네이버 로그인. 설정되지 않은 제공자는 비활성 + "(설정되지 않음)" */
export default function SocialLoginButtons() {
  const providers = useSessionStore((st) => st.providers);
  const socialLogin = useSessionStore((st) => st.socialLogin);
  const [redirecting, setRedirecting] = useState<SocialProvider | null>(null);
  const [error, setError] = useState<AuthErrorInfo | null>(null);
  const loading = providers == null;

  return (
    <section aria-label="소셜 로그인" className={s.section}>
      <div className={s.list}>
        {BUTTONS.map((b) => {
          const enabled = authConfigured && Boolean(providers?.[b.key]?.enabled);
          return (
            <button
              key={b.key}
              type="button"
              className={`${s.btn} ${s[b.key]}`}
              disabled={!enabled || redirecting !== null || loading}
              onClick={() => {
                setError(null);
                setRedirecting(b.provider);
                try {
                  sessionStorage.setItem(PENDING_OAUTH_PROVIDER_KEY, b.provider);
                } catch {
                  // 사생활 보호 모드 등 저장소 제한은 무시
                }
                Promise.resolve(socialLogin(b.provider)).catch((err: unknown) => {
                  setError(classifyAuthError(err));
                  setRedirecting(null);
                });
              }}
            >
              <span className={s.mark} aria-hidden="true">
                {b.mark}
              </span>
              <span className={s.label}>
                {redirecting === b.provider ? '로그인 페이지로 이동 중...' : b.label}
                {!enabled && !loading ? ' (설정되지 않음)' : ''}
              </span>
            </button>
          );
        })}
      </div>
      {error ? (
        <p className={s.error} role="alert">
          <span className={s.errorTitle}>{error.title}</span>
          <span>{error.message}</span>
        </p>
      ) : null}
    </section>
  );
}
