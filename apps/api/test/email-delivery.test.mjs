import 'reflect-metadata';
import assert from 'node:assert/strict';
import { Prisma } from '../dist/generated/prisma/client.js';
import { randomUUID } from 'node:crypto';
import { mock, test } from 'node:test';
import { validateEnvironment } from '../dist/config/environment.validation.js';
import { ResendClient, EmailProviderError, emailPayloadSchema } from '../dist/notifications/resend.client.js';
import { EmailDeliveryService } from '../dist/notifications/email-delivery.service.js';
import { EmailDeliveryRunner } from '../dist/notifications/email-delivery.runner.js';
import { notificationContent } from '../dist/notifications/notification-content.js';
import { renderEmailContent } from '../dist/notifications/email-content.js';

const base = { DATABASE_URL: 'postgresql://test:test@localhost/citajusta_test',
  JWT_ACCESS_SECRET: 'access-test-only-'.repeat(4), JWT_REFRESH_SECRET: 'refresh-test-only-'.repeat(4) };
const settings = validateEnvironment({ ...base, EMAIL_DELIVERY_ENABLED: 'true',
  RESEND_API_KEY: 're_test_only_not_a_real_api_key', RESEND_FROM: 'CitaJusta <sender@example.test>' });
const config = (overrides = {}) => ({ get: (key) => ({ ...settings, ...overrides })[key],
  getOrThrow: (key) => { const value = ({ ...settings, ...overrides })[key]; assert.notEqual(value, undefined); return value; } });
const payload = { from: settings.RESEND_FROM, to: ['recipient@example.test'], subject: 'Reserva registrada', text: 'Mensaje controlado.' };

test('email defaults disabled in every environment without requiring secrets', () => {
  for (const NODE_ENV of ['development', 'test', 'production']) {
    const result = validateEnvironment({ ...base, NODE_ENV });
    assert.equal(result.EMAIL_DELIVERY_ENABLED, false);
    assert.equal(result.EMAIL_DELIVERY_MAX_ATTEMPTS, 5);
    assert.equal(result.RESEND_API_KEY, undefined);
  }
});
test('enabled email requires valid key/sender without echoing values', () => {
  for (const extra of [{}, { RESEND_API_KEY: 'secret-do-not-echo' },
    { RESEND_API_KEY: settings.RESEND_API_KEY, RESEND_FROM: 'bad-secret-sender' },
    { RESEND_API_KEY: settings.RESEND_API_KEY, RESEND_FROM: 'name\r\nBcc: hidden@example.com' }]) {
    assert.throws(() => validateEnvironment({ ...base, EMAIL_DELIVERY_ENABLED: 'true', ...extra }), (error) => {
      assert.match(error.message, /RESEND_/);
      assert.doesNotMatch(error.message, /secret-do-not-echo|bad-secret-sender|hidden@example|re_test/);
      return true;
    });
  }
  assert.equal(settings.EMAIL_DELIVERY_ENABLED, true);
});
test('email booleans, timer/batch/attempt/timeout and lease bounds are strict', () => {
  for (const value of ['TRUE', '1', true, '']) assert.throws(() => validateEnvironment({ ...base, EMAIL_DELIVERY_ENABLED: value }));
  for (const [key, values] of Object.entries({ EMAIL_DELIVERY_INTERVAL_MS: [0, 999, 300001],
    EMAIL_DELIVERY_BATCH_SIZE: [0, 101, 1.5], EMAIL_DELIVERY_MAX_ATTEMPTS: [0, 11],
    EMAIL_DELIVERY_REQUEST_TIMEOUT_MS: [0, 30001], EMAIL_DELIVERY_LEASE_MS: [0, 300001] })) {
    for (const value of values) assert.throws(() => validateEnvironment({ ...base, [key]: value }), new RegExp(key));
  }
  assert.throws(() => validateEnvironment({ ...base, EMAIL_DELIVERY_REQUEST_TIMEOUT_MS: 10000, EMAIL_DELIVERY_LEASE_MS: 10000 }), /EMAIL_DELIVERY_LEASE_MS/);
});

