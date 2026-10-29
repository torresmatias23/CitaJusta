import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { test } from 'node:test';
import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { Prisma } from '../dist/generated/prisma/client.js';
import { AuthRateLimitService, authRateLimitNetwork } from '../dist/auth/auth-rate-limit.service.js';
import { authRateLimitClientAddress } from '../dist/auth/auth-rate-limit.guard.js';
import { authRateLimitPolicies } from '../dist/auth/auth-rate-limit.policy.js';

const secret = randomBytes(32).toString('hex');
const config = new ConfigService({ JWT_ACCESS_SECRET: secret });
const allowed = { allowed: true, retryAfterSeconds: 300 };

test('network identity canonicalizes IPv4 and mapped IPv6 without grouping unrelated IPv4 peers', () => {
  for (const address of ['192.0.2.10', '::ffff:192.0.2.10', '0:0:0:0:0:FFFF:c000:020a']) {
    assert.equal(authRateLimitNetwork(address), '192.0.2.10');
  }
  assert.notEqual(authRateLimitNetwork('192.0.2.10'), authRateLimitNetwork('192.0.2.11'));
});

test('IPv6 privacy-address rotation within /64 does not change the network identity', () => {
  assert.equal(authRateLimitNetwork('2001:db8:1:2::1'), authRateLimitNetwork('2001:0DB8:0001:0002:aaaa:bbbb:cccc:dddd'));
  assert.notEqual(authRateLimitNetwork('2001:db8:1:2::1'), authRateLimitNetwork('2001:db8:1:3::1'));
  assert.equal(authRateLimitNetwork('fe80::1%eth0'), authRateLimitNetwork('fe80::2%eth0'));
});

test('invalid/missing socket address fails closed as 500, never as 429 or a shared anonymous key', () => {
  for (const address of [undefined, '', 'unknown', '192.0.2.1:1234', '192.0.2.1, 198.51.100.2']) {
    assert.throws(() => authRateLimitNetwork(address), error => error.getStatus() === 500);
  }
});

test('storage receives only parameterized HMAC keys, with operation and network isolation', async () => {
  const queries = [];
  const db = { $queryRaw: async query => { queries.push(query); return [allowed]; } };
  const limiter = new AuthRateLimitService(db, config);
  for (const [operation, address] of [['login', '192.0.2.1'], ['login', '::ffff:192.0.2.1'], ['register', '192.0.2.1'], ['login', '192.0.2.2']]) {
    assert.deepEqual(await limiter.consume(operation, address), allowed);
  }
  assert.equal(queries[0].values[0], queries[1].values[0]);
  assert.notEqual(queries[0].values[0], queries[2].values[0]);
  assert.notEqual(queries[0].values[0], queries[3].values[0]);
  const otherInstance = new AuthRateLimitService(db, config);
  await otherInstance.consume('login', '192.0.2.1');
  assert.equal(queries[0].values[0], queries[4].values[0]);
  for (const query of queries) {
    assert.match(query.values[0], /^[a-f0-9]{64}$/);
    assert.ok(!query.text.includes(query.values[0]));
    assert.ok(!JSON.stringify(query).includes('192.0.2'));
    assert.ok(!JSON.stringify(query).includes(secret));
  }
});

test('each policy supplies the documented window and bounded rejection sentinel to storage', async () => {
  for (const [operation, policy] of Object.entries(authRateLimitPolicies)) {
    const db = { $queryRaw: async query => {
      assert.deepEqual(query.values.slice(1), [policy.windowSeconds, policy.requests + 1, policy.windowSeconds, policy.requests, policy.requests]);
      return [{ allowed: false, retryAfterSeconds: policy.windowSeconds }];
    } };
    assert.deepEqual(await new AuthRateLimitService(db, config).consume(operation, '192.0.2.1'), { allowed: false, retryAfterSeconds: policy.windowSeconds });
  }
});

test('unexpected storage errors remain sanitized 500 and logs contain no underlying error', async t => {
  const logs = [];
  t.mock.method(Logger.prototype, 'error', (...args) => logs.push(args));
  const privateError = new Error('private-password-token-ip');
  const limiter = new AuthRateLimitService({ $queryRaw: async () => { throw privateError; } }, config);
  await assert.rejects(limiter.consume('login', '192.0.2.1'), error => error.getStatus() === 500 && !error.message.includes(privateError.message));
  assert.deepEqual(logs, [['Authentication rate limit storage unavailable']]);
});

test('recognized Prisma storage outage returns 503 without error details', async t => {
  t.mock.method(Logger.prototype, 'error', () => {});
  const error = new Prisma.PrismaClientKnownRequestError('private-database-detail', { code: 'P2010', clientVersion: '7.10.0' });
  const limiter = new AuthRateLimitService({ $queryRaw: async () => { throw error; } }, config);
  await assert.rejects(limiter.consume('login', '192.0.2.1'), failure => failure.getStatus() === 503 && !failure.message.includes(error.message));
});

test('invalid storage result is a programming/storage failure, not a denial decision', async t => {
  t.mock.method(Logger.prototype, 'error', () => {});
  for (const rows of [[], [allowed, allowed], [{ allowed: 'false', retryAfterSeconds: 1 }], [{ allowed: false, retryAfterSeconds: 0 }], [{ allowed: false, retryAfterSeconds: 1.5 }]]) {
    const limiter = new AuthRateLimitService({ $queryRaw: async () => rows }, config);
    await assert.rejects(limiter.consume('login', '192.0.2.1'), error => error.getStatus() === 500);
  }
});


test('trusted proxy recognizes only the current Docker peer and a single valid forwarded IP', () => {
  const trusted = ['172.20.0.5'];
  assert.equal(authRateLimitClientAddress('172.20.0.5', '198.51.100.9', trusted), '198.51.100.9');
  assert.equal(authRateLimitClientAddress('::ffff:172.20.0.5', '2001:db8::8', trusted), '2001:db8::8');
  assert.equal(authRateLimitClientAddress('172.20.0.6', '198.51.100.9', trusted), '172.20.0.6');
  assert.equal(authRateLimitClientAddress('127.0.0.1', '198.51.100.9', trusted), '127.0.0.1');
});

test('trusted proxy does not accept arbitrary or ambiguous forwarded chains', () => {
  const trusted = ['172.20.0.5'];
  for (const value of [undefined, ['198.51.100.9'], '198.51.100.9, 203.0.113.7', '198.51.100.9:1234',
    'unknown', ' 198.51.100.9', '198.51.100.9 ']) {
    assert.equal(authRateLimitClientAddress('172.20.0.5', value, trusted), '172.20.0.5');
  }
  assert.equal(authRateLimitClientAddress(undefined, '198.51.100.9', trusted), undefined);
});
