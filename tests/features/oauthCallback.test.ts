import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createAuthCallbackHandler, safeCallbackPath } from '../../src/features/session/oauthCallback';

const sessionAuth = (exchangeCodeForSession: (code: string) => Promise<any>) => ({
  exchangeCodeForSession,
});

test('callback exchanges a provided code and returns a safe internal next path', async () => {
  const exchange = async (code: string) => ({ data: { session: { code } }, error: null });
  const handle = createAuthCallbackHandler(sessionAuth(exchange));
  assert.equal(await handle(new URL('https://app.example/auth/callback?code=abc&next=%2Fstudio')), '/studio');
});

test('callback error parameters skip code exchange', async () => {
  let calls = 0;
  const handle = createAuthCallbackHandler(sessionAuth(async () => {
    calls += 1;
    return { data: { session: null }, error: null };
  }));
  const route = await handle(new URL('https://app.example/auth/callback?code=abc&error=access_denied'));
  assert.match(route, /^\/\?error=/);
  assert.equal(calls, 0);
});

test('callback without a code reports an error', async () => {
  const handle = createAuthCallbackHandler(sessionAuth(async () => ({ data: { session: null }, error: null })));
  assert.match(await handle(new URL('https://app.example/auth/callback')), /^\/\?error=/);
});

test('re-entering the callback with the same code exchanges it once', async () => {
  let calls = 0;
  let finish!: (value: any) => void;
  const exchange = () => {
    calls += 1;
    return new Promise<any>((resolve) => { finish = resolve; });
  };
  const handle = createAuthCallbackHandler(sessionAuth(exchange));
  const url = new URL('https://app.example/auth/callback?code=once');
  const first = handle(url);
  const second = handle(url);
  finish({ data: { session: {} }, error: null });
  assert.deepEqual(await Promise.all([first, second]), ['/', '/']);
  assert.equal(calls, 1);
});

test('callback destinations allow internal paths and reject external or executable URLs', () => {
  const origin = 'https://app.example';
  assert.equal(safeCallbackPath('/studio?tab=room#canvas', origin), '/studio?tab=room#canvas');
  for (const unsafe of ['https://evil.example', '//evil.example/path', 'javascript:alert(1)', '/\\evil.example']) {
    assert.equal(safeCallbackPath(unsafe, origin), '/');
  }
});
