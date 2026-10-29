import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { test } from 'node:test';
import { BadRequestException, Module, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { AuthController } from '../dist/auth/auth.controller.js';
import { AuthService } from '../dist/auth/auth.service.js';
import { AccountRecoveryController } from '../dist/auth/account-recovery.controller.js';
import { AccountRecoveryService, recoveryAcknowledgement } from '../dist/auth/account-recovery.service.js';
import { AuthRateLimitGuard } from '../dist/auth/auth-rate-limit.guard.js';
import { AuthRateLimitService } from '../dist/auth/auth-rate-limit.service.js';
import { authRateLimitPolicies } from '../dist/auth/auth-rate-limit.policy.js';
import { AccessTokenGuard } from '../dist/auth/guards/access-token.guard.js';
import { PrismaService } from '../dist/database/prisma.service.js';
import { configureApplication } from '../dist/app.configuration.js';

// Real Nest HTTP, controllers, DTOs, guard, limiter, local auth service and JWT.
// Only persistence and external/recovery effects are doubles. This is NOT a
// PostgreSQL atomicity/concurrency test (see e2e/auth-rate-limit.e2e.test.mjs).
async function fixture(t) {
  let now = 0, storageError;
  const counters = new Map(), users = new Map(), sessions = new Map(), audits = [], queries = [];
  const db = {
    $queryRaw: async query => {
      if (storageError) throw storageError;
      queries.push(query);
      const [key, seconds, sentinel] = query.values;
      let counter = counters.get(key);
      if (!counter || counter.expires <= now) {
        counter = { count: 0, expires: now + seconds * 1000 };
        counters.set(key, counter);
      }
      counter.count = Math.min(counter.count + 1, sentinel);
      return [{ allowed: counter.count < sentinel, retryAfterSeconds: Math.ceil((counter.expires - now) / 1000) }];
    },
    user: {
      findUnique: async ({ where }) => users.get(where.id) ?? [...users.values()].find(user => user.email === where.email) ?? null,
      create: async ({ data }) => { const user = { ...data, deletedAt: null }; users.set(user.id, user); return user; },
      update: async ({ where, data }) => Object.assign(users.get(where.id), data),
    },
    authSession: {
      create: async ({ data }) => { const session = { ...data, revokedAt: null }; sessions.set(session.id, session); return session; },
      findUnique: async ({ where }) => { const session = sessions.get(where.id); return session ? { ...session, user: users.get(session.userId) } : null; },
      updateMany: async ({ where, data }) => {
        const session = sessions.get(where.id);
        if (!session || session.userId !== where.userId || session.revokedAt !== where.revokedAt ||
          (where.refreshTokenHash && session.refreshTokenHash !== where.refreshTokenHash) ||
          (where.expiresAt && session.expiresAt <= where.expiresAt.gt)) return { count: 0 };
        Object.assign(session, data); return { count: 1 };
      },
    },
    auditEvent: { create: async ({ data }) => { audits.push(data); return data; } },
  };
  db.$transaction = async work => work(db);
  const config = new ConfigService({ JWT_ACCESS_SECRET: randomBytes(32).toString('hex'), JWT_REFRESH_SECRET: randomBytes(32).toString('hex'),
    JWT_ACCESS_TTL_SECONDS: 900, JWT_REFRESH_TTL_SECONDS: 3600 });
  const jwt = new JwtService();
  const auth = new AuthService(db, jwt, config, { verify: async () => { throw new UnauthorizedException('Invalid Google credential'); } });
  const limiter = new AuthRateLimitService(db, config);
  class FixtureModule {}
  Module({ controllers: [AuthController, AccountRecoveryController], providers: [AuthRateLimitGuard, AccessTokenGuard,
    { provide: PrismaService, useValue: db },
    { provide: JwtService, useValue: jwt },
    { provide: ConfigService, useValue: config },
    { provide: AuthRateLimitService, useValue: limiter },
    { provide: AuthService, useValue: auth },
    { provide: AccountRecoveryService, useValue: {
      request: async () => recoveryAcknowledgement,
      reset: async () => { throw new BadRequestException('Recovery link invalid or expired'); },
    } },
  ] })(FixtureModule);
  const app = await NestFactory.create(FixtureModule, { logger: false, abortOnError: false });
  t.after(() => app.close());
  configureApplication(app);
  await app.listen(0, '127.0.0.1');
  const origin = `http://127.0.0.1:${app.getHttpServer().address().port}`;
  return { counters, users, audits, queries, advance: milliseconds => { now += milliseconds; },
    failStorage: error => { storageError = error; },
    async post(route, body, headers = {}) {
      const response = await fetch(`${origin}/api/v1/auth/${route}`, { method: 'POST',
        headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(5000) });
      // All real auth responses, including parser/validation/guard failures,
      // retain the HTTP security policy without changing their JSON contract.
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.equal(response.headers.get('x-powered-by'), null);
      assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
      assert.equal(response.headers.get('referrer-policy'), 'strict-origin-when-cross-origin');
      if (response.status !== 204) assert.match(response.headers.get('content-type'), /^application\/json\b/);
      return { status: response.status, headers: response.headers, body: response.status === 204 ? null : await response.json() };
    },
  };
}

for (const [route, policy] of Object.entries(authRateLimitPolicies)) {
  test(`HTTP ${route}: admits exactly ${policy.requests} attempts; next request returns sanitized 429 before validation`, async t => {
    const f = await fixture(t);
    for (let i = 0; i < policy.requests; i++) assert.equal((await f.post(route, {})).status, 400);
    const response = await f.post(route, { password: 'private-password', refreshToken: 'private-token' });
    assert.equal(response.status, 429);
    assert.equal(response.headers.get('retry-after'), String(policy.windowSeconds));
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.body.message, 'Too many authentication requests. Try again later.');
    assert.ok(!JSON.stringify(response.body).includes('private-'));
  });
}