test('Resend uses exact fixed endpoint, controlled POST, stable no-PII key and parses provider ID', async (t) => {
  const id = randomUUID(), providerId = randomUUID(), calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => { calls.push([url, options]); return Response.json({ id: providerId }); });
  const client = new ResendClient();
  for (let i = 0; i < 2; i++) assert.equal(await client.send(id, payload, settings.RESEND_API_KEY, 100), providerId);
  for (const [url, options] of calls) {
    assert.equal(url, 'https://api.resend.com/emails'); assert.equal(options.method, 'POST'); assert.equal(options.redirect, 'error');
    assert.equal(options.headers.Authorization, `Bearer ${settings.RESEND_API_KEY}`);
    assert.equal(options.headers['Idempotency-Key'], `citajusta-email/${id}`);
    assert.ok(options.headers['Idempotency-Key'].length <= 256);
    assert.equal(options.headers['Content-Type'], 'application/json'); assert.deepEqual(JSON.parse(options.body), payload);
  }
  assert.equal(calls[0][1].body, calls[1][1].body);
});
for (const [status, name, retryable, code] of [
  [408, null, true, 'RESEND_HTTP_408'], [429, null, true, 'RESEND_HTTP_429'],
  [500, null, true, 'RESEND_HTTP_500'], [503, null, true, 'RESEND_HTTP_503'],
  [409, 'concurrent_idempotent_requests', true, 'RESEND_CONCURRENT_IDEMPOTENT_REQUESTS'],
  [409, 'invalid_idempotent_request', false, 'RESEND_INVALID_IDEMPOTENT_REQUEST'],
  [409, 'unknown', false, 'RESEND_HTTP_409'],
  ...[400, 401, 403, 404, 422].map((status) => [status, null, false, `RESEND_HTTP_${status}`]),
]) test(`provider HTTP ${status}/${name ?? 'generic'} is classified without provider payload`, async (t) => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({ name, message: 'SECRET_PROVIDER_BODY', authorization: settings.RESEND_API_KEY }, { status }));
  await assert.rejects(new ResendClient().send(randomUUID(), payload, settings.RESEND_API_KEY, 100), (error) => {
    assert.ok(error instanceof EmailProviderError); assert.equal(error.retryable, retryable); assert.equal(error.code, code);
    assert.doesNotMatch(JSON.stringify(error) + error.message, /SECRET_PROVIDER_BODY|re_test/); return true;
  });
});
test('timeout aborts request and is retryable', async (t) => {
  t.mock.method(globalThis, 'fetch', async (_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(new DOMException('sensitive timeout', 'AbortError')), { once: true });
  }));
  await assert.rejects(new ResendClient().send(randomUUID(), payload, settings.RESEND_API_KEY, 10), (error) => error.code === 'RESEND_TIMEOUT' && error.retryable);
});
test('network allowlist retries native fetch errors, not arbitrary TypeError/storage/programming failures', async (t) => {
  const network = new TypeError('fetch failed', { cause: Object.assign(new Error('private'), { code: 'ECONNRESET' }) });
  const fn = t.mock.method(globalThis, 'fetch', async () => { throw network; });
  await assert.rejects(new ResendClient().send(randomUUID(), payload, settings.RESEND_API_KEY, 100), (error) => error.code === 'RESEND_NETWORK_ERROR' && error.retryable);
  fn.mock.mockImplementation(async () => new Response(new ReadableStream({
    start(controller) { controller.error(new TypeError('terminated', { cause: { code: 'UND_ERR_SOCKET' } })); },
  })));
  await assert.rejects(new ResendClient().send(randomUUID(), payload, settings.RESEND_API_KEY, 100), (error) => error.code === 'RESEND_NETWORK_ERROR' && error.retryable);
  for (const error of [new TypeError('programming error'), Object.assign(new Error('SQL failure'), { code: 'P2002' }),
    new TypeError('fetch failed', { cause: { code: '23505' } })]) {
    fn.mock.mockImplementation(async () => { throw error; });
    await assert.rejects(new ResendClient().send(randomUUID(), payload, settings.RESEND_API_KEY, 100), (value) => value === error);
  }
});
test('invalid local configuration is permanent before HTTP', async (t) => {
  const fetch = t.mock.method(globalThis, 'fetch', async () => assert.fail('No HTTP expected'));
  await assert.rejects(new ResendClient().send(randomUUID(), payload, 'invalid-key', 100), (error) => error.code === 'EMAIL_CONFIGURATION_INVALID' && !error.retryable);
  assert.equal(fetch.mock.callCount(), 0);
});
test('malformed success is bounded retry, not provider body persistence', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({ id: 'invalid', token: 'private' }));
  await assert.rejects(new ResendClient().send(randomUUID(), payload, settings.RESEND_API_KEY, 100), (error) => error.code === 'RESEND_INVALID_RESPONSE' && error.retryable);
});

