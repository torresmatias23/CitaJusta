import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ApiError, createAuthSession, createHttpClient } from '@citajusta/client-core';
import { googleClientId, googleErrorMessage, createGoogleButtonRenderer, signInWithGoogle } from '../src/features/auth/google-identity.ts';
import { createSessionStorage } from '../src/features/auth/session-storage.ts';

const clientId = 'test-web.apps.googleusercontent.com';
const credential = 'google-transient-id-token';
const profile = { id: 'user-id', email: 'google@example.test', firstName: 'Ana', lastName: 'Pérez', status: 'ACTIVE', roles: [], permissions: [], context: {} };
const pair = { accessToken: 'citajusta-access', refreshToken: 'citajusta-refresh', tokenType: 'Bearer' };
function setup(handler = () => undefined, storage) {
  const calls = [], saved = [];
  let stored;
  const request = async (path, options, accessToken) => {
    calls.push({ path, options, accessToken });
    const result = await handler(path, options); if (result !== undefined) return result;
    if (path === 'users/me') return { data: profile };
    if (['auth/login', 'auth/google', 'auth/refresh'].includes(path)) return pair;
  };
  const session = createAuthSession({ publicApi: { request: (path, options) => request(path, options) },
    authenticatedApi: (getToken) => ({ request: (path, options) => request(path, options, getToken()) }),
    storage: storage ?? { read: () => stored, write: (token) => { stored = token; saved.push(token); }, clear: () => { stored = undefined; } } });
  return { session, calls, saved, stored: () => stored };
}
test('Google login uses the exact internal session/profile/refresh path and never persists Google tokens', async () => {
  const f = setup(); await f.session.loginGoogle(credential);
  assert.deepEqual(f.calls[0], { path: 'auth/google', options: { method: 'POST', body: { credential } }, accessToken: undefined });
  assert.equal(f.calls[1].path, 'users/me'); assert.equal(f.calls[1].accessToken, pair.accessToken);
  assert.equal(f.session.getSnapshot().status, 'authenticated'); assert.deepEqual(f.session.getSnapshot().user, profile);
  assert.deepEqual(f.saved, [pair.refreshToken]); assert.doesNotMatch(JSON.stringify(f.session.getSnapshot()), /google-transient|accessToken|refreshToken/);
  await f.session.logout(); assert.equal(f.stored(), undefined);
  assert.deepEqual(f.calls.at(-1).options.body, { refreshToken: pair.refreshToken });
});
test('local login remains available and explicit link uses authenticated session without replacing tokens', async () => {
  const f = setup(); await f.session.login({ email: profile.email, password: 'local-password' });
  const before = f.session.getSnapshot(); await f.session.linkGoogle(credential);
  assert.deepEqual(f.calls.at(-1), { path: 'auth/google/link', options: { method: 'POST', body: { credential }, retryAfterRefresh: false }, accessToken: pair.accessToken });
  assert.equal(f.session.getSnapshot(), before); assert.deepEqual(f.saved, [pair.refreshToken]);
  assert.equal(f.calls.filter((call) => call.path === 'auth/google').length, 0);
  await f.session.logout(); await assert.rejects(f.session.linkGoogle(credential), { status: 401 });
});
test('link-required produces controlled instructions without persisting credentials or querying profile', async () => {
  const f = setup((path) => { if (path === 'auth/google') throw new ApiError(409, 'GOOGLE_ACCOUNT_LINK_REQUIRED'); });
  await assert.rejects(f.session.loginGoogle(credential), (error) => {
    assert.match(googleErrorMessage(error), /contraseña.*vincula Google.*Mi cuenta/); return true;
  });
  assert.equal(f.session.getSnapshot().status, 'anonymous'); assert.equal(f.calls.length, 1); assert.equal(f.saved.length, 0);
});
test('transport exposes only three allowlisted functional codes with expected status, never server messages', async () => {
  for (const [status, code, expected] of [[409, 'GOOGLE_ACCOUNT_LINK_REQUIRED', 'GOOGLE_ACCOUNT_LINK_REQUIRED'],
    [409, 'GOOGLE_IDENTITY_CONFLICT', 'GOOGLE_IDENTITY_CONFLICT'], [400, 'GOOGLE_PROFILE_REQUIRED', 'GOOGLE_PROFILE_REQUIRED'],
    [401, 'GOOGLE_ACCOUNT_LINK_REQUIRED', undefined], [409, 'private-error', undefined]]) {
    const api = createHttpClient({ baseUrl: '/api/v1', fetcher: async () => Response.json({ code, message: credential, stack: 'private' }, { status }) });
    await assert.rejects(api.request('auth/google', { method: 'POST', body: { credential } }), (error) => {
      assert.equal(error.code, expected); assert.doesNotMatch(googleErrorMessage(error), /google-transient|private/); return true;
    });
  }
});
test('Google button configuration is opt-in and rejects invalid/missing public client IDs', () => {
  for (const value of [undefined, '', 'invalid', 'client-secret']) assert.equal(googleClientId(value), undefined);
  assert.equal(googleClientId(` ${clientId} `), clientId);
});
test('official GIS explicit popup initializes once, receives credentials only transiently and removes stale callbacks', async () => {
  let options, initializes = 0, cleared = 0;
  const received = [], renders = [];
  const api = { initialize: (input) => { initializes++; options = input; }, renderButton: (_element, input) => { renders.push(input); } };
  const render = createGoogleButtonRenderer(async () => api), element = { replaceChildren: () => { cleared++; } };
  const cleanup = await render(clientId, element, (token) => received.push(token));
  assert.equal(options.auto_select, false); assert.equal(options.ux_mode, 'popup'); assert.equal(options.client_id, clientId);
  assert.equal(renders[0].text, 'continue_with'); options.callback({ credential }); assert.deepEqual(received, [credential]);
  cleanup(); options.callback({ credential }); assert.equal(received.length, 1); assert.equal(cleared, 1);
  await render(clientId, element, (token) => received.push(token)); assert.equal(initializes, 1);
  options.callback({}); assert.equal(received.length, 1);
});
test('overlapping GIS loads discard obsolete mount and cleanup cannot remove a newer button', async () => {
  let finish;
  const load = new Promise((resolve) => { finish = resolve; });
  let options, renders = 0, clears = 0;
  const api = { initialize: (input) => { options = input; }, renderButton: () => { renders++; } };
  const renderer = createGoogleButtonRenderer(() => load), received = [], element = { replaceChildren: () => { clears++; } };
  const first = renderer(clientId, element, () => received.push('first'));
  const second = renderer(clientId, element, () => received.push('second'));
  finish(api); const oldCleanup = await first; await second; oldCleanup();
  assert.equal(renders, 1); assert.equal(clears, 0); options.callback({ credential }); assert.deepEqual(received, ['second']);
});
test('late Google login response after logout cannot revive session and is revoked', async () => {
  let finish;
  const delayed = new Promise((resolve) => { finish = resolve; });
  const f = setup((path) => path === 'auth/google' ? delayed : undefined);
  const login = f.session.loginGoogle(credential); await f.session.logout(); finish(pair);
  await assert.rejects(login); await new Promise((resolve) => setImmediate(resolve));
  assert.equal(f.session.getSnapshot().status, 'anonymous'); assert.equal(f.stored(), undefined);
  assert.equal(f.calls.at(-1).path, 'auth/logout');
});

