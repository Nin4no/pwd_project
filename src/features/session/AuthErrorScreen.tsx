import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { classifyAuthError } from './authErrors';
import { PENDING_OAUTH_PROVIDER_KEY } from './SocialLoginButtons';
import { useSessionStore } from './store';

interface ParsedError {
  error: string | null;
  errorCode: string | null;
  description: string | null;
  cleanedSearch: string;
}

const hasError = (p: ParsedError) => p.error !== null || p.errorCode !== null || p.description !== null;

function parseErrorParams(search: string): ParsedError {
  const params = new URLSearchParams(search.replace(/^\?/, ''));
  const parsed = {
    error: params.get('error'),
    errorCode: params.get('error_code'),
    description: params.get('error_description'),
  };
  if (parsed.error === null && parsed.errorCode === null && parsed.description === null) {
    return { ...parsed, cleanedSearch: search };
  }
  params.delete('error');
  params.delete('error_code');
  params.delete('error_description');
  const rest = params.toString();
  return { ...parsed, cleanedSearch: rest ? `?${rest}` : '' };
}

/** 주소창(라우터 바깥)의 error 파라미터 — 쿼리 또는 해시 — 를 읽고 지움 */
function readWindowFailure(): ParsedError | null {
  if (typeof window === 'undefined') return null;
  const fromSearch = parseErrorParams(window.location.search);
  if (hasError(fromSearch)) {
    window.history.replaceState(null, '', `${window.location.pathname}${fromSearch.cleanedSearch}${window.location.hash}`);
    return fromSearch;
  }
  const hash = window.location.hash;
  if (hash.startsWith('#error=') || hash.startsWith('#error_code=') || hash.startsWith('#error_description=')) {
    const fromHash = parseErrorParams(`?${hash.slice(1)}`);
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#/`);
    return fromHash;
  }
  return null;
}

/**
 * OAuth 실패 감지기 — 별도 팝업 없이 로그인 창을 열고 실패 사유를 두 줄(제목·설명)로 표시.
 * 화면을 그리지 않는다 (Shell 안에 1회 배치).
 */
export default function AuthErrorScreen() {
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    const fromRoute = parseErrorParams(location.search);
    const routeHasError = hasError(fromRoute);
    const parsed = routeHasError ? fromRoute : readWindowFailure();
    if (!parsed) return;

    const info = classifyAuthError({
      error: parsed.error ?? undefined,
      error_code: parsed.errorCode ?? undefined,
      error_description: parsed.description ?? undefined,
    });
    try {
      sessionStorage.removeItem(PENDING_OAUTH_PROVIDER_KEY);
    } catch {
      // 저장소 제한 무시
    }
    useSessionStore.getState().showAuthFailure({ title: info.title, message: info.message });

    if (routeHasError) navigate({ pathname: location.pathname, search: fromRoute.cleanedSearch }, { replace: true });
  }, [location.pathname, location.search, navigate]);

  return null;
}
