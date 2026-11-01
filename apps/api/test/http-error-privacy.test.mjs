import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { inspect } from 'node:util';
import { after, before, test } from 'node:test';
import { Body, Controller, Get, HttpCode, HttpException, Module, Param, Post } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { gzipSync } from 'node:zlib';
import { configureApplication } from '../dist/app.configuration.js';
import { UsersController } from '../dist/users/users.controller.js';
import { UsersService } from '../dist/users/users.service.js';
import { AccessTokenGuard } from '../dist/auth/guards/access-token.guard.js';
import { AuthorizationContextGuard } from '../dist/authorization/authorization-context.guard.js';
import { PermissionsGuard } from '../dist/authorization/permissions.guard.js';
import { AuthorizationService } from '../dist/authorization/authorization.service.js';
import { PrismaService } from '../dist/database/prisma.service.js';
import { Prisma } from '../dist/generated/prisma/client.js';

// Loopback-only Nest/Express, actual profile service and guards, injected storage failures.
// No AppModule, database connection, external service, real identity or credential.
const marker = 'PRIVACY';
const userId = randomUUID(), sessionId = randomUUID(), secret = randomBytes(32).toString('hex');
const jwt = new JwtService(), logs = [];
const authorized = { authorization: `Bearer ${jwt.sign({ sub: userId, sid: sessionId }, { secret, algorithm: 'HS256', expiresIn: 300 })}` };
let app, origin, storageError, reads = 0;
class ProbeController {
  echo(body) { return { data: body }; }
  controlled(status) { throw new HttpException({ statusCode: Number(status), message: 'Controlled rejection', code: 'CONTROLLED' }, Number(status)); }
}
Controller('privacy-probe')(ProbeController);
Post()(ProbeController.prototype, 'echo', Object.getOwnPropertyDescriptor(ProbeController.prototype, 'echo'));
HttpCode(200)(ProbeController.prototype, 'echo', Object.getOwnPropertyDescriptor(ProbeController.prototype, 'echo'));
Body()(ProbeController.prototype, 'echo', 0);
Get(':status')(ProbeController.prototype, 'controlled', Object.getOwnPropertyDescriptor(ProbeController.prototype, 'controlled'));
Param('status')(ProbeController.prototype, 'controlled', 0);

before(async () => {
  class FixtureModule {}
  Module({ controllers: [UsersController, ProbeController], providers: [
    UsersService, AccessTokenGuard, AuthorizationContextGuard, PermissionsGuard, AuthorizationService,
    { provide: ConfigService, useValue: new ConfigService({ JWT_ACCESS_SECRET: secret }) },
    { provide: JwtService, useValue: jwt },
    { provide: PrismaService, useValue: {
      user: {
        findUnique: async () => ({ status: 'ACTIVE', deletedAt: null }),
        findFirst: async () => { reads++; throw storageError; },
      },
      authSession: { findUnique: async () => ({ userId, revokedAt: null, expiresAt: new Date(Date.now() + 300_000) }) },
      userRole: { findMany: async () => [] },
    } },
  ] })(FixtureModule);
  const capture = (...args) => logs.push(args);
  app = await NestFactory.create(FixtureModule, { abortOnError: false,
    logger: { log() {}, warn: capture, error: capture, debug() {}, verbose() {}, fatal: capture } });
  configureApplication(app);
  await app.listen(0, '127.0.0.1');
  origin = `http://127.0.0.1:${app.getHttpServer().address().port}/api/v1`;
});
after(async () => { await app?.close(); });
const request = (path, options = {}) => fetch(`${origin}${path}`, { ...options, signal: AbortSignal.timeout(5000) });
const post = (body, headers = {}) => request('/privacy-probe', { method: 'POST', body, headers: { 'content-type': 'application/json', ...headers } });
function noPrivateLogs() {
  assert.equal(inspect(logs, { depth: 12 }).includes(marker), false, 'logs must not contain synthetic private data');
}

test('malformed JSON never echoes submitted content before authentication', async () => {
  logs.length = 0;
  for (const body of [marker, `{"x":${marker}}`]) {
    const response = await post(body);
    assert.equal(response.status, 400);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const text = await response.text();
    assert.equal(text.includes(marker), false, 'parser must not echo submitted content');
    assert.equal(JSON.parse(text).statusCode, 400);
  }
  noPrivateLogs();
});

test('actual profile read failure returns generic 500 and never logs Prisma input or metadata', async () => {
  logs.length = 0;
  storageError = new Prisma.PrismaClientKnownRequestError(`Query failed ${marker}`, {
    code: 'P2010', clientVersion: '7.10.0', meta: { message: `${marker} synthetic private query` },
  });
  const response = await request('/users/me', { headers: authorized });
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { statusCode: 500, message: 'Internal server error' });
  noPrivateLogs();
  assert.ok(logs.length > 0, 'unexpected failures remain observable with a fixed diagnostic');
});

test('third-party status/message-shaped errors cannot expose their payload', async () => {
  logs.length = 0;
  storageError = Object.assign(new Error(marker, { cause: new Error(marker) }), { statusCode: 502, details: marker });
  const response = await request(`/users/me?untrusted=${marker}`, { headers: { ...authorized, 'x-diagnostic': marker } });
  const text = await response.text();
  assert.equal(text.includes(marker), false, 'provider messages must not reach HTTP');
  assert.equal(response.status, 500);
  noPrivateLogs();
});

test('anonymous requests retain 401 and never reach profile storage', async () => {
  const before = reads;
  const response = await request('/users/me');
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { message: 'Unauthorized', error: 'Unauthorized', statusCode: 401 });
  assert.equal(reads, before);
});

test('controlled application errors preserve status and JSON contracts', async () => {
  for (const status of [400, 401, 403, 404, 409, 429, 500, 503]) {
    const response = await request(`/privacy-probe/${status}`);
    assert.equal(response.status, status);
    assert.deepEqual(await response.json(), { statusCode: status, message: 'Controlled rejection', code: 'CONTROLLED' });
    assert.equal(response.headers.get('cache-control'), 'no-store');
  }
});

test('normal JSON, valid gzip JSON and URL-encoded parsing retain their contracts', async () => {
  const data = { label: 'fictitious', nested: { enabled: true } };
  for (const response of [await post(JSON.stringify(data)), await post(gzipSync(JSON.stringify(data)), { 'content-encoding': 'gzip' })]) {
    assert.equal(response.status, 200); assert.deepEqual(await response.json(), { data });
  }
  const response = await post('label=fictitious&nested[enabled]=true', { 'content-type': 'application/x-www-form-urlencoded' });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { data: { label: 'fictitious', nested: { enabled: 'true' } } });
});

test('parser size and encoding rejections preserve 413/415 without echoing header values', async () => {
  logs.length = 0;
  const large = await post(JSON.stringify({ text: 'x'.repeat(110_000) }));
  assert.equal(large.status, 413); await large.json();
  for (const headers of [{ 'content-encoding': marker }, { 'content-type': `application/json; charset=${marker}` }]) {
    const response = await post('{}', headers);
    assert.equal(response.status, 415);
    assert.equal((await response.text()).includes(marker.toLowerCase()), false, 'encoding errors must not echo header values');
  }
  noPrivateLogs();
});
