import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { configureApplication } from '../dist/app.configuration.js';
import { AccessTokenGuard } from '../dist/auth/guards/access-token.guard.js';
import { PrivacyNoticeService } from '../dist/users/privacy-notice.service.js';
import { PrivacyNoticeController, PublicPrivacyNoticeController } from '../dist/users/privacy-notice.controller.js';
import { currentPrivacyNotice as notice } from '../dist/users/privacy-notices.js';
import { PrismaService } from '../dist/database/prisma.service.js';
import { privacyStorage } from './fixtures/privacy-notice.mjs';

const f = privacyStorage(), secret = randomBytes(32).toString('hex'), jwt = new JwtService();
function actor() {
  const userId = randomUUID(), sid = randomUUID();
  f.users.set(userId, { status: 'ACTIVE', deletedAt: null });
  f.sessions.set(sid, { userId, revokedAt: null, expiresAt: new Date(Date.now() + 300_000) });
  return { userId, sid, token: jwt.sign({ sub: userId, sid }, { secret, algorithm: 'HS256', expiresIn: 300 }) };
}
const a = actor(), b = actor(); let app, base;
before(async () => {
  class FixtureModule {}
  Module({ controllers: [PrivacyNoticeController, PublicPrivacyNoticeController], providers: [PrivacyNoticeService, AccessTokenGuard,
    { provide: PrismaService, useValue: f.db }, { provide: JwtService, useValue: jwt },
    { provide: ConfigService, useValue: new ConfigService({ JWT_ACCESS_SECRET: secret }) },
  ] })(FixtureModule);
  app = await NestFactory.create(FixtureModule, { logger: false, abortOnError: false });
  configureApplication(app); await app.listen(0, '127.0.0.1'); base = `http://127.0.0.1:${app.getHttpServer().address().port}/api/v1`;
});
after(() => app?.close());
const path = '/users/me/privacy-notice';
const request = (route, token, body, headers = {}) => fetch(`${base}${route}`, { signal: AbortSignal.timeout(5000),
  method: body === undefined ? 'GET' : 'POST', headers: { ...headers, ...(token ? { authorization: `Bearer ${token}` } : {}),
    ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

test('public information works anonymously and has no acknowledgement side effect', async () => {
  const response = await request('/privacy-notice'); assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { data: notice }); assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(f.events.length, 0);
});
test('own evidence requires a valid active session, independent of institutional privileges', async () => {
  for (const token of [undefined, 'invalid']) for (const body of [undefined, { versionId: notice.id }]) {
    assert.equal((await request(body ? `${path}/acknowledgement` : path, token, body)).status, 401);
  }
  const response = await request(path, a.token); assert.equal(response.status, 200);
  assert.equal((await response.json()).data.acknowledgedAt, null);
});
test('body/query/path IDOR attempts cannot target another user or tenant', async () => {
  for (const key of ['userId', 'institutionId', 'actorUserId', 'consent', 'acknowledgedAt']) {
    assert.equal((await request(`${path}/acknowledgement`, a.token, { versionId: notice.id, [key]: b.userId })).status, 400);
  }
  assert.equal((await request(`${path}?userId=${b.userId}`, a.token)).status, 400);
  assert.equal((await request(`/users/${b.userId}/privacy-notice/acknowledgement`, a.token, { versionId: notice.id })).status, 404);
  assert.equal(f.events.length, 0);
});
test('confirmation persists only for actor; tenant headers cannot redirect it; repeat stays idempotent', async () => {
  const first = await request(`${path}/acknowledgement`, a.token, { versionId: notice.id }, { 'x-institution-id': randomUUID() });
  assert.equal(first.status, 200); const saved = await first.json();
  const second = await request(`${path}/acknowledgement`, a.token, { versionId: notice.id });
  assert.deepEqual(await second.json(), saved);
  assert.equal(f.events.length, 1); assert.equal(f.events[0].actorUserId, a.userId);
  assert.equal((await (await request(path, b.token)).json()).data.acknowledgedAt, null);
});
test('stale version and revoked session fail without writes', async () => {
  assert.equal((await request(`${path}/acknowledgement`, b.token, { versionId: randomUUID() })).status, 409);
  f.sessions.get(b.sid).revokedAt = new Date();
  assert.equal((await request(`${path}/acknowledgement`, b.token, { versionId: notice.id })).status, 401);
  assert.equal(f.events.length, 1);
});
