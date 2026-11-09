import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { NestFactory } from '@nestjs/core';
import { AppointmentsController } from '../dist/appointments/appointments.controller.js';
import { AppointmentsService } from '../dist/appointments/appointments.service.js';
import { AppointmentCalendarService } from '../dist/appointments/appointment-calendar.service.js';
import { AttendanceConfirmationService } from '../dist/appointments/attendance-confirmation.service.js';
import { BookingRateLimitGuard } from '../dist/appointments/booking-rate-limit.guard.js';
import { BookingRateLimitService } from '../dist/appointments/booking-rate-limit.service.js';
import { AccessTokenGuard } from '../dist/auth/guards/access-token.guard.js';
import { AuthorizationContextGuard } from '../dist/authorization/authorization-context.guard.js';
import { AuthorizationService } from '../dist/authorization/authorization.service.js';
import { PermissionsGuard } from '../dist/authorization/permissions.guard.js';
import { PrismaService } from '../dist/database/prisma.service.js';
import { Prisma } from '../dist/generated/prisma/client.js';
import { configureApplication } from '../dist/app.configuration.js';

// Real Nest routing, guards, JWT and limiter; persistence/domain effects are doubles.
// This suite does NOT establish PostgreSQL atomicity; the protected E2E does.
async function fixture(t) {
  let now = 0, storageError;
  const counters = new Map(), queries = [], users = new Map(), sessions = new Map();
  const effects = { appointments: [], slots: [], histories: [], notifications: [] };
  const config = new ConfigService({ JWT_ACCESS_SECRET: randomBytes(32).toString('hex') }), jwt = new JwtService();
  const db = {
    $queryRaw: async query => {
      if (storageError) throw storageError;
      queries.push(query);
      const [key, seconds, sentinel] = query.values;
      let counter = counters.get(key);
      if (!counter || counter.expires <= now) { counter = { count: 0, expires: now + seconds * 1000 }; counters.set(key, counter); }
      counter.count = Math.min(counter.count + 1, sentinel);
      return [{ allowed: counter.count < sentinel, retryAfterSeconds: Math.ceil((counter.expires - now) / 1000) }];
    },
    user: { findUnique: async ({ where }) => users.get(where.id) ?? null },
    authSession: { findUnique: async ({ where }) => sessions.get(where.id) ?? null },
  };
  const service = {
    reserve: async (slot, principal) => {
      const row = { id: randomUUID(), agendaSlotId: slot, status: 'AGENDADA', origin: 'WEB' };
      effects.appointments.push({ ...row, userId: principal.userId }); effects.slots.push(slot);
      effects.histories.push(row.id); effects.notifications.push(row.id);
      return { data: row };
    },
    findMine: async () => ({ data: [] }), cancel: async () => ({ data: { status: 'CANCELADA' } }),
  };
  class FixtureModule {}
  Module({ controllers: [AppointmentsController], providers: [AccessTokenGuard, BookingRateLimitGuard, BookingRateLimitService,
    AuthorizationContextGuard, PermissionsGuard,
    { provide: AuthorizationService, useValue: {} }, { provide: ConfigService, useValue: config },
    { provide: PrismaService, useValue: db }, { provide: JwtService, useValue: jwt },
    { provide: AppointmentsService, useValue: service },
    { provide: AppointmentCalendarService, useValue: { export: async () => ({ data: {} }) } },
    { provide: AttendanceConfirmationService, useValue: {} },
  ] })(FixtureModule);
  const app = await NestFactory.create(FixtureModule, { logger: false, abortOnError: false });
  t.after(() => app.close()); configureApplication(app); await app.listen(0, '127.0.0.1');
  const base = `http://127.0.0.1:${app.getHttpServer().address().port}/api/v1/appointments`;
  async function token(userId = randomUUID()) {
    users.set(userId, { status: 'ACTIVE', deletedAt: null }); const sid = randomUUID();
    sessions.set(sid, { userId, expiresAt: new Date(Date.now() + 3600_000), revokedAt: null });
    return { userId, sid, bearer: await jwt.signAsync({ sub: userId, sid }, { secret: config.get('JWT_ACCESS_SECRET'), expiresIn: 900 }) };
  }
  async function request(auth, { path = '', method = 'POST', body = { agendaSlotId: randomUUID() }, headers = {} } = {}) {
    const response = await fetch(`${base}${path}`, { method,
      headers: { 'content-type': 'application/json', ...(auth ? { authorization: `Bearer ${auth.bearer}` } : {}), ...headers },
      ...(method === 'GET' ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(5000) });
    return { status: response.status, headers: response.headers, body: await response.json() };
  }
  return { token, request, effects, queries, counters, users, sessions,
    advance: ms => { now += ms; }, failStorage: error => { storageError = error; } };
}

test('HTTP admits ten reservations, rejects the eleventh with Retry-After and no domain effects', async t => {
  const f = await fixture(t), user = await f.token();
  for (let i = 0; i < 10; i++) assert.equal((await f.request(user)).status, 201);
  const before = structuredClone(f.effects), response = await f.request(user);
  assert.equal(response.status, 429); assert.equal(response.headers.get('retry-after'), '60');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.body.message, 'Too many booking requests. Try again later.');
  assert.deepEqual(f.effects, before); assert.equal(f.effects.appointments.length, 10);
  assert.equal(f.queries.length, 11); assert.equal(f.counters.size, 1);
});
test('HTTP users have isolated quotas even at the same origin and institution', async t => {
  const f = await fixture(t), first = await f.token(), second = await f.token();
  for (let i = 0; i < 10; i++) await f.request(first);
  assert.equal((await f.request(first)).status, 429); assert.equal((await f.request(second)).status, 201);
  assert.equal(f.counters.size, 2);
});
test('HTTP new session/JWT and client-controlled headers do not bypass the user quota', async t => {
  const f = await fixture(t), first = await f.token();
  for (let i = 0; i < 10; i++) await f.request(first);
  const secondSession = await f.token(first.userId); assert.notEqual(first.sid, secondSession.sid);
  const response = await f.request(secondSession, { headers: { 'x-forwarded-for': '192.0.2.25', 'x-institution-id': randomUUID(), 'x-user-id': randomUUID() } });
  assert.equal(response.status, 429); assert.equal(f.counters.size, 1); assert.equal(f.effects.appointments.length, 10);
});
test('HTTP remaining Retry-After decreases without extending the window; reset admits again', async t => {
  const f = await fixture(t), user = await f.token();
  for (let i = 0; i < 10; i++) await f.request(user);
  f.advance(30_001);
  const denied = await f.request(user); assert.equal(denied.status, 429); assert.equal(denied.headers.get('retry-after'), '30');
  f.advance(29_999); assert.equal((await f.request(user)).status, 201);
  assert.equal(f.effects.appointments.length, 11);
});
test('HTTP concurrent requests respect the quota in the storage double', async t => {
  const f = await fixture(t), user = await f.token();
  const responses = await Promise.all(Array.from({ length: 25 }, () => f.request(user)));
  assert.equal(responses.filter(r => r.status === 201).length, 10); assert.equal(responses.filter(r => r.status === 429).length, 15);
  assert.equal(f.effects.appointments.length, 10); assert.equal([...f.counters.values()][0].count, 11);
});
test('HTTP missing/invalid/expired tokens and revoked/inactive identities fail before quota storage', async t => {
  const f = await fixture(t);
  assert.equal((await f.request()).status, 401); assert.equal((await f.request({ bearer: 'invalid' })).status, 401);
  const user = await f.token(); f.sessions.get(user.sid).revokedAt = new Date(); assert.equal((await f.request(user)).status, 401);
  const expired = await f.token(); f.sessions.get(expired.sid).expiresAt = new Date(0); assert.equal((await f.request(expired)).status, 401);
  const inactive = await f.token(); f.users.get(inactive.userId).status = 'PENDING'; assert.equal((await f.request(inactive)).status, 401);
  const deleted = await f.token(); f.users.get(deleted.userId).deletedAt = new Date(); assert.equal((await f.request(deleted)).status, 401);
  assert.equal(f.queries.length, 0); assert.equal(f.counters.size, 0); assert.equal(f.effects.appointments.length, 0);
});
test('HTTP body identity is rejected, cannot select another counter, and invalid attempts consume quota', async t => {
  const f = await fixture(t), user = await f.token();
  for (let i = 0; i < 10; i++) assert.equal((await f.request(user, { body: { agendaSlotId: randomUUID(), userId: randomUUID() } })).status, 400);
  assert.equal(f.counters.size, 1); assert.equal((await f.request(user)).status, 429); assert.equal(f.effects.appointments.length, 0);
});
test('HTTP exhausted booking quota does not throttle listing, cancellation or calendar export', async t => {
  const f = await fixture(t), user = await f.token();
  for (let i = 0; i < 10; i++) await f.request(user);
  assert.equal((await f.request(user)).status, 429); const before = f.queries.length;
  assert.equal((await f.request(user, { path: '/me', method: 'GET' })).status, 200);
  assert.equal((await f.request(user, { path: `/${randomUUID()}/cancel`, body: {} })).status, 200);
  assert.equal((await f.request(user, { path: `/${randomUUID()}/google-calendar`, body: { code: 'controlled-code' } })).status, 200);
  assert.equal(f.queries.length, before);
});
test('HTTP storage failure is sanitized 503/500 and never triggers a reservation', async t => {
  t.mock.method(Logger.prototype, 'error', () => {});
  const f = await fixture(t), user = await f.token();
  for (const [error, expected] of [
    [new Prisma.PrismaClientKnownRequestError('private-sql-token', { code: 'P2010', clientVersion: '7.10.0' }), 503],
    [new Error('private-sql-token'), 500],
  ]) {
    f.failStorage(error); const response = await f.request(user);
    assert.equal(response.status, expected); assert.equal(response.body.message, 'Booking unavailable');
    assert.equal(response.headers.get('retry-after'), null); assert.doesNotMatch(JSON.stringify(response.body), /private-sql-token/);
  }
  assert.equal(f.effects.appointments.length, 0);
});
