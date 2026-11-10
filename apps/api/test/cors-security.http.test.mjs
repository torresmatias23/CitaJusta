import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { NestFactory } from '@nestjs/core';
import { configureApplication } from '../dist/app.configuration.js';
import { HealthController } from '../dist/health.controller.js';
import { UsersController } from '../dist/users/users.controller.js';
import { UsersService } from '../dist/users/users.service.js';
import { AuthController } from '../dist/auth/auth.controller.js';
import { AuthService } from '../dist/auth/auth.service.js';
import { AuthRateLimitService } from '../dist/auth/auth-rate-limit.service.js';
import { AuthRateLimitGuard } from '../dist/auth/auth-rate-limit.guard.js';
import { AccessTokenGuard } from '../dist/auth/guards/access-token.guard.js';
import { AuthorizationContextGuard } from '../dist/authorization/authorization-context.guard.js';
import { AuthorizationService } from '../dist/authorization/authorization.service.js';
import { PermissionsGuard } from '../dist/authorization/permissions.guard.js';
import { PrismaService } from '../dist/database/prisma.service.js';

const origins = ['https://web.example.test', 'http://localhost:5173'];
async function fixture(t, allowedOrigins = origins) {
  const userId = randomUUID(), sid = randomUUID(), secret = randomBytes(32).toString('hex'), jwt = new JwtService();
  const config = new ConfigService({ JWT_ACCESS_SECRET: secret });
  const counters = new Map();
  const db = {
    $queryRaw: async query => {
      const [key, seconds, sentinel] = query.values, count = (counters.get(key) ?? 0) + 1;
      counters.set(key, count); return [{ allowed: count < sentinel, retryAfterSeconds: seconds }];
    },
    user: { findUnique: async () => ({ status: 'ACTIVE', deletedAt: null }) },
    authSession: { findUnique: async () => ({ userId, revokedAt: null, expiresAt: new Date(Date.now() + 300_000) }) },
    userRole: { findMany: async () => [] },
  };
  class FixtureModule {}
  Module({ controllers: [UsersController, HealthController, AuthController], providers: [AccessTokenGuard,
    AuthorizationContextGuard, AuthorizationService, PermissionsGuard, AuthRateLimitGuard,
    { provide: ConfigService, useValue: config }, { provide: JwtService, useValue: jwt }, { provide: PrismaService, useValue: db },
    { provide: AuthRateLimitService, useValue: new AuthRateLimitService(db, config) },
    { provide: AuthService, useValue: {} }, { provide: UsersService, useValue: {
      getMe: async () => ({ data: { id: userId } }),
      updateMe: async () => { throw new Error('private-storage-detail'); },
    } },
  ] })(FixtureModule);
  const app = await NestFactory.create(FixtureModule, { logger: false, abortOnError: false });
  t.after(() => app.close()); configureApplication(app, allowedOrigins); await app.listen(0, '127.0.0.1');
  const base = `http://127.0.0.1:${app.getHttpServer().address().port}`;
  const authorization = `Bearer ${jwt.sign({ sub: userId, sid }, { secret, algorithm: 'HS256', expiresIn: 300 })}`;
  return { counters, base, async request(path, { origin, headers, ...options } = {}) {
    return fetch(`${base}${path}`, { ...options, headers: { ...(origin !== undefined ? { Origin: origin } : {}), ...headers }, signal: AbortSignal.timeout(5000) });
  }, authorization };
}
function policy(response, origin = null) {
  assert.equal(response.headers.get('access-control-allow-origin'), origin);
  assert.equal(response.headers.get('access-control-allow-credentials'), null);
  assert.ok(response.headers.get('vary')?.split(/,\s*/).includes('Origin'));
  assert.equal(response.headers.get('x-frame-options'), 'DENY');
  assert.equal(response.headers.get('content-security-policy'), "frame-ancestors 'none'");
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(response.headers.get('referrer-policy'), 'strict-origin-when-cross-origin');
  assert.equal(response.headers.get('x-powered-by'), null); assert.equal(response.headers.get('strict-transport-security'), null);
}

