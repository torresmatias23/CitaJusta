import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { test } from 'node:test';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../dist/database/prisma.service.js';
import { AuthRateLimitService } from '../../dist/auth/auth-rate-limit.service.js';
import { authRateLimitPolicies } from '../../dist/auth/auth-rate-limit.policy.js';
import { AccountRecoveryCrypto } from '../../dist/auth/account-recovery.crypto.js';
import { assertE2EFixtureDatabase } from '../../scripts/e2e-docker-environment.mjs';
import { loadApiEnvironment } from './local-environment.mjs';

// No .env loading, migrations, schema creation, or automatic database setup.
// Only the existing Docker runner can verify the target before the first write.
const options = { skip: process.env.CITAJUSTA_E2E !== 'docker' ? 'Isolated PostgreSQL E2E environment not configured' : false, timeout: 30_000 };
async function fixture(t) {
  loadApiEnvironment();
  const config = new ConfigService({ DATABASE_URL: process.env.DATABASE_URL,
    JWT_ACCESS_SECRET: randomBytes(32).toString('hex'), ACCOUNT_RECOVERY_HMAC_KEY: randomBytes(32).toString('hex') });
  const clients = [new PrismaService(config), new PrismaService(config)];
  const keys = new Set();
  let verified = false;
  t.after(async () => {
    try {
      if (verified && keys.size) {
        await assertE2EFixtureDatabase(clients[0]);
        await clients[0].accountRecoveryLimit.deleteMany({ where: { emailHmac: { in: [...keys] } } });
      }
    } finally { await Promise.all(clients.map(client => client.$disconnect())); }
  });
  for (const client of clients) await assertE2EFixtureDatabase(client);
  verified = true;
  const limiters = clients.map(client => new AuthRateLimitService({ $queryRaw: query => {
    keys.add(query.values[0]);
    return client.$queryRaw(query);
  } }, config));
  return { db: clients[0], limiters, keys, config };
}

test('PostgreSQL: every policy admits its exact quota and rejects subsequent attempts', options, async t => {
  const { limiters: [limiter] } = await fixture(t);
  for (const [operation, policy] of Object.entries(authRateLimitPolicies)) {
    for (let i = 0; i < policy.requests; i++) assert.equal((await limiter.consume(operation, '192.0.2.10')).allowed, true);
    for (let i = 0; i < 2; i++) {
      const decision = await limiter.consume(operation, '192.0.2.10');
      assert.equal(decision.allowed, false);
      assert.ok(decision.retryAfterSeconds >= 1 && decision.retryAfterSeconds <= policy.windowSeconds);
    }
  }
});

test('PostgreSQL: two independent clients share one atomic quota under concurrent requests', options, async t => {
  const { limiters, db, keys } = await fixture(t);
  const decisions = await Promise.all(Array.from({ length: 40 }, (_, i) => limiters[i % 2].consume('login', '192.0.2.11')));
  assert.equal(decisions.filter(decision => decision.allowed).length, 20);
  assert.equal(decisions.filter(decision => !decision.allowed).length, 20);
  assert.equal(keys.size, 1);
  const row = await db.accountRecoveryLimit.findUniqueOrThrow({ where: { emailHmac: [...keys][0] } });
  assert.equal(row.requestCount, 21);
});

test('PostgreSQL: rejection preserves expiry and last admission; expired window resets using database time', options, async t => {
  const { limiters: [limiter], db, keys } = await fixture(t);
  for (let i = 0; i < 5; i++) await limiter.consume('register', '192.0.2.12');
  const emailHmac = [...keys][0];
  const before = await db.accountRecoveryLimit.findUniqueOrThrow({ where: { emailHmac } });
  assert.equal((await limiter.consume('register', '192.0.2.12')).allowed, false);
  const after = await db.accountRecoveryLimit.findUniqueOrThrow({ where: { emailHmac } });
  assert.deepEqual(after.expiresAt, before.expiresAt);
  assert.deepEqual(after.lastAcceptedAt, before.lastAcceptedAt);
  await db.$executeRaw`
    UPDATE "limites_recuperacion_cuenta"
    SET "ventana_inicio_at" = (statement_timestamp() AT TIME ZONE 'UTC') - interval '901 seconds',
        "expira_at" = (statement_timestamp() AT TIME ZONE 'UTC') - interval '1 second'
    WHERE "email_hmac" = ${emailHmac}
  `;
  const decision = await limiter.consume('register', '192.0.2.12');
  assert.equal(decision.allowed, true);
  assert.ok(decision.retryAfterSeconds >= 899 && decision.retryAfterSeconds <= 900);
  assert.equal((await db.accountRecoveryLimit.findUniqueOrThrow({ where: { emailHmac } })).requestCount, 1);
});

test('PostgreSQL: operation/network isolation, IPv6 /64 quota, and existing email recovery counters coexist', options, async t => {
  const { limiters: [limiter], db, keys, config } = await fixture(t);
  const emailHmac = new AccountRecoveryCrypto(config).emailHmac('rate-limit-fixture@example.test');
  keys.add(emailHmac);
  const existing = await db.accountRecoveryLimit.create({ data: { emailHmac, requestCount: 2,
    windowStartedAt: new Date(), lastAcceptedAt: new Date(), expiresAt: new Date(Date.now() + 3600_000) } });
  for (let i = 0; i < 5; i++) await limiter.consume('register', `2001:db8:1:2::${i + 1}`);
  assert.equal((await limiter.consume('register', '2001:db8:1:2::ffff')).allowed, false);
  assert.equal((await limiter.consume('login', '2001:db8:1:2::ffff')).allowed, true);
  assert.equal((await limiter.consume('register', '2001:db8:1:3::1')).allowed, true);
  assert.equal((await limiter.consume('register', '192.0.2.13')).allowed, true);
  assert.deepEqual(await db.accountRecoveryLimit.findUniqueOrThrow({ where: { emailHmac } }), existing);
});
