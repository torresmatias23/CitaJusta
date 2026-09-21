import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test, mock } from 'node:test';
import { OfferExpirationRunner } from '../dist/reassignments/offer-expiration.runner.js';
import { PrismaService } from '../dist/database/prisma.service.js';

function fixture(enabled = true, expire = async () => {}) {
  const rows = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  const findMany = mock.fn(async () => rows);
  const service = { expireOffer: mock.fn(expire) };
  const config = { getOrThrow: (key) => ({ OFFER_EXPIRATION_ENABLED: enabled, OFFER_EXPIRATION_INTERVAL_MS: 30_000, OFFER_EXPIRATION_BATCH_SIZE: 3 })[key] };
  const runner = new OfferExpirationRunner({ appointmentOffer: { findMany } }, service, config);
  runner.logger = { warn: mock.fn() };
  return { runner, service, findMany };
}

test('disabled runner performs no discovery or domain writes', async () => {
  const f = fixture(false); f.runner.onApplicationBootstrap(); await f.runner.onModuleDestroy();
  assert.equal(f.findMany.mock.callCount(), 0); assert.equal(f.service.expireOffer.mock.callCount(), 0);
});

test('startup queries bounded ordered due IDs, processes sequentially and survives one failure', async () => {
  let concurrent = 0; let max = 0;
  const f = fixture(true, async (id) => { concurrent++; max = Math.max(max, concurrent); await Promise.resolve(); concurrent--; if (id === 'b') throw new Error('private'); });
  f.runner.onApplicationBootstrap(); await f.runner.active;
  const args = f.findMany.mock.calls[0].arguments[0];
  assert.equal(args.where.status, 'PENDING'); assert.ok(args.where.expiresAt.lte instanceof Date);
  assert.deepEqual(args.orderBy, [{ expiresAt: 'asc' }, { id: 'asc' }]); assert.equal(args.take, 3);
  assert.deepEqual(args.select, { id: true }); assert.equal(max, 1);
  assert.deepEqual(f.service.expireOffer.mock.calls.map((c) => c.arguments[0]), ['a','b','c']);
  assert.equal(f.runner.logger.warn.mock.callCount(), 1); await f.runner.onModuleDestroy();
});

test('cycles never overlap and shutdown drains current offer, skips remaining and cancels timer', async () => {
  let release; let entered;
  const barrier = new Promise((r) => { release = r; }); const started = new Promise((r) => { entered = r; });
  const f = fixture(true, async () => { entered(); await barrier; });
  f.runner.onApplicationBootstrap(); await started; f.runner.onApplicationBootstrap();
  assert.equal(f.findMany.mock.callCount(), 1);
  let closed = false; const closing = f.runner.onModuleDestroy().then(() => { closed = true; });
  await Promise.resolve(); assert.equal(closed, false); release(); await closing;
  assert.equal(f.service.expireOffer.mock.callCount(), 1); assert.equal(f.runner.timer, undefined);
  assert.equal(typeof PrismaService.prototype.onApplicationShutdown, 'function');
  assert.equal(PrismaService.prototype.onModuleDestroy, undefined);
});

test('periodic cycle follows completion, discovery failures retry, shutdown removes scheduled work', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture(); f.findMany.mock.mockImplementationOnce(async () => { throw new Error('offline'); });
  f.runner.onApplicationBootstrap(); await f.runner.active;
  assert.equal(f.runner.logger.warn.mock.callCount(), 1);
  t.mock.timers.tick(30_000); await f.runner.active;
  assert.equal(f.findMany.mock.callCount(), 2); assert.equal(f.service.expireOffer.mock.callCount(), 3);
  await f.runner.onModuleDestroy(); t.mock.timers.tick(60_000); assert.equal(f.findMany.mock.callCount(), 2);
});