test('HTTP normal registration, login, refresh rotation, replay denial and logout retain their contracts', async t => {
  const f = await fixture(t);
  const credentials = { email: 'normal@example.test', password: 'A-secure-test-password-456' };
  assert.equal((await f.post('register', { ...credentials, firstName: 'Test', lastName: 'Person' })).status, 201);
  const login = await f.post('login', credentials);
  assert.equal(login.status, 200);
  assert.equal(login.body.tokenType, 'Bearer');
  const refresh = await f.post('refresh', { refreshToken: login.body.refreshToken });
  assert.equal(refresh.status, 200);
  assert.notEqual(refresh.body.refreshToken, login.body.refreshToken);
  assert.equal((await f.post('refresh', { refreshToken: login.body.refreshToken })).status, 401);
  assert.equal((await f.post('logout', { refreshToken: refresh.body.refreshToken })).status, 204);
  assert.equal((await f.post('refresh', { refreshToken: refresh.body.refreshToken })).status, 401);
  const persisted = JSON.stringify({ queries: f.queries, audits: f.audits });
  for (const secret of [credentials.password, login.body.accessToken, login.body.refreshToken, refresh.body.refreshToken]) assert.ok(!persisted.includes(secret));
});

test('HTTP failed login remains non-enumerating; rotating emails and forged IP headers cannot evade the quota', async t => {
  const f = await fixture(t);
  const credentials = { email: 'existing@example.test', password: 'A-secure-test-password-456' };
  await f.post('register', { ...credentials, firstName: 'Test', lastName: 'Person' });
  let firstBody;
  for (let i = 0; i < authRateLimitPolicies.login.requests; i++) {
    const response = await f.post('login', { email: i % 2 ? `absent-${i}@example.test` : ' EXISTING@EXAMPLE.TEST ', password: 'incorrect-password' }, {
      'x-forwarded-for': `198.51.100.${i}`, 'x-real-ip': `192.0.2.${i}`, forwarded: `for=203.0.113.${i}`, 'x-user-id': String(i),
    });
    assert.equal(response.status, 401);
    firstBody ??= response.body;
    assert.deepEqual(response.body, firstBody);
  }
  assert.equal((await f.post('login', credentials, { 'x-forwarded-for': '127.0.0.2' })).status, 429);
  assert.equal(f.audits.filter(event => event.actionCode === 'AUTH_LOGIN_FAILURE').length, 20);
  assert.ok(!JSON.stringify(f.queries).includes('existing@example.test'));
});

test('HTTP routes have independent quotas; rejected requests do not extend expiry and access resumes at boundary (storage double)', async t => {
  const f = await fixture(t);
  for (let i = 0; i < 5; i++) await f.post('register', {});
  assert.equal((await f.post('register', {})).status, 429);
  assert.equal((await f.post('login', {})).status, 400);
  assert.equal((await f.post('forgot-password', { email: 'absent@example.test' })).status, 202);
  f.advance(899_000);
  const blocked = await f.post('register', {});
  assert.equal(blocked.status, 429);
  assert.equal(blocked.headers.get('retry-after'), '1');
  f.advance(1000);
  const resumed = await f.post('register', {});
  assert.equal(resumed.status, 400);
  assert.equal(resumed.headers.get('retry-after'), null);
});

test('HTTP storage programming failure returns sanitized 500 without Retry-After or authentication side effects', async t => {
  const f = await fixture(t);
  f.failStorage(new Error('private-password-token-storage-detail'));
  const response = await f.post('register', { email: 'new@example.test', password: 'A-secure-test-password-456', firstName: 'Test', lastName: 'Person' });
  assert.equal(response.status, 500);
  assert.equal(response.headers.get('retry-after'), null);
  assert.ok(!JSON.stringify(response.body).includes('private-'));
  assert.equal(f.users.size, 0);
});

test('HTTP invalid Google and recovery tokens retain sanitized responses within their independent limits', async t => {
  const f = await fixture(t);
  const google = await f.post('google', { credential: 'private-invalid-google-token' });
  assert.equal(google.status, 401);
  assert.ok(!JSON.stringify(google.body).includes('private-invalid'));
  const reset = await f.post('reset-password', { token: 'A'.repeat(43), password: 'A-secure-test-password-456' });
  assert.equal(reset.status, 400);
  assert.equal((await f.post('google/link', { credential: 'invalid' })).status, 401);
});
