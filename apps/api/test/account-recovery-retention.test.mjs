import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mock, test } from 'node:test';
import { ConfigService } from '@nestjs/config';
import { AccountRecoveryDeliveryService } from '../dist/auth/account-recovery-delivery.service.js';
import { EmailDeliveryService } from '../dist/notifications/email-delivery.service.js';
import { EmailDeliveryRunner } from '../dist/notifications/email-delivery.runner.js';

function fixture(recoveryEnabled, emailEnabled) {
  const now = Date.now();
  const config = new ConfigService({ ACCOUNT_RECOVERY_ENABLED: recoveryEnabled, EMAIL_DELIVERY_ENABLED: emailEnabled,
    EMAIL_DELIVERY_BATCH_SIZE: 2, EMAIL_DELIVERY_INTERVAL_MS: 1000, ACCOUNT_RECOVERY_MIN_INTERVAL_SECONDS: 60 });
  // Deliberately no encryption key, HMAC key or provider credentials.
  const rows = Array.from({ length: 5 }, (_, index) => ({ id: randomUUID(), userId: randomUUID(), tokenHash: 'a'.repeat(64),
    createdAt: new Date(now - 100000), expiresAt: new Date(now + (index === 3 ? 100000 : -1000)),
    consumedAt: index === 4 ? new Date(now - 2000) : null, invalidatedAt: null, attemptCount: 1,
    deliveryStatus: index === 4 ? 'SENT' : 'PROCESSING', providerMessageId: index === 4 ? randomUUID() : null,
    ciphertext: index === 4 ? null : Buffer.from('encrypted fixture'), keyId: index === 4 ? null : 'retired-key',
    nonce: index === 4 ? null : Buffer.alloc(12), authTag: index === 4 ? null : Buffer.alloc(16),
    claimToken: randomUUID(), lockedUntil: new Date(now + 10000) }));
  const limits = [
    { emailHmac: 'expired-1', expiresAt: new Date(now - 1000), lastAcceptedAt: new Date(now - 100000) },
    { emailHmac: 'cooldown', expiresAt: new Date(now - 1000), lastAcceptedAt: new Date(now - 1000) },
    { emailHmac: 'future', expiresAt: new Date(now + 100000), lastAcceptedAt: new Date(now - 100000) },
    { emailHmac: 'expired-2', expiresAt: new Date(now - 1000), lastAcceptedAt: new Date(now - 100000) },
  ];
  const expiredLimit = (row, where) => row.expiresAt < where.expiresAt.lt && row.lastAcceptedAt < where.lastAcceptedAt.lt;
  const db = {
    accountRecovery: {
      findMany: mock.fn(async ({ where, take, select }) => {
        assert.deepEqual(select, { id: true }); assert.equal(take, 2);
        assert.ok(where.expiresAt.lte); assert.deepEqual(where.ciphertext, { not: null });
        return rows.filter(row => row.expiresAt <= where.expiresAt.lte && row.ciphertext !== null).slice(0, take).map(row => ({ id: row.id }));
      }),
      updateMany: mock.fn(async ({ where, data }) => {
        let count = 0;
        assert.deepEqual(where.ciphertext, { not: null });
        for (const row of rows) if (where.id.in.includes(row.id) && row.expiresAt <= where.expiresAt.lte && row.ciphertext !== null) { Object.assign(row, data); count++; }
        return { count };
      }),
    },
    accountRecoveryLimit: {
      findMany: mock.fn(async ({ where, take, select }) => {
        assert.deepEqual(select, { emailHmac: true }); assert.equal(take, 2);
        return limits.filter(row => expiredLimit(row, where)).slice(0, take).map(row => ({ emailHmac: row.emailHmac }));
      }),
      deleteMany: mock.fn(async ({ where }) => {
        let count = 0;
        for (let i = limits.length - 1; i >= 0; i--) if (where.emailHmac.in.includes(limits[i].emailHmac) && expiredLimit(limits[i], where)) { limits.splice(i, 1); count++; }
        return { count };
      }),
    },
  };
  const crypto = { decrypt: mock.fn(() => assert.fail('Retention must never decrypt')) };
  const resend = { send: mock.fn(async () => assert.fail('Sending must remain disabled')) };
  const service = new AccountRecoveryDeliveryService(db, config, crypto, resend);
  return { now, config, rows, limits, db, crypto, resend, service };
}