function fixture(overrides = {}, configOverrides = {}, send = async () => randomUUID()) {
  const row = { id: randomUUID(), notificationId: randomUUID(), status: 'PENDING', attemptCount: 0,
    nextAttemptAt: new Date(0), lockedUntil: null, claimToken: null, firstAttemptAt: null, payload: null,
    notification: { id: randomUUID(), type: 'APPOINTMENT_BOOKED', institutionId: randomUUID(),
      data: { startsAt: '2030-01-01T12:00:00.000Z' }, recipient: { email: payload.to[0], status: 'ACTIVE', deletedAt: null, appointmentEmailsEnabled: true, offerEmailsEnabled: true } }, ...overrides };
  const writes = [], finds = [];
  const eligible = (condition) => (!condition.status || condition.status === row.status) &&
    (!condition.nextAttemptAt || row.nextAttemptAt <= condition.nextAttemptAt.lte) &&
    (!condition.lockedUntil || (row.lockedUntil && (condition.lockedUntil.lte ? row.lockedUntil <= condition.lockedUntil.lte : row.lockedUntil > condition.lockedUntil.gt)));
  const prisma = { notificationEmailDelivery: {
    findMany: async (args) => { finds.push(args); return args.where.OR.some(eligible) ? [{ id: row.id }] : []; },
    findUniqueOrThrow: async () => structuredClone(row),
    updateMany: async ({ where, data }) => {
      if (where.id !== row.id || (where.claimToken && where.claimToken !== row.claimToken) ||
        (where.OR ? !where.OR.some(eligible) : !eligible(where))) return { count: 0 };
      if (where.notification?.recipient && Object.entries(where.notification.recipient).some(([key, value]) => row.notification.recipient[key] !== value)) return { count: 0 };
      writes.push(structuredClone(data));
      Object.assign(row, data, { attemptCount: typeof data.attemptCount === 'object' ? row.attemptCount + data.attemptCount.increment : row.attemptCount });
      if (data.payload === Prisma.DbNull) row.payload = null;
      return { count: 1 };
    },
  }, institution: { findUnique: async () => ({ timeZone: 'America/Santiago' }) } };
  const adapter = { send: mock.fn(send) };
  return { row, writes, finds, prisma, adapter, service: new EmailDeliveryService(prisma, config(configOverrides), adapter) };
}
test('batch is bounded, stably ordered and disabled does not query', async () => {
  const f = fixture(); await f.service.processBatch();
  assert.equal(f.finds[0].take, 10); assert.deepEqual(f.finds[0].orderBy, [{ nextAttemptAt: 'asc' }, { id: 'asc' }]);
  const disabled = fixture({}, { EMAIL_DELIVERY_ENABLED: false }); await disabled.service.processBatch(); assert.equal(disabled.finds.length, 0);
});
test('success freezes minimal content in institutional timezone, marks SENT and never resends', async () => {
  const f = fixture(); await f.service.processBatch(); await f.service.processBatch();
  assert.equal(f.row.status, 'SENT'); assert.equal(f.row.attemptCount, 1); assert.equal(f.adapter.send.mock.callCount(), 1);
  const content = { type: f.row.notification.type, data: f.row.notification.data };
  assert.deepEqual(f.row.payload, { from: payload.from, to: payload.to, ...renderEmailContent(content, 'America/Santiago') });
  assert.equal(f.row.payload.text, notificationContent(content, 'America/Santiago').message);
  assert.match(f.row.payload.html, /<h1[^>]*>Tu reserva está registrada<\/h1>/);
  assert.equal(f.row.payload.attachments[0].content_id, 'citajusta-logo');
  assert.ok(f.row.sentAt); assert.ok(f.row.providerMessageId); assert.equal(f.row.claimToken, null); assert.equal(f.row.lockedUntil, null);
});
test('two services use atomic DB claims and only one sends', async () => {
  const f = fixture(), second = new EmailDeliveryService(f.prisma, config(), f.adapter);
  await Promise.all([f.service.processBatch(), second.processBatch()]);
  assert.equal(f.adapter.send.mock.callCount(), 1); assert.equal(f.row.attemptCount, 1); assert.equal(f.row.status, 'SENT');
});