test('CORS permits only exact configured origins, without cookies or broad CSP resource restrictions', async t => {
  const f = await fixture(t);
  for (const origin of origins) {
    const response = await f.request('/api/v1/users/me', { origin, headers: { authorization: f.authorization } });
    assert.equal(response.status, 200); policy(response, origin); assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('access-control-expose-headers'), 'Retry-After'); await response.json();
  }
});
test('CORS exact matching rejects foreign protocol/host/port, suffix tricks and opaque origins without replacing authentication', async t => {
  const f = await fixture(t);
  for (const origin of ['https://foreign.test', 'http://web.example.test', 'https://web.example.test:8443',
    'https://web.example.test.foreign.test', 'http://localhost:5174', 'null']) {
    const response = await f.request('/api/v1/users/me', { origin });
    assert.equal(response.status, 401); policy(response); await response.json();
  }
  const allowedButUnauthenticated = await f.request('/api/v1/users/me', { origin: origins[0] });
  assert.equal(allowedButUnauthenticated.status, 401); policy(allowedButUnauthenticated, origins[0]); await allowedButUnauthenticated.json();
});
test('empty CORS list never grants cross-origin access; no-Origin and same-origin authenticated requests keep working', async t => {
  const f = await fixture(t, []);
  for (const origin of [undefined, f.base, origins[0]]) {
    const response = await f.request('/api/v1/users/me', { origin, headers: { authorization: f.authorization } });
    assert.equal(response.status, 200); policy(response); await response.json();
  }
  const preflight = await f.request('/api/v1/users/me', { origin: origins[0], method: 'OPTIONS', headers: { 'Access-Control-Request-Method': 'GET' } });
  assert.equal(preflight.status, 204); policy(preflight); assert.equal(await preflight.text(), '');
});
test('preflight allows only Web methods/headers, including context and Calendar X-Requested-With', async t => {
  const f = await fixture(t);
  const response = await f.request(`/api/v1/appointments/${randomUUID()}/google-calendar`, {
    origin: origins[0], method: 'OPTIONS', headers: { 'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'authorization,content-type,x-requested-with,x-institution-id,x-branch-id' },
  });
  assert.equal(response.status, 204); policy(response, origins[0]); assert.equal(await response.text(), '');
  assert.deepEqual(response.headers.get('access-control-allow-methods').split(','), ['GET', 'POST', 'PUT', 'PATCH']);
  const allowed = response.headers.get('access-control-allow-headers').toLowerCase().split(',');
  assert.deepEqual(allowed, ['accept', 'authorization', 'content-type', 'x-institution-id', 'x-branch-id', 'x-requested-with']);
  assert.equal(f.counters.size, 0);
  const denied = await f.request('/api/v1/users/me', { origin: 'https://foreign.test', method: 'OPTIONS', headers: { 'Access-Control-Request-Method': 'GET' } });
  assert.equal(denied.status, 204); policy(denied); assert.equal(await denied.text(), '');
  const extra = await f.request('/api/v1/users/me', { origin: origins[0], method: 'OPTIONS', headers: {
    'Access-Control-Request-Method': 'DELETE', 'Access-Control-Request-Headers': 'x-arbitrary' } });
  assert.equal(extra.status, 204); policy(extra, origins[0]);
  assert.ok(!extra.headers.get('access-control-allow-methods').includes('DELETE'));
  assert.ok(!extra.headers.get('access-control-allow-headers').toLowerCase().includes('x-arbitrary'));
});
test('CORS is installed before parsers and preserves allowed-origin headers on 400/401/404/500', async t => {
  const f = await fixture(t);
  for (const origin of [origins[0], 'https://foreign.test']) {
    for (const [path, options, status] of [
      ['/api/v1/users/me', {}, 401], ['/api/v1/missing', {}, 404],
      ['/api/v1/users/me', { method: 'PATCH', headers: { authorization: f.authorization, 'content-type': 'application/json' }, body: '{' }, 400],
      ['/api/v1/users/me', { method: 'PATCH', headers: { authorization: f.authorization, 'content-type': 'application/json' }, body: JSON.stringify({ firstName: 'Test' }) }, 500],
    ]) {
      const response = await f.request(path, { origin, ...options });
      assert.equal(response.status, status); policy(response, origin === origins[0] ? origin : null);
      assert.equal(response.headers.get('cache-control'), 'no-store'); assert.doesNotMatch(await response.text(), /private-storage-detail|stack/);
    }
  }
});
test('real auth limiter 429 keeps CORS, Retry-After and framing headers without changing its quota', async t => {
  const f = await fixture(t);
  for (let i = 0; i < 5; i++) {
    const response = await f.request('/api/v1/auth/register', { origin: origins[0], method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    assert.equal(response.status, 400); await response.json();
  }
  const denied = await f.request('/api/v1/auth/register', { origin: origins[0], method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  assert.equal(denied.status, 429); policy(denied, origins[0]); assert.equal(denied.headers.get('retry-after'), '900');
  assert.equal(denied.headers.get('cache-control'), 'no-store'); await denied.json();
});
