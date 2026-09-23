import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createAuthSession, createHttpClient, ApiError } from '@citajusta/client-core';
import { createMemorySessionStorage } from '../src/auth/memory-session-storage.ts';
import { readDesktopApiBaseUrl } from '../src/lib/env.ts';

test('storage sólo memoria: read/write/clear, sin acceso a almacenamiento externo; instancia nueva vacía', () => {
  const globals = ['localStorage', 'sessionStorage'];
  const descriptors = globals.map(key => Object.getOwnPropertyDescriptor(globalThis, key));
  try {
    globals.forEach(key => Object.defineProperty(globalThis, key, { configurable: true, get() { throw new Error('Persistencia prohibida'); } }));
    const storage = createMemorySessionStorage();
    assert.equal(storage.read(), undefined);
    storage.write('test-refresh');
    assert.equal(storage.read(), 'test-refresh');
    assert.equal(createMemorySessionStorage().read(), undefined);
    storage.clear();
    assert.equal(storage.read(), undefined);
  } finally {
    globals.forEach((key, i) => descriptors[i] ? Object.defineProperty(globalThis, key, descriptors[i]) : delete globalThis[key]);
  }
});

test('URL absoluta HTTP(S) exacta: rechaza credenciales, query/hash, rutas y controles sin filtrarlos', () => {
  for (const value of [undefined, '', '/api/v1', 'file:///api/v1', '//localhost:3000/api/v1', 'https://u:secret@localhost/api/v1', 'http://localhost/api/v1?q=secret', 'http://localhost/api/v1#secret', 'http://localhost/api/v1?', 'http://localhost/api/v1#', 'http://localhost/api/v2', 'http://localhost/api/v1/auth', ' http://localhost/api/v1', 'http://local\nhost/api/v1']) {
    assert.throws(() => readDesktopApiBaseUrl(value), error => !error.message.includes('secret'));
  }
  assert.equal(readDesktopApiBaseUrl('http://localhost:3000/api/v1/'), 'http://localhost:3000/api/v1');
  assert.equal(readDesktopApiBaseUrl('https://api.example.test/api/v1'), 'https://api.example.test/api/v1');
});

function setup() {
  const calls = [];
  const storage = createMemorySessionStorage();
  const profile = { id: 'controlled-user', firstName: 'Persona', lastName: 'Prueba', email: 'test@example.invalid', status: 'ACTIVE', context: {}, roles: [], permissions: [] };
  let unauthorized = false;
  const fetcher = async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith('auth/logout')) return new Response(null, { status: 204 });
    if (url.endsWith('auth/login') || url.endsWith('auth/refresh')) return Response.json({ accessToken: 'test-access', refreshToken: 'test-refresh', tokenType: 'Bearer' });
    if (unauthorized) { unauthorized = false; return new Response(null, { status: 401 }); }
    assert.equal(options.headers.get('Authorization'), 'Bearer test-access');
    return Response.json({ data: profile });
  };
  const client = getAccessToken => createHttpClient({ baseUrl: 'http://localhost:3000/api/v1', fetcher, getAccessToken });
  const session = createAuthSession({ publicApi: client(), authenticatedApi: client, storage });
  return { session, calls, storage, expire: () => { unauthorized = true; } };
}

test('arranque anonymous sin API; login/me reales al transporte, snapshot sin tokens ni contexto inventado', async () => {
  const { session, calls, storage } = setup();
  await session.restore();
  assert.equal(session.getSnapshot().status, 'anonymous');
  assert.equal(calls.length, 0);
  await session.login({ email: 'test@example.invalid', password: 'test-only' });
  assert.equal(session.getSnapshot().status, 'authenticated');
  assert.deepEqual(session.getSnapshot().user.context, {});
  assert.equal(calls.length, 2);
  assert.equal(storage.read(), 'test-refresh');
  assert.doesNotMatch(JSON.stringify(session.getSnapshot()), /test-access|test-refresh|test-only/);
  const logout = session.logout();
  assert.equal(storage.read(), undefined);
  assert.equal(session.getSnapshot().status, 'anonymous');
  await logout;
  await assert.rejects(session.api.request('users/me'), error => error instanceof ApiError && error.status === 401);
});

test('Desktop renueva con el mismo núcleo y no reenvía escrituras sensibles', async () => {
  const { session, calls, expire } = setup();
  await session.login({ email: 'test@example.invalid', password: 'test-only' });
  expire();
  await session.api.request('users/me');
  assert.equal(calls.filter(call => call.url.endsWith('auth/refresh')).length, 1);
  expire();
  await assert.rejects(session.api.request('sensitive', { method: 'POST', retryAfterRefresh: false }), error => error instanceof ApiError && error.status === 401);
  assert.equal(calls.filter(call => call.url.endsWith('sensitive')).length, 1);
});