for (const [recoveryEnabled, emailEnabled] of [[true, false], [false, true], [false, false]]) {
  test(`bounded retention cleans expired material with recovery=${recoveryEnabled}, email=${emailEnabled}, without sending`, async () => {
    const f = fixture(recoveryEnabled, emailEnabled);
    const trace = row => ({ id: row.id, userId: row.userId, tokenHash: row.tokenHash, createdAt: row.createdAt, expiresAt: row.expiresAt,
      consumedAt: row.consumedAt, invalidatedAt: row.invalidatedAt, providerMessageId: row.providerMessageId, attemptCount: row.attemptCount });
    const before = f.rows.map(trace);
    await f.service.cleanupExpiredBatch();
    for (const row of f.rows.slice(0, 2)) {
      for (const key of ['ciphertext', 'keyId', 'nonce', 'authTag', 'claimToken', 'lockedUntil']) assert.equal(row[key], null);
      assert.equal(row.lastErrorCode, 'EMAIL_RECOVERY_EXPIRED');
    }
    assert.ok(f.rows[2].ciphertext); assert.ok(f.rows[3].ciphertext); assert.equal(f.rows.length, 5);
    assert.deepEqual(f.rows.map(trace), before);
    assert.deepEqual(f.limits.map(row => row.emailHmac), ['cooldown', 'future']);
    assert.equal(f.db.accountRecovery.findMany.mock.callCount(), 1); assert.equal(f.db.accountRecoveryLimit.findMany.mock.callCount(), 1);
    const reads = f.db.accountRecovery.findMany.mock.callCount();
    await f.service.processBatch(); await f.service.deliver(f.rows[3].id);
    assert.equal(f.db.accountRecovery.findMany.mock.callCount(), reads); assert.equal(f.resend.send.mock.callCount(), 0); assert.equal(f.crypto.decrypt.mock.callCount(), 0);
    await f.service.cleanupExpiredBatch();
    assert.equal(f.rows[2].ciphertext, null); assert.ok(f.rows[3].ciphertext);
    assert.equal(f.limits.length, 2); assert.deepEqual(f.rows.map(trace), before);
  });
}

test('cleanup rechecks expired limits before deletion, preserving a concurrently renewed window', async () => {
  const f = fixture(false, false), remove = f.db.accountRecoveryLimit.deleteMany;
  f.db.accountRecoveryLimit.deleteMany = async args => {
    f.limits[0].expiresAt = new Date(Date.now() + 100000);
    f.limits[0].lastAcceptedAt = new Date();
    return remove(args);
  };
  await f.service.cleanupExpiredBatch();
  assert.deepEqual(f.limits.map(row => row.emailHmac), ['expired-1', 'cooldown', 'future']);
});

test('repeated cleanup of an empty batch performs no writes', async () => {
  const f = fixture(false, false);
  for (const row of f.rows) row.ciphertext = null;
  for (const row of f.limits) row.expiresAt = new Date(Date.now() + 100000);
  await f.service.cleanupExpiredBatch(); await f.service.cleanupExpiredBatch();
  assert.equal(f.db.accountRecovery.updateMany.mock.callCount(), 0); assert.equal(f.db.accountRecoveryLimit.deleteMany.mock.callCount(), 0);
});

test('cleanup does not overwrite a delivery already completed by another worker', async () => {
  const f = fixture(false, false), update = f.db.accountRecovery.updateMany;
  const providerMessageId = randomUUID();
  f.db.accountRecovery.updateMany = async args => {
    Object.assign(f.rows[0], { ciphertext: null, keyId: null, nonce: null, authTag: null, claimToken: null, lockedUntil: null, deliveryStatus: 'SENT', providerMessageId });
    return update(args);
  };
  await f.service.cleanupExpiredBatch();
  assert.equal(f.rows[0].deliveryStatus, 'SENT'); assert.equal(f.rows[0].providerMessageId, providerMessageId);
  assert.equal(f.rows[0].lastErrorCode, undefined);
});

