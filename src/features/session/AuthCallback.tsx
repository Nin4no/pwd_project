import { useEffect } from 'react';
import { supabase } from '../../services/api/supabase';
import { Spinner } from '../../design/components';
import { classifyAuthError } from './authErrors';
import { createAuthCallbackHandler } from './oauthCallback';
import s from './AuthCallback.module.css';

const handleAuthCallback = createAuthCallbackHandler(supabase?.auth);

/** /auth/callback 전용 화면 (main.tsx가 App 대신 렌더). PKCE 코드 교환 후 해시 라우트로 이동 */
export default function AuthCallback() {
  useEffect(() => {
    let active = true;
    void handleAuthCallback(new URL(window.location.href))
      .then((route) => {
        if (active) window.location.replace(`/#${route}`);
      })
      .catch((err: unknown) => {
        // 실패: 홈으로 보내 로그인 창에 두 줄 안내 (AuthErrorScreen이 ?error= 를 읽음)
        if (active) window.location.replace(`/#/?error=${encodeURIComponent(classifyAuthError(err).code)}`);
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <main className={`${s.page} grid-paper`}>
      <div className={s.status} role="status">
        <Spinner size="lg" />
        <p className={s.text}>로그인 결과를 확인하고 있습니다...</p>
      </div>
    </main>
  );
}
