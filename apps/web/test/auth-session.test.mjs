import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createAuthSession, authErrorMessage, safeReturnTo } from '../src/features/auth/auth-session.ts';
import { createSessionStorage } from '../src/features/auth/session-storage.ts';
import { ApiError } from '../src/lib/http-client.ts';

const credentials = { email: 'person@example.test', password: 'example-password' };
const profile = { id: 'person-id', email: credentials.email, firstName: 'Ana', lastName: 'Pérez', status: 'ACTIVE', context: {}, roles: [], permissions: [] };
const tokens = (suffix = '1') => ({ accessToken: `access-${suffix}`, refreshToken: `refresh-${suffix}`, tokenType: 'Bearer' });

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function setup(handler, stored) {
  const calls = [];
  let saved = stored;
  const storage = { read: () => saved, write: (value) => { saved = value; }, clear: () => { saved = undefined; } };
  const request = async (path, options, accessToken) => {
    calls.push({ path, options, accessToken });
    if (handler) {
      const result = handler(path, options, accessToken, calls);
      if (result !== undefined) return result;
    }
    if (path === 'auth/login' || path === 'auth/refresh') return tokens();
    if (path === 'users/me') return { data: profile };
    if (path === 'auth/logout') return undefined;
    return { data: [] };
  };
  const session = createAuthSession({
    publicApi: { request: (path, options = {}) => request(path, options, undefined) },
    authenticatedApi: (getAccessToken) => ({ request: (path, options = {}) => request(path, options, getAccessToken()) }),
    storage,
  });
  return { session, calls, saved: () => saved };
}

test('sesión anónima no consulta el backend; login carga sólo perfil público y persiste sólo refresh', async () => {
  const { session, calls, saved } = setup((path) => path === 'users/me' ? { data: { ...profile, passwordHash: 'not-public', sessionId: 'not-public' } } : undefined);
  await session.restore();
  assert.equal(session.getSnapshot().status, 'anonymous');
  assert.equal(calls.length, 0);
  await session.login({ ...credentials, userId: 'ignored' });
  assert.equal(session.getSnapshot().status, 'authenticated');
  assert.deepEqual(session.getSnapshot().user, profile);
  assert.deepEqual(calls[0].options.body, credentials);
  assert.equal(calls[0].accessToken, undefined);
  assert.equal(calls[1].path, 'users/me');
  assert.equal(calls[1].accessToken, 'access-1');
  assert.equal(saved(), 'refresh-1');
  assert.equal('accessToken' in session.getSnapshot(), false);
});

test('login inválido no deja sesión, no reintenta ni filtra errores del servidor', async () => {
  const { session, calls, saved } = setup((path) => { if (path === 'auth/login') throw new ApiError(401); });
  await assert.rejects(session.login(credentials), { status: 401 });
  assert.equal(session.getSnapshot().status, 'anonymous');
  assert.equal(saved(), undefined);
  assert.equal(calls.length, 1);
  assert.match(session.getSnapshot().error, /Correo o contraseña/);
  assert.doesNotMatch(authErrorMessage(new Error('password secret stack'), 'login'), /password|secret|stack/);
});

test('registro usa sólo el contrato real y no inicia sesión automáticamente', async () => {
  const { session, calls } = setup((path) => path === 'auth/register' ? profile : undefined);
  await session.restore();
  const input = { ...credentials, firstName: 'Ana', lastName: 'Pérez', status: 'ACTIVE', roles: ['ADMIN'] };
  await session.register(input);
  assert.deepEqual(calls[0].options.body, { ...credentials, firstName: 'Ana', lastName: 'Pérez' });
  assert.equal(calls.length, 1);
  assert.equal(session.getSnapshot().status, 'anonymous');
});

test('restore deduplica StrictMode y rota el refresh antes de consultar users/me', async () => {
  const waiting = deferred();
  const { session, calls, saved } = setup((path) => path === 'auth/refresh' ? waiting.promise : undefined, 'stored-refresh');
  const first = session.restore();
  const second = session.restore();
  assert.equal(first, second);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].options.body, { refreshToken: 'stored-refresh' });
  waiting.resolve(tokens('restored'));
  await Promise.all([first, second]);
  await session.restore();
  assert.equal(calls.filter((call) => call.path === 'auth/refresh').length, 1);
  assert.equal(calls.filter((call) => call.path === 'users/me').length, 1);
  assert.equal(saved(), 'refresh-restored');
  assert.equal(session.getSnapshot().status, 'authenticated');
});

test('401 simultáneos hacen un refresh y un único reintento por solicitud', async () => {
  const rotating = deferred();
  const { session, calls } = setup((path, _options, token) => {
    if (path === 'appointments/me' && token === 'access-1') throw new ApiError(401);
    if (path === 'auth/refresh') return rotating.promise;
    return undefined;
  });
  await session.login(credentials);
  const first = session.api.request('appointments/me');
  const second = session.api.request('appointments/me');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls.filter((call) => call.path === 'auth/refresh').length, 1);
  rotating.resolve(tokens('2'));
  await Promise.all([first, second]);
  assert.equal(calls.filter((call) => call.path === 'appointments/me').length, 4);
  assert.equal(session.getSnapshot().status, 'authenticated');
});

test('un 401 tardío del token anterior reutiliza la rotación completada', async () => {
  const late = deferred();
  let originalCalls = 0;
  const { session, calls } = setup((path, _options, token) => {
    if (path === 'appointments/me' && token === 'access-1') {
      originalCalls++;
      if (originalCalls === 2) return late.promise;
      throw new ApiError(401);
    }
    if (path === 'auth/refresh') return tokens('2');
    return undefined;
  });
  await session.login(credentials);
  const first = session.api.request('appointments/me');
  const second = session.api.request('appointments/me');
  await first;
  late.reject(new ApiError(401));
  await second;
  assert.equal(calls.filter((call) => call.path === 'auth/refresh').length, 1);
});