test('normal enabled delivery batch keeps due/lease filters and stable order, separate from retention', async t => {
  const config = new ConfigService({ ACCOUNT_RECOVERY_ENABLED: true, EMAIL_DELIVERY_ENABLED: true, EMAIL_DELIVERY_BATCH_SIZE: 2 });
  const rows = [{ id: randomUUID() }, { id: randomUUID() }];
  const findMany = mock.fn(async () => rows);
  const service = new AccountRecoveryDeliveryService({ accountRecovery: { findMany } }, config, {}, {});
  const deliver = t.mock.method(service, 'deliver', async () => {});
  await service.processBatch();
  const query = findMany.mock.calls[0].arguments[0];
  assert.equal(query.take, 2); assert.deepEqual(query.orderBy, [{ nextAttemptAt: 'asc' }, { id: 'asc' }]);
  assert.deepEqual(query.select, { id: true }); assert.equal(query.where.consumedAt, null); assert.equal(query.where.invalidatedAt, null);
  assert.ok(query.where.expiresAt.gt instanceof Date);
  assert.equal(query.where.OR[0].deliveryStatus, 'PENDING'); assert.ok(query.where.OR[0].nextAttemptAt.lte instanceof Date);
  assert.equal(query.where.OR[1].deliveryStatus, 'PROCESSING'); assert.ok(query.where.OR[1].lockedUntil.lte instanceof Date);
  assert.deepEqual(deliver.mock.calls.map(call => call.arguments[0]), rows.map(row => row.id));
});

const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };

test('existing runner schedules bounded retention even with both flags disabled, with one timer and no HTTP', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture(false, false);
  const cleanup = t.mock.method(f.service, 'cleanupExpiredBatch');
  const email = new EmailDeliveryService({}, f.config, f.resend);
  const runner = new EmailDeliveryRunner(email, f.config, f.service);
  try {
    runner.onApplicationBootstrap(); runner.onApplicationBootstrap(); await flush();
    assert.equal(cleanup.mock.callCount(), 1);
    runner.onApplicationBootstrap(); await flush(); // An existing scheduled timer must not be duplicated.
    assert.equal(cleanup.mock.callCount(), 1);
    t.mock.timers.tick(1000); await flush(); assert.equal(cleanup.mock.callCount(), 2);
    t.mock.timers.tick(1000); await flush(); assert.equal(cleanup.mock.callCount(), 3);
    assert.equal(f.resend.send.mock.callCount(), 0); assert.equal(f.crypto.decrypt.mock.callCount(), 0);
  } finally { await runner.onModuleDestroy(); }
  t.mock.timers.tick(10000); await flush(); assert.equal(cleanup.mock.callCount(), 3);
});

test('shutdown waits for retention in progress and repeated startup cannot overlap it', async () => {
  let release, cleanupCalls = 0, deliveryCalls = 0;
  const config = new ConfigService({ EMAIL_DELIVERY_ENABLED: false, EMAIL_DELIVERY_INTERVAL_MS: 1000 });
  const recovery = { cleanupExpiredBatch: () => { cleanupCalls++; return new Promise(resolve => { release = resolve; }); },
    processBatch: async () => { deliveryCalls++; } };
  const runner = new EmailDeliveryRunner({ processBatch: async () => {} }, config, recovery);
  runner.onApplicationBootstrap(); runner.onApplicationBootstrap(); assert.equal(cleanupCalls, 1);
  let stopped = false; const closing = runner.onModuleDestroy().then(() => { stopped = true; });
  await flush(); assert.equal(stopped, false); release(); await closing;
  assert.equal(stopped, true); assert.equal(cleanupCalls, 1); assert.equal(deliveryCalls, 1);
});

test('retention failure is drained and retried on the next single scheduled cycle without provider calls', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture(false, false), cleanup = t.mock.method(f.service, 'cleanupExpiredBatch');
  cleanup.mock.mockImplementationOnce(async () => { throw new Error('controlled fixture storage failure'); });
  const runner = new EmailDeliveryRunner(new EmailDeliveryService({}, f.config, f.resend), f.config, f.service);
  try {
    runner.onApplicationBootstrap(); await flush(); assert.equal(cleanup.mock.callCount(), 1);
    t.mock.timers.tick(1000); await flush(); assert.equal(cleanup.mock.callCount(), 2);
    assert.equal(f.rows[0].ciphertext, null); assert.equal(f.resend.send.mock.callCount(), 0);
  } finally { await runner.onModuleDestroy(); }
});