test('disabled category after claim retires payload/lease without HTTP; reactivation cannot revive it', async () => {
  for (const [type, key] of [['APPOINTMENT_BOOKED', 'appointmentEmailsEnabled'], ['OFFER_CREATED', 'offerEmailsEnabled']]) {
    const f = fixture(); f.row.notification.type = type; f.row.notification.recipient[key] = false;
    await f.service.processBatch();
    assert.equal(f.row.status, 'FAILED'); assert.equal(f.row.lastErrorCode, 'EMAIL_PREFERENCE_DISABLED');
    assert.equal(f.row.claimToken, null); assert.equal(f.row.lockedUntil, null); assert.equal(f.row.payload, null);
    assert.equal(f.adapter.send.mock.callCount(), 0);
    f.row.notification.recipient[key] = true; await f.service.processBatch();
    assert.equal(f.adapter.send.mock.callCount(), 0); assert.equal(f.row.status, 'FAILED');
  }
});

test('final conditional check observes preference disabled while rendering; ownership loss never sends', async () => {
  for (const revokeClaim of [false, true]) {
    const f = fixture();
    f.prisma.institution.findUnique = async () => {
      f.row.notification.recipient.appointmentEmailsEnabled = false;
      if (revokeClaim) { f.row.status = 'FAILED'; f.row.claimToken = null; f.row.lockedUntil = null; }
      return { timeZone: 'America/Santiago' };
    };
    await f.service.processBatch();
    assert.equal(f.adapter.send.mock.callCount(), 0); assert.equal(f.row.status, 'FAILED');
    assert.equal(f.row.payload, null); assert.equal(f.row.claimToken, null);
  }
});
test('expired lease recovers, future lease is not claimed, stale ownership cannot complete', async () => {
  const expired = fixture({ status: 'PROCESSING', lockedUntil: new Date(0), claimToken: randomUUID(), attemptCount: 1 });
  await expired.service.processBatch(); assert.equal(expired.row.status, 'SENT'); assert.equal(expired.row.attemptCount, 2);
  const current = fixture({ status: 'PROCESSING', lockedUntil: new Date(Date.now() + 60000) });
  await current.service.processBatch(); assert.equal(current.adapter.send.mock.callCount(), 0);
  let f; f = fixture({}, {}, async () => { f.row.claimToken = randomUUID(); return randomUUID(); });
  await f.service.processBatch(); assert.equal(f.row.status, 'PROCESSING'); assert.equal(f.row.sentAt, undefined);
});
test('retryable failure persists deterministic backoff and frozen payload across configuration changes', async () => {
  const f = fixture({}, {}, async () => { throw new EmailProviderError('RESEND_HTTP_429', true); });
  const before = Date.now(); await f.service.processBatch();
  assert.equal(f.row.status, 'PENDING'); assert.equal(f.row.lastErrorCode, 'RESEND_HTTP_429');
  assert.ok(+f.row.nextAttemptAt >= before + 30000); assert.equal(f.row.lockedUntil, null);
  const frozen = structuredClone(f.row.payload); f.row.nextAttemptAt = new Date(0);
  assert.ok(frozen.html && frozen.text);
  f.row.notification.data = { startsAt: '2040-02-01T15:00:00.000Z' };
  f.prisma.institution.findUnique = async () => assert.fail('Frozen payload must not be rendered again');
  await new EmailDeliveryService(f.prisma, config({ RESEND_FROM: 'different@example.test' }), f.adapter).processBatch();
  assert.deepEqual(f.row.payload, frozen); assert.deepEqual(f.adapter.send.mock.calls[1].arguments[1], frozen);
  assert.deepEqual(f.adapter.send.mock.calls[0].arguments.slice(0, 2), f.adapter.send.mock.calls[1].arguments.slice(0, 2));
});

