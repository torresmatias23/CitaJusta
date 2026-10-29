import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { configureApplication } from '../dist/app.configuration.js';
import { HealthController } from '../dist/health.controller.js';
import { UsersController } from '../dist/users/users.controller.js';
import { UsersService } from '../dist/users/users.service.js';
import { InstitutionsController } from '../dist/institutions/institutions.controller.js';
import { InstitutionsService } from '../dist/institutions/institutions.service.js';
import { AccessTokenGuard } from '../dist/auth/guards/access-token.guard.js';
import { AuthorizationContextGuard } from '../dist/authorization/authorization-context.guard.js';
import { PermissionsGuard } from '../dist/authorization/permissions.guard.js';
import { AuthorizationService } from '../dist/authorization/authorization.service.js';
import { PrismaService } from '../dist/database/prisma.service.js';

// Real controllers, HTTP middleware, guards and JWT; storage/services are doubles.
// Real auth/JWT/refresh/limiter regressions run in auth-rate-limit.http.test.mjs.
// No AppModule, database, runners, external HTTP or real credentials.
const profile = { data: { id: 'test-user', email: 'person@example.test', firstName: 'Test' } };
const institutions = { data: [{ id: 'test-institution', name: 'Demo', contactEmail: 'contact@example.test' }] };
const userId = randomUUID(), sessionId = randomUUID();
const secret = randomBytes(32).toString('hex');
const jwt = new JwtService();
const authorized = { authorization: `Bearer ${jwt.sign({ sub: userId, sid: sessionId }, {
  secret, algorithm: 'HS256', expiresIn: 300,
})}` };
let app, origin;

before(async () => {
  class FixtureModule {}
  Module({
    controllers: [HealthController, UsersController, InstitutionsController],
    providers: [AccessTokenGuard, AuthorizationContextGuard, PermissionsGuard, AuthorizationService,
      { provide: ConfigService, useValue: new ConfigService({ JWT_ACCESS_SECRET: secret }) },
      { provide: JwtService, useValue: jwt },
      { provide: PrismaService, useValue: {
        user: { findUnique: async () => ({ status: 'ACTIVE', deletedAt: null }) },
        authSession: { findUnique: async () => ({ userId, revokedAt: null, expiresAt: new Date(Date.now() + 300_000) }) },
        userRole: { findMany: async () => [] },
      } },
      { provide: UsersService, useValue: {
        getMe: async () => profile,
        updateMe: async () => { throw new Error('synthetic-private-storage-detail'); },
      } },
      { provide: InstitutionsService, useValue: { findAll: async () => institutions } },
    ],
  })(FixtureModule);
  app = await NestFactory.create(FixtureModule, { logger: false, abortOnError: false });
  configureApplication(app);
  await app.listen(0, '127.0.0.1');
  origin = `http://127.0.0.1:${app.getHttpServer().address().port}`;
});

after(async () => { await app?.close(); });

function request(path, options = {}) {
  return fetch(`${origin}${path}`, { ...options, signal: AbortSignal.timeout(5000) });
}

function assertSecurity(response, cacheControl = 'no-store', json = true) {
  assert.equal(response.headers.get('x-powered-by'), null);
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(response.headers.get('referrer-policy'), 'strict-origin-when-cross-origin');
  assert.equal(response.headers.get('cache-control'), cacheControl);
  if (json) assert.match(response.headers.get('content-type'), /^application\/json\b/);
  assert.equal(response.headers.get('access-control-allow-origin'), null);
  // Express's existing HTML final handler supplies its own restrictive CSP.
  assert.equal(response.headers.get('content-security-policy'), json ? null : "default-src 'none'");
  assert.equal(response.headers.get('strict-transport-security'), null);
}

test('personal and authenticated institutional responses retain JSON/200 with no-store', async () => {
  for (const [path, body] of [['/api/v1/users/me?view=profile', profile], ['/api/v1/institutions', institutions]]) {
    const response = await request(path, { headers: authorized });
    assert.equal(response.status, 200);
    assertSecurity(response);
    assert.deepEqual(await response.json(), body);
  }
});

test('identity rejection retains sanitized JSON/401 and security headers', async () => {
  const response = await request('/api/v1/users/me', { headers: { origin: 'https://untrusted.invalid' } });
  assert.equal(response.status, 401);
  assertSecurity(response);
  assert.deepEqual(await response.json(), { message: 'Unauthorized', error: 'Unauthorized', statusCode: 401 });
});

test('malformed JSON is rejected before controllers with JSON/400 and no-store', async () => {
  const response = await request('/api/v1/users/me', {
    method: 'PATCH', headers: { ...authorized, 'content-type': 'application/json' }, body: '{',
  });
  assert.equal(response.status, 400);
  assertSecurity(response);
  const body = await response.json();
  assert.equal(body.statusCode, 400);
  assert.equal(body.error, 'Bad Request');
  assert.equal(body.stack, undefined);
});

test('unexpected service failure remains generic JSON/500 with no-store', async () => {
  const response = await request('/api/v1/users/me', {
    method: 'PATCH', headers: { ...authorized, 'content-type': 'application/json' },
    body: JSON.stringify({ firstName: 'Test', lastName: 'Person' }),
  });
  assert.equal(response.status, 500);
  assertSecurity(response);
  assert.deepEqual(await response.json(), { statusCode: 500, message: 'Internal server error' });
});

test('unknown API paths and Express case-insensitive routes retain no-store', async () => {
  const missing = await request('/api/v1/missing');
  assert.equal(missing.status, 404);
  assertSecurity(missing);
  await missing.json();
  const mixedCase = await request('/API/V1/users/me', { headers: authorized });
  assert.equal(mixedCase.status, 200);
  assertSecurity(mixedCase);
  assert.deepEqual(await mixedCase.json(), profile);
});

test('health and public paths outside the API prefix do not acquire no-store', async () => {
  const health = await request('/health');
  assert.equal(health.status, 200);
  assertSecurity(health, null);
  assert.deepEqual(await health.json(), { status: 'ok' });
  for (const path of ['/assets/public.js', '/api/v10/users/me', '/api/v1-public']) {
    const response = await request(path);
    assert.equal(response.status, 404);
    // Outside the versioned router, Nest/Express can use its HTML 404 handler.
    assertSecurity(response, null, false);
    await response.text();
  }
});
