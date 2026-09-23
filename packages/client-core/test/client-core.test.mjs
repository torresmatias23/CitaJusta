import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ApiError, createHttpClient, normalizeApiBaseUrl } from '../src/index.ts';

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