test('legacy frozen text-only payload retries unchanged and is never upgraded to HTML', async () => {
  const frozen = { ...payload, subject: 'Asunto histórico', text: 'Contenido histórico congelado.' };
  const requests = [];
  const f = fixture({ payload: structuredClone(frozen), firstAttemptAt: new Date() }, {}, async (id, value) => {
    requests.push([id, structuredClone(value)]);
    if (requests.length === 1) throw new EmailProviderError('RESEND_HTTP_429', true);
    return randomUUID();
  });
  f.prisma.institution.findUnique = async () => assert.fail('Must not render frozen content');
  await f.service.processBatch();
  assert.equal(f.row.status, 'PENDING');
  f.row.nextAttemptAt = new Date(0);
  await new EmailDeliveryService(f.prisma, config({ RESEND_FROM: 'different@example.test' }), f.adapter).processBatch();
  await f.service.processBatch();
  assert.equal(f.row.status, 'SENT');
  assert.deepEqual(f.row.payload, frozen);
  assert.deepEqual(requests, [[f.row.notification.id, frozen], [f.row.notification.id, frozen]]);
  assert.equal(Object.hasOwn(f.row.payload, 'html'), false);
});

test('Resend sends HTML and explicit plain text together without changing the idempotency key', async (t) => {
  const id = randomUUID();
  const current = { from: payload.from, to: payload.to, ...renderEmailContent({ type: 'APPOINTMENT_BOOKED', data: { startsAt: '2026-10-16T16:00:00.000Z' } }, 'America/Santiago') };
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (_url, options) => { calls.push(options); return Response.json({ id: randomUUID() }); });
  const client = new ResendClient();
  await client.send(id, current, settings.RESEND_API_KEY, 100);
  await client.send(id, current, settings.RESEND_API_KEY, 100);
  assert.deepEqual(emailPayloadSchema.parse(current), current);
  assert.deepEqual(emailPayloadSchema.parse(payload), payload);
  assert.equal(current.attachments.length, 1);
  assert.equal(current.attachments[0].filename, 'logo-citajusta.png');
  assert.equal(current.attachments[0].content_type, 'image/png');
  assert.equal(current.attachments[0].content_id, 'citajusta-logo');
  assert.equal(Object.hasOwn(current.attachments[0], 'contentId'), false);
  assert.match(current.html, /src="cid:citajusta-logo"/);
  for (const call of calls) {
    assert.deepEqual(JSON.parse(call.body), current);
    assert.equal(call.headers['Idempotency-Key'], `citajusta-email/${id}`);
  }
  assert.equal(calls[0].body, calls[1].body);
  for (const html of ['', 1, null, 'x'.repeat(32_001)]) assert.equal(emailPayloadSchema.safeParse({ ...payload, html }).success, false);
});