test('shared Google sign-in authenticates and navigates only after profile verification, storing only internal refresh', async () => {
  const sessionStorage = new Map(), localStorage = new Map();
  const f = setup(undefined, createSessionStorage(() => ({
    getItem: (key) => sessionStorage.get(key) ?? null,
    setItem: (key, value) => sessionStorage.set(key, value),
    removeItem: (key) => sessionStorage.delete(key),
  })));
  const busy = { current: false }, pending = [], errors = [], destinations = [];
  await signInWithGoogle(credential, {
    busy, loginGoogle: f.session.loginGoogle, setPending: (value) => pending.push(value),
    setError: (value) => errors.push(value), onSuccess: () => {
      assert.equal(f.session.getSnapshot().status, 'authenticated'); destinations.push('/');
    },
  });
  assert.deepEqual(destinations, ['/']); assert.deepEqual(pending, [true, false]);
  assert.deepEqual(errors, [null]); assert.equal(busy.current, false);
  assert.deepEqual([...sessionStorage.values()], [JSON.stringify({ refreshToken: pair.refreshToken })]);
  assert.equal(localStorage.size, 0);
  assert.doesNotMatch(JSON.stringify([...sessionStorage]), /google-transient|citajusta-access/);
  assert.deepEqual(f.calls.map((call) => call.path), ['auth/google', 'users/me']);
});

test('shared registration/login Google flow sanitizes link-required and failures, releases local form and never auto-links', async () => {
  for (const failure of [new ApiError(409, 'GOOGLE_ACCOUNT_LINK_REQUIRED'), new ApiError(401), new Error(credential)]) {
    const f = setup((path) => { if (path === 'auth/google') throw failure; });
    const busy = { current: false }, errors = [], pending = [];
    await signInWithGoogle(credential, {
      busy, loginGoogle: f.session.loginGoogle, setPending: (value) => pending.push(value),
      setError: (value) => errors.push(value), onSuccess: () => assert.fail('must not navigate'),
    });
    assert.equal(errors.at(-1), googleErrorMessage(failure));
    assert.doesNotMatch(errors.at(-1), /google-transient/);
    assert.equal(f.session.getSnapshot().status, 'anonymous'); assert.equal(busy.current, false);
    assert.deepEqual(pending, [true, false]); assert.equal(f.saved.length, 0);
    assert.deepEqual(f.calls.map((call) => call.path), ['auth/google']);
    await f.session.register({ email: profile.email, password: 'local-password', firstName: 'Ana', lastName: 'Pérez' });
    assert.equal(f.calls.at(-1).path, 'auth/register');
  }
});

test('shared Google sign-in ignores concurrent local/Google operations without duplicate requests', async () => {
  let finish;
  const f = setup((path) => path === 'auth/google' ? new Promise((resolve) => { finish = resolve; }) : undefined);
  const busy = { current: false }, pending = [], destinations = [];
  const options = { busy, loginGoogle: f.session.loginGoogle, setPending: (value) => pending.push(value),
    setError() {}, onSuccess: () => destinations.push('/') };
  const first = signInWithGoogle(credential, options);
  await signInWithGoogle(credential, options);
  assert.equal(f.calls.length, 1); assert.equal(busy.current, true);
  finish(pair); await first;
  assert.deepEqual(destinations, ['/']); assert.deepEqual(pending, [true, false]);
});

test('cancelled GIS popup with no credential sends no request and permits a later retry', async () => {
  let options;
  const f = setup(), busy = { current: false }, pending = [], operations = [];
  const render = createGoogleButtonRenderer(async () => ({ initialize: (value) => { options = value; }, renderButton() {} }));
  await render(clientId, { replaceChildren() {} }, (token) => operations.push(signInWithGoogle(token, {
    busy, loginGoogle: f.session.loginGoogle, setPending: (value) => pending.push(value), setError() {}, onSuccess() {},
  })));
  options.callback({});
  assert.equal(f.calls.length, 0); assert.equal(busy.current, false); assert.deepEqual(pending, []);
  options.callback({ credential }); await Promise.all(operations);
  assert.equal(f.session.getSnapshot().status, 'authenticated');
});
