import 'reflect-metadata';
import assert from 'node:assert/strict';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Prisma } from '../dist/generated/prisma/client.js';
import { BookingRateLimitService } from '../dist/appointments/booking-rate-limit.service.js';
import { BookingRateLimitGuard } from '../dist/appointments/booking-rate-limit.guard.js';
import { bookingRateLimitPolicy } from '../dist/appointments/booking-rate-limit.policy.js';
import { AppointmentsController } from '../dist/appointments/appointments.controller.js';
import { AccessTokenGuard } from '../dist/auth/guards/access-token.guard.js';
import { AuthRateLimitService } from '../dist/auth/auth-rate-limit.service.js';
import { AccountRecoveryCrypto } from '../dist/auth/account-recovery.crypto.js';

const secret = randomBytes(32).toString('hex');
const config = new ConfigService({ JWT_ACCESS_SECRET: secret, ACCOUNT_RECOVERY_HMAC_KEY: secret });
const allowed = { allowed: true, retryAfterSeconds: 60 };

test('booking operational policy is exactly ten requests per sixty seconds', () => {
  assert.deepEqual(bookingRateLimitPolicy, { requests: 10, windowSeconds: 60 });
});
test('class authentication precedes the creation-only method guard; other appointment routes stay unchanged', () => {
  assert.deepEqual(Reflect.getMetadata(GUARDS_METADATA, AppointmentsController), [AccessTokenGuard]);
  assert.deepEqual(Reflect.getMetadata(GUARDS_METADATA, AppointmentsController.prototype.reserve), [BookingRateLimitGuard]);
  for (const method of ['findMine', 'cancel', 'exportCalendar', 'confirmAttendance']) {
    assert.ok(!(Reflect.getMetadata(GUARDS_METADATA, AppointmentsController.prototype[method]) ?? []).includes(BookingRateLimitGuard));
  }
});
test('storage receives only parameterized domain-separated HMAC, stable across instances and UUID casing', async () => {
  const queries = [], userId = randomUUID();
  const db = { $queryRaw: async query => { queries.push(query); return [allowed]; } };
  const limiter = new BookingRateLimitService(db, config);
  for (const user of [userId, userId.toUpperCase(), randomUUID()]) assert.deepEqual(await limiter.consume(user), allowed);
  await new BookingRateLimitService(db, config).consume(userId);
  assert.equal(queries[0].values[0], queries[1].values[0]); assert.equal(queries[0].values[0], queries[3].values[0]);
  assert.notEqual(queries[0].values[0], queries[2].values[0]);
  const key = createHmac('sha256', secret).update('citajusta/booking-rate-limit/key/v1').digest();
  const expected = createHmac('sha256', key).update(JSON.stringify(['citajusta/booking-rate-limit/v1', 'create', userId])).digest('hex');
  assert.equal(queries[0].values[0], expected);
  for (const query of queries) {
    assert.match(query.values[0], /^[a-f0-9]{64}$/);
    assert.deepEqual(query.values.slice(1), [60, 11, 60, 10, 10]);
    assert.ok(!query.text.includes(query.values[0])); assert.ok(!JSON.stringify(query).includes(userId));
    assert.ok(!JSON.stringify(query).includes(secret));
  }
});
test('booking, authentication and recovery counter domains cannot share identifiers', async () => {
  const keys = [], db = { $queryRaw: async query => { keys.push(query.values[0]); return [allowed]; } };
  await new BookingRateLimitService(db, config).consume(randomUUID());
  await new AuthRateLimitService(db, config).consume('login', '192.0.2.50');
  await new AuthRateLimitService(db, config).consume('register', '192.0.2.50');
  keys.push(new AccountRecoveryCrypto(config).emailHmac('booking-fixture@example.test'));
  assert.equal(new Set(keys).size, 4);
});
test('guard fails closed without principal and never consumes an anonymous quota', async () => {
  let calls = 0;
  const guard = new BookingRateLimitGuard({ consume: async () => { calls++; return allowed; } });
  await assert.rejects(guard.canActivate({ switchToHttp: () => ({ getRequest: () => ({}) }) }), error => error.getStatus() === 401);
  assert.equal(calls, 0);
});
test('guard sends only principal userId to limiter, ignoring client identity/session/context', async () => {
  const userId = randomUUID(), calls = [];
  const guard = new BookingRateLimitGuard({ consume: async id => { calls.push(id); return allowed; } });
  const request = { principal: { userId, sessionId: randomUUID() }, body: { userId: randomUUID() }, query: { userId: randomUUID() } };
  assert.equal(await guard.canActivate({ switchToHttp: () => ({ getRequest: () => request }) }), true);
  assert.deepEqual(calls, [userId]);
});
test('unexpected storage errors and logs are sanitized; no fail-open or false 429', async t => {
  const logs = []; t.mock.method(Logger.prototype, 'error', (...args) => logs.push(args));
  const privateError = new Error('private-sql-password-token');
  const limiter = new BookingRateLimitService({ $queryRaw: async () => { throw privateError; } }, config);
  await assert.rejects(limiter.consume(randomUUID()), error => error.getStatus() === 500 && error.message === 'Booking unavailable');
  assert.deepEqual(logs, [['Booking rate limit storage unavailable']]);
});
test('recognized Prisma storage outage returns sanitized 503', async t => {
  t.mock.method(Logger.prototype, 'error', () => {});
  const error = new Prisma.PrismaClientKnownRequestError('private-sql-password-token', { code: 'P2010', clientVersion: '7.10.0' });
  const limiter = new BookingRateLimitService({ $queryRaw: async () => { throw error; } }, config);
  await assert.rejects(limiter.consume(randomUUID()), failure => failure.getStatus() === 503 && failure.message === 'Booking unavailable');
});
test('malformed storage results return sanitized 500 instead of allowing reservations', async t => {
  t.mock.method(Logger.prototype, 'error', () => {});
  for (const rows of [[], [allowed, allowed], [{ allowed: 'false', retryAfterSeconds: 1 }], [{ allowed: false, retryAfterSeconds: 0 }], [{ allowed: false, retryAfterSeconds: 1.5 }]]) {
    const limiter = new BookingRateLimitService({ $queryRaw: async () => rows }, config);
    await assert.rejects(limiter.consume(randomUUID()), error => error.getStatus() === 500 && error.message === 'Booking unavailable');
  }
});