test('previous HTML-only frozen payload is never rendered again or given a logo attachment', async () => {
  const frozen = { ...payload, html: '<p>Primera versión HTML congelada.</p>' };
  const f = fixture({ payload: structuredClone(frozen) });
  f.prisma.institution.findUnique = async () => assert.fail('Frozen HTML must bypass rendering and logo loading');
  await f.service.processBatch();
  await f.service.processBatch();
  assert.equal(f.row.status, 'SENT');
  assert.equal(f.adapter.send.mock.callCount(), 1);
  assert.deepEqual(f.row.payload, frozen);
  assert.deepEqual(f.adapter.send.mock.calls[0].arguments[1], frozen);
  assert.equal(Object.hasOwn(f.row.payload, 'attachments'), false);
});
test('permanent and max-attempt failures are terminal, including lease-crash exhaustion', async () => {
  for (const f of [fixture({}, {}, async () => { throw new EmailProviderError('RESEND_HTTP_422', false); }),
    fixture({ attemptCount: 4 }, {}, async () => { throw new EmailProviderError('RESEND_HTTP_500', true); })]) {
    await f.service.processBatch(); await f.service.processBatch(); assert.equal(f.row.status, 'FAILED'); assert.equal(f.adapter.send.mock.callCount(), 1);
  }
  const crashed = fixture({ status: 'PROCESSING', lockedUntil: new Date(0), attemptCount: 5 });
  await crashed.service.processBatch(); assert.equal(crashed.row.status, 'FAILED'); assert.equal(crashed.row.lastErrorCode, 'EMAIL_MAX_ATTEMPTS');
  assert.equal(crashed.adapter.send.mock.callCount(), 0);
});
test('invalid/inactive/deleted recipient is permanent without calling Resend', async () => {
  for (const recipient of [{ email: 'bad', status: 'ACTIVE', deletedAt: null }, { email: payload.to[0], status: 'INACTIVE', deletedAt: null },
    { email: payload.to[0], status: 'ACTIVE', deletedAt: new Date() }]) {
    const f = fixture(); f.row.notification.recipient = recipient; await f.service.processBatch();
    assert.equal(f.row.status, 'FAILED'); assert.equal(f.row.lastErrorCode, 'EMAIL_RECIPIENT_INVALID'); assert.equal(f.adapter.send.mock.callCount(), 0);
  }
});
test('changed recipient and exhausted 24-hour uncertainty are never resent automatically', async () => {
  const changed = fixture({ payload: { ...payload, to: ['previous@example.test'] } });
  const stale = fixture({ firstAttemptAt: new Date(Date.now() - 86400000) });
  for (const f of [changed, stale]) { await f.service.processBatch(); assert.equal(f.row.status, 'FAILED'); assert.equal(f.adapter.send.mock.callCount(), 0); }
  assert.equal(changed.row.lastErrorCode, 'EMAIL_RECIPIENT_CHANGED'); assert.equal(stale.row.lastErrorCode, 'EMAIL_IDEMPOTENCY_WINDOW_EXPIRED');
});
test('programming errors become terminal INTERNAL_ERROR, storage errors propagate without provider classification', async () => {
  const error = new TypeError('secret internal error'), f = fixture({}, {}, async () => { throw error; });
  await assert.rejects(f.service.processBatch(), (value) => value === error);
  assert.equal(f.row.status, 'FAILED'); assert.equal(f.row.lastErrorCode, 'EMAIL_INTERNAL_ERROR');
  const g = fixture(); g.prisma.notificationEmailDelivery.findMany = async () => { throw error; };
  await assert.rejects(g.service.processBatch(), (value) => value === error); assert.equal(g.adapter.send.mock.callCount(), 0);
});
test('runner disabled does nothing; shutdown waits active work with no overlapping cycles', async () => {
  let release; let calls = 0;
  const service = { processBatch: async () => { calls++; await new Promise((resolve) => { release = resolve; }); } };
  const disabled = new EmailDeliveryRunner(service, config({ EMAIL_DELIVERY_ENABLED: false }));
  disabled.onApplicationBootstrap(); assert.equal(calls, 0); await disabled.onModuleDestroy();
  const runner = new EmailDeliveryRunner(service, config()); runner.onApplicationBootstrap(); runner.onApplicationBootstrap();
  assert.equal(calls, 1); let closed = false; const closing = runner.onModuleDestroy().then(() => { closed = true; });
  await Promise.resolve(); assert.equal(closed, false); release(); await closing; assert.equal(closed, true); assert.equal(calls, 1);
});

test('shared runner drains recovery work even if the regular delivery cycle fails first', async () => {
  let release;
  const service = { processBatch: async () => { throw new Error('controlled fixture failure'); } };
  const recovery = { cleanupExpiredBatch: async () => {}, processBatch: () => new Promise(resolve => { release = resolve; }) };
  const runner = new EmailDeliveryRunner(service, config(), recovery); runner.onApplicationBootstrap();
  let closed = false; const pending = runner.onModuleDestroy().then(() => { closed = true; });
  await Promise.resolve(); await Promise.resolve(); assert.equal(closed, false);
  release(); await pending; assert.equal(closed, true);
});
