import assert from 'node:assert/strict';
import { test } from 'node:test';
import { classifyAuthError, isAuthCancelled } from '../../src/features/session/authErrors';
import { createAuthCallbackHandler, oauthCallbackError } from '../../src/features/session/oauthCallback';

test('maps Supabase email/password auth errors to Korean guidance', () => {
  const invalid = classifyAuthError({ code: 'invalid_credentials', message: 'Invalid login credentials' });
  assert.equal(invalid.code, 'invalid_credentials');
  assert.equal(invalid.retryable, true);
  assert.match(invalid.title, /이메일|비밀번호/);

  const localInvalid = classifyAuthError(new Error('등록되지 않은 이메일이거나 비밀번호가 올바르지 않습니다.'));
  assert.equal(localInvalid.code, 'invalid_credentials');

  const unconfirmed = classifyAuthError({ code: 'email_not_confirmed', message: 'Email not confirmed' });
  assert.equal(unconfirmed.code, 'email_not_confirmed');
  assert.equal(unconfirmed.retryable, false);

  const duplicate = classifyAuthError({ code: 'user_already_exists', message: 'User already registered' });
  assert.equal(duplicate.code, 'user_already_exists');
  assert.equal(duplicate.retryable, false);

  const weakPw = classifyAuthError(new Error('Password should be at least 6 characters.'));
  assert.equal(weakPw.code, 'weak_password');
  assert.equal(weakPw.retryable, true);

  const rateLimit = classifyAuthError({ code: 'over_request_rate_limit', status: 429, message: 'Too many requests' });
  assert.equal(rateLimit.code, 'over_request_rate_limit');
  assert.equal(rateLimit.retryable, true);

  const network = classifyAuthError(new TypeError('Failed to fetch'));
  assert.equal(network.code, 'network_error');
  assert.equal(network.retryable, true);
});

test('maps OAuth callback and session errors accurately', () => {
  const cancelled = classifyAuthError('access_denied');
  assert.equal(cancelled.code, 'user_cancelled');
  assert.equal(cancelled.retryable, true);

  const mismatch = classifyAuthError({ error: 'redirect_uri_mismatch', error_description: 'redirect_uri_mismatch' });
  assert.equal(mismatch.code, 'redirect_uri_mismatch');
  assert.equal(mismatch.retryable, false);

  const providerErr = classifyAuthError({ error: 'server_error', error_description: 'Provider temporary failure' });
  assert.equal(providerErr.code, 'oauth_provider_error');
  assert.equal(providerErr.retryable, true);

  const exchangeErr = classifyAuthError('code_exchange_failed');
  assert.equal(exchangeErr.code, 'code_exchange_failed');
  assert.equal(exchangeErr.retryable, true);

  const expired = classifyAuthError({ error_code: 'flow_state_expired', message: 'Flow state has expired' });
  assert.equal(expired.code, 'session_expired');
  assert.equal(expired.retryable, true);
});

test('falls back to unknown_error for unrecognized inputs', () => {
  for (const input of [null, undefined, {}, new Error('Some unexpected internal glitch'), 'weird_custom_code']) {
    const info = classifyAuthError(input);
    assert.equal(info.code, 'unknown_error');
    assert.equal(info.retryable, true);
    assert.ok(info.title.length > 0);
    assert.ok(info.message.length > 0);
  }
});

test('distinguishes user cancellation from failures', () => {
  assert.equal(isAuthCancelled('access_denied'), true);
  assert.equal(isAuthCancelled('user_cancelled'), true);
  assert.equal(isAuthCancelled('Sign in was cancelled. Please try again.'), true);

  assert.equal(isAuthCancelled('invalid_credentials'), false);
  assert.equal(isAuthCancelled('oauth_provider_error'), false);
  assert.equal(isAuthCancelled('code_exchange_failed'), false);
  assert.equal(isAuthCancelled('unknown_error'), false);
});

test('oauthCallbackError and handler emit granular error codes', async () => {
  assert.equal(oauthCallbackError('?error=access_denied'), 'user_cancelled');
  assert.equal(oauthCallbackError('', '#/auth/callback?error=redirect_uri_mismatch'), 'redirect_uri_mismatch');
  assert.equal(oauthCallbackError('?error_code=flow_state_expired'), 'session_expired');
  assert.equal(oauthCallbackError('?error=server_error'), 'oauth_provider_error');

  const handle = createAuthCallbackHandler({
    exchangeCodeForSession: async () => ({
      data: { session: null },
      error: { code: 'flow_state_expired', message: 'Flow state expired' },
    }),
  });
  assert.equal(
    await handle(new URL('https://app.example/auth/callback?code=expired_code')),
    '/?error=session_expired',
  );
});