test('401 terminal tras el retry limpia la sesión sin bucle', async () => {
  const { session, calls, saved } = setup((path) => {
    if (path === 'appointments/me') throw new ApiError(401);
    if (path === 'auth/refresh') return tokens('2');
    return undefined;
  });
  await session.login(credentials);
  await assert.rejects(session.api.request('appointments/me'), { status: 401 });
  assert.equal(calls.filter((call) => call.path === 'appointments/me').length, 2);
  assert.equal(calls.filter((call) => call.path === 'auth/refresh').length, 1);
  assert.equal(session.getSnapshot().status, 'anonymous');
  assert.equal(saved(), undefined);
});

test('refresh inválido limpia la sesión; error de conexión es recuperable explícitamente', async () => {
  const invalid = setup((path) => { if (path === 'auth/refresh') throw new ApiError(401); }, 'expired');
  await invalid.session.restore();
  assert.equal(invalid.session.getSnapshot().status, 'anonymous');
  assert.equal(invalid.saved(), undefined);
  let offline = true;
  const recoverable = setup((path) => { if (path === 'auth/refresh' && offline) throw new TypeError('offline'); }, 'saved');
  await recoverable.session.restore();
  assert.equal(recoverable.session.getSnapshot().status, 'error');
  offline = false;
  await recoverable.session.retrySession();
  assert.equal(recoverable.session.getSnapshot().status, 'authenticated');
});

test('logout limpia inmediatamente aunque falle revocación y comunica el fallo', async () => {
  const revoke = deferred();
  const { session, saved } = setup((path) => path === 'auth/logout' ? revoke.promise : undefined);
  await session.login(credentials);
  const closing = session.logout();
  assert.equal(session.getSnapshot().status, 'anonymous');
  assert.equal(session.getSnapshot().user, null);
  assert.equal(saved(), undefined);
  revoke.reject(new TypeError('offline'));
  await closing;
  assert.match(session.getSnapshot().error, /No pudimos confirmar la revocación/);
});

test('logout durante refresh impide resurrección y revoca el token tardío', async () => {
  const rotating = deferred();
  const { session, calls, saved } = setup((path, _options, token) => {
    if (path === 'appointments/me' && token === 'access-1') throw new ApiError(401);
    if (path === 'auth/refresh') return rotating.promise;
    return undefined;
  });
  await session.login(credentials);
  const pending = session.api.request('appointments/me');
  await new Promise((resolve) => setImmediate(resolve));
  await session.logout();
  rotating.resolve(tokens('late'));
  await assert.rejects(pending, { status: 401 });
  assert.equal(session.getSnapshot().status, 'anonymous');
  assert.equal(saved(), undefined);
  assert.ok(calls.some((call) => call.path === 'auth/logout' && call.options.body.refreshToken === 'refresh-late'));
});

test('respuestas de login y perfil anteriores al logout no restauran datos privados', async () => {
  for (const delayedPath of ['auth/login', 'users/me']) {
    const late = deferred();
    const { session, saved } = setup((path) => path === delayedPath ? late.promise : undefined);
    const signingIn = session.login(credentials);
    await new Promise((resolve) => setImmediate(resolve));
    await session.logout();
    late.resolve(delayedPath === 'auth/login' ? tokens('late') : { data: profile });
    await assert.rejects(signingIn, { status: 401 });
    assert.equal(session.getSnapshot().status, 'anonymous');
    assert.equal(session.getSnapshot().user, null);
    assert.equal(saved(), undefined);
  }
});

test('una respuesta de otra sesión y un AbortSignal abortado nunca entregan datos', async () => {
  const late = deferred();
  const { session } = setup((path) => path === 'appointments/me' ? late.promise : undefined);
  await session.login(credentials);
  const request = session.api.request('appointments/me');
  await session.logout();
  await session.login(credentials);
  late.resolve({ data: ['old-user-data'] });
  await assert.rejects(request, { status: 401 });
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(session.api.request('appointments/me', { signal: controller.signal }), { name: 'AbortError' });
});

test('sessionStorage contiene exclusivamente refresh; datos corruptos o almacenamiento bloqueado no rompen el arranque', () => {
  const entries = new Map();
  const storage = createSessionStorage(() => ({ getItem: (key) => entries.get(key) ?? null, setItem: (key, value) => entries.set(key, value), removeItem: (key) => entries.delete(key) }));
  storage.write('refresh-only');
  assert.deepEqual(JSON.parse(entries.values().next().value), { refreshToken: 'refresh-only' });
  assert.equal(storage.read(), 'refresh-only');
  storage.clear();
  assert.equal(storage.read(), undefined);
  entries.set('citajusta.session.v1', JSON.stringify({ accessToken: 'not-accepted' }));
  assert.equal(storage.read(), undefined);
  assert.equal(entries.size, 0);
  const blocked = createSessionStorage(() => { throw new Error('blocked'); });
  assert.equal(blocked.read(), undefined);
  assert.doesNotThrow(() => { blocked.write('value'); blocked.clear(); });
});

test('el retorno post-login admite sólo destinos locales y evita bucles de autenticación', () => {
  assert.equal(safeReturnTo('/mis-citas?tab=history'), '/mis-citas?tab=history');
  for (const value of [undefined, 'https://external.test', '//external.test', '/\\external.test', '/login', '/registro', '/\n/evil']) assert.equal(safeReturnTo(value), '/');
});
