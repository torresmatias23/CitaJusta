import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ApiError, createAuthSession, createHttpClient, normalizeApiBaseUrl } from '../src/index.ts';

test('core requiere base explícita válida y mantiene rutas Web/absolutas sin depender de env', () => {
  for (const invalid of [undefined, '', 'ftp://example.test/api/v1', 'https://user:secret@example.test/api/v1', 'https://example.test/api/v1?token=secret', 'https://example.test/api/v1#secret', '/api/v2']) {
    assert.throws(() => normalizeApiBaseUrl(invalid), error => !error.message.includes('secret'));
  }
  assert.equal(normalizeApiBaseUrl('/api/v1/'), '/api/v1');
  assert.equal(normalizeApiBaseUrl('https://example.test/api/v1/'), 'https://example.test/api/v1');
});

test('core usa fetch inyectado, no sigue redirects y nunca propaga el body de error', async () => {
  let calls = 0;
  const api = createHttpClient({ baseUrl: 'http://localhost:3000/api/v1', fetcher: async (url, init) => {
    calls++;
    assert.equal(url, 'http://localhost:3000/api/v1/users/me');
    assert.equal(init.redirect, 'error');
    assert.equal(init.credentials, 'omit');
    return Response.json({ password: 'secret', stack: 'private' }, { status: 503 });
  } });
  await assert.rejects(api.request('users/me'), error => error instanceof ApiError && error.status === 503 && !/secret|private/.test(error.message));
  await assert.rejects(api.request('https://other.test/users/me'));
  assert.equal(calls, 1);
});

test('institution context uses only validated headers; existing requests remain context-free', async () => {
  const requests = [];
  const api = createHttpClient({ baseUrl: '/api/v1', fetcher: async (url, options) => {
    requests.push({ url, options }); return Response.json({ data: [] });
  } });
  const institutionContext = { institutionId: '10000000-0000-4000-8000-000000000001', branchId: '10000000-0000-4000-8000-000000000002' };
  await api.request('branches/administration', { institutionContext });
  assert.equal(requests[0].options.headers.get('x-institution-id'), institutionContext.institutionId);
  assert.equal(requests[0].options.headers.get('x-branch-id'), institutionContext.branchId);
  assert.equal(requests[0].options.body, undefined);
  assert.equal(requests[0].url, '/api/v1/branches/administration');
  await api.request('services');
  assert.equal(requests[1].options.headers.has('x-institution-id'), false);
  await assert.rejects(api.request('services', { institutionContext: { institutionId: 'bad\r\nAuthorization: secret' } }));
  await assert.rejects(api.request('services', { institutionContext: { institutionId: institutionContext.institutionId, branchId: '' } }));
  assert.equal(requests.length, 2);
});

test('selectContext accepts only server profile/context and rejects stale account/context responses', async () => {
  const profile = { id: 'user', firstName: 'Ana', lastName: 'Test', email: 'test@example.invalid', status: 'ACTIVE', roles: [], permissions: [], context: {} };
  const pending = [];
  const session = createAuthSession({
    publicApi: { request: async () => ({ accessToken: 'test-access', refreshToken: 'test-refresh', tokenType: 'Bearer' }) },
    authenticatedApi: () => ({ request: async (path, options) => {
      assert.equal(path, 'users/me');
      if (!options.institutionContext) return { data: profile };
      return new Promise(resolve => pending.push({ resolve, context: options.institutionContext }));
    } }), storage: { read() {}, write() {}, clear() {} },
  });
  await session.login({ email: profile.email, password: 'test-only' });
  const first = session.selectContext({ institutionId: '10000000-0000-4000-8000-000000000001' });
  const second = session.selectContext({ institutionId: '10000000-0000-4000-8000-000000000002' });
  pending[1].resolve({ data: { ...profile, context: pending[1].context, permissions: ['services.read'] } });
  await second;
  pending[0].resolve({ data: { ...profile, context: pending[0].context, permissions: ['branches.update'] } });
  await first;
  assert.deepEqual(session.getSnapshot().user.permissions, ['services.read']);
  assert.deepEqual(session.getSnapshot().user.context, pending[1].context);
  const invalid = session.selectContext(pending[1].context);
  pending[2].resolve({ data: profile });
  await assert.rejects(invalid);
  const late = session.selectContext(pending[1].context);
  await session.logout();
  pending[3].resolve({ data: { ...profile, context: pending[1].context } });
  await assert.rejects(late);
  assert.equal(session.getSnapshot().status, 'anonymous');
});
