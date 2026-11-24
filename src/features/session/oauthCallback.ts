import { classifyAuthError } from './authErrors';

export interface CodeExchanger {
  exchangeCodeForSession: (code: string) => Promise<{
    data: { session: unknown | null };
    error: unknown;
  }>;
}

function extractParamString(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('#') && trimmed.includes('?')) {
    return trimmed.slice(trimmed.indexOf('?') + 1);
  }
  return trimmed.replace(/^[?#]/, '');
}

export function oauthCallbackError(search = '', hash = ''): string | null {
  for (const value of [search, hash]) {
    const raw = extractParamString(value);
    if (!raw) continue;
    const params = new URLSearchParams(raw);
    const error = params.get('error') ?? '';
    const errorCode = params.get('error_code') ?? '';
    const description = params.get('error_description') ?? '';
    if (!error && !errorCode && !description) continue;

    const classified = classifyAuthError({
      error,
      error_code: errorCode,
      error_description: description,
    });
    return classified.code === 'unknown_error' ? 'oauth_provider_error' : classified.code;
  }
  return null;
}

export function safeCallbackPath(candidate: string | null, origin: string): string {
  if (!candidate || !candidate.startsWith('/') || candidate.startsWith('//')) return '/';
  if (candidate.includes('\\') || /[\u0000-\u001f\u007f]/.test(candidate)) return '/';
  try {
    const target = new URL(candidate, origin);
    if (target.origin !== origin || !['http:', 'https:'].includes(target.protocol)) return '/';
    return `${target.pathname}${target.search}${target.hash}`;
  } catch {
    return '/';
  }
}

function callbackCode(url: URL): string | null {
  let code = url.searchParams.get('code');
  if (!code && url.hash.includes('?')) {
    code = new URLSearchParams(url.hash.slice(url.hash.indexOf('?') + 1)).get('code');
  }
  return code;
}

export function createAuthCallbackHandler(auth?: CodeExchanger | null) {
  const exchanges = new Map<string, Promise<string>>();
  return (url: URL): Promise<string> => {
    const error = oauthCallbackError(url.search, url.hash);
    if (error) return Promise.resolve(`/?error=${encodeURIComponent(error)}`);

    const code = callbackCode(url);
    if (!code || !auth) {
      return Promise.resolve(`/?error=${encodeURIComponent('code_exchange_failed')}`);
    }
    const existing = exchanges.get(code);
    if (existing) return existing;

    const exchange = (async () => {
      try {
        const { data, error: exchangeError } = await auth.exchangeCodeForSession(code);
        if (!exchangeError && data.session) {
          const next = url.searchParams.get('next') ?? url.searchParams.get('redirect');
          return safeCallbackPath(next, url.origin);
        }
        if (exchangeError) {
          const classified = classifyAuthError(exchangeError);
          const errorCode = classified.code === 'unknown_error' ? 'code_exchange_failed' : classified.code;
          return `/?error=${encodeURIComponent(errorCode)}`;
        }
      } catch (err) {
        const classified = classifyAuthError(err);
        const errorCode =
          classified.code === 'network_error' || classified.code === 'session_expired'
            ? classified.code
            : 'code_exchange_failed';
        return `/?error=${encodeURIComponent(errorCode)}`;
      }
      return `/?error=${encodeURIComponent('code_exchange_failed')}`;
    })();
    exchanges.set(code, exchange);
    return exchange;
  };
}

const defaultHandler = createAuthCallbackHandler();
export function completeAuthCallback(url: URL, auth?: CodeExchanger | null): Promise<string> {
  return auth ? createAuthCallbackHandler(auth)(url) : defaultHandler(url);
}
