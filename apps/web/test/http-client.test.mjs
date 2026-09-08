import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ApiError, createHttpClient } from '../src/lib/http-client.ts';

test('centraliza la URL y obtiene el token actual sin almacenamiento persistente', async () => {
  let token;
  const calls = [];
  const client = createHttpClient({ baseUrl: '/api/v1', getAccessToken: () => token, fetcher: async (...args) => {
    calls.push(args);
    return Response.json({ data: [] });
  } });
  assert.deepEqual(await client.request('appointments/me'), { data: [] });
  assert.equal(calls[0][0], '/api/v1/appointments/me');
  assert.equal(calls[0][1].headers.has('Authorization'), false);
  token = 'test-only-token';
  await client.request('appointments/me');
  assert.equal(calls[1][1].headers.get('Authorization'), 'Bearer test-only-token');
  assert.equal(calls[1][1].credentials, 'omit');
  assert.equal(calls[1][1].redirect, 'error');
});

test('serializa JSON, propaga AbortSignal y admite respuesta 204', async () => {
  const controller = new AbortController();
  const client = createHttpClient({ baseUrl: '/api/v1', fetcher: async (_url, init) => {
    assert.equal(init.method, 'POST');
    assert.equal(init.body, JSON.stringify({ example: true }));
    assert.equal(init.headers.get('Content-Type'), 'application/json');
    assert.equal(init.signal, controller.signal);
    return new Response(null, { status: 204 });
  } });
  assert.equal(await client.request('example', { method: 'POST', body: { example: true }, signal: controller.signal }), undefined);
});

test('conserva HTTP status pero no filtra cuerpo, stack ni mensajes del servidor', async () => {
  for (const status of [400, 401, 404, 409, 500, 503]) {
    const client = createHttpClient({ baseUrl: '/api/v1', fetcher: async () => Response.json({ password: 'secret', stack: 'internal-path' }, { status }) });
    await assert.rejects(client.request('appointments/me'), (error) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.status, status);
      assert.doesNotMatch(error.message, /secret|internal-path|password/);
      return true;
    });
  }
});

test('rechaza escapes de origen/prefijo y GET con body antes de llamar a fetch', async () => {
  let calls = 0;
  const client = createHttpClient({ baseUrl: '/api/v1', fetcher: async () => { calls++; return Response.json({}); } });
  for (const path of ['https://other.test', '//other.test', '../auth', 'users/../auth', '%2e%2e/auth', '/users/me', 'users\\me', 'users/me?userId=another', 'users/me#fragment']) {
    await assert.rejects(client.request(path), /Ruta de API inválida/);
  }
  await assert.rejects(client.request('users/me', { body: {} }), /GET no admite body/);
  assert.equal(calls, 0);
});

test('no reintenta automáticamente escrituras ni errores de red', async () => {
  let calls = 0;
  const client = createHttpClient({ baseUrl: '/api/v1', fetcher: async () => { calls++; throw new TypeError('Network error'); } });
  await assert.rejects(client.request('appointments', { method: 'POST', body: {} }), TypeError);
  assert.equal(calls, 1);
});
