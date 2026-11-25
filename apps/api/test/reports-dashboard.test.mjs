import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test, mock } from 'node:test';
import { randomUUID } from 'node:crypto';
import { ReportsController } from '../dist/reports/reports.controller.js';
import { ReportsDashboardService, trendBuckets, DASHBOARD_RANKING_LIMIT } from '../dist/reports/reports-dashboard.service.js';
import { REQUIRE_PERMISSIONS_KEY } from '../dist/authorization/decorators/require-permissions.decorator.js';

const context = { institutionId: randomUUID(), userId: randomUUID(), permissions: ['reports.read'], roleCodes: [] };
const query = { from: '2035-01-01', to: '2035-01-07' };
const status = (code) => (error) => error.getStatus?.() === code;
const indicators = { scheduled: 20n, cancelled: 4n, noShows: 3n, released: 4n, recovered: 1n, sent: 10n, accepted: 1n, rejected: 3n, expired: 5n };
const rows = () => [
  [indicators],
  [{ total: 20n, booked: 4n, attended: 9n, noShows: 3n, cancelled: 3n }],
  [{ day: '2035-01-02', scheduled: 12n, cancelled: 3n, noShows: 1n }, { day: '2035-01-05', scheduled: 8n, cancelled: 1n, noShows: 2n }],
  [{ total: 40n, reserved: 36n, available: 2n, inProcess: 1n, expired: 1n }],
  [{ id: 's1', name: 'Kinesiología', scheduled: 14n, attended: 6n, noShows: 3n, cancelled: 2n, waiting: 5n },
    { id: 's2', name: 'Nutrición', scheduled: 6n, attended: 3n, noShows: 0n, cancelled: 1n, waiting: 0n }],
  [{ id: 'p1', name: 'Ana Pérez', scheduled: 20n, attended: 9n, noShows: 3n, cancelled: 3n }],
  [{ active: 5n, averageWaitDays: 3.25, oldestWaitDays: 9.5 }],
  [{ name: 'Estándar', level: 0, count: 5n }],
];
function fixture(results = rows(), timeZone = 'America/Santiago') {
  const prisma = { institution: { findUnique: async () => ({ timeZone }) },
    branch: { findFirst: mock.fn(async () => ({ id: randomUUID() })) },
    service: { findFirst: mock.fn(async () => ({ id: randomUUID() })) },
    professional: { findFirst: mock.fn(async () => ({ id: randomUUID() })) },
    $queryRaw: mock.fn((sql) => sql),
    $transaction: mock.fn(async (queries) => queries.map((_sql, index) => results[index])) };
  return { prisma, service: new ReportsDashboardService(prisma) };
}

test('dashboard route reuses guards and requires reports.read; identity mismatch is rejected', () => {
  assert.deepEqual(Reflect.getMetadata(REQUIRE_PERMISSIONS_KEY, ReportsController.prototype.findDashboard), ['reports.read']);
  const controller = new ReportsController({}, { find() { assert.fail('no read'); } });
  for (const request of [{}, { principal: { userId: context.userId } }, { principal: { userId: randomUUID() }, authorization: context }]) {
    assert.throws(() => controller.findDashboard(query, undefined, request), status(401));
  }
  assert.throws(() => controller.findDashboard({ ...query, extra: 'x' }, undefined, { principal: { userId: context.userId }, authorization: context }), status(400));
});
test('daily trend covers every day of the period, including days without activity', () => {
  const { granularity, trend } = trendBuckets('2035-01-30', '2035-02-02', [{ day: '2035-02-01', scheduled: 2, cancelled: 1, noShows: 0 }]);
  assert.equal(granularity, 'day');
  assert.deepEqual(trend.map((bucket) => bucket.start), ['2035-01-30', '2035-01-31', '2035-02-01', '2035-02-02']);
  assert.deepEqual(trend[2], { start: '2035-02-01', scheduled: 2, cancelled: 1, noShows: 0 });
  assert.equal(trendBuckets('2035-01-01', '2035-03-03', []).granularity, 'day');
});
test('long periods use ISO weeks starting on Monday and events at the edges are never dropped', () => {
  const { granularity, trend } = trendBuckets('2035-01-03', '2035-03-31', [
    { day: '2035-01-03', scheduled: 1, cancelled: 0, noShows: 0 }, { day: '2035-01-07', scheduled: 1, cancelled: 0, noShows: 0 },
    { day: '2035-01-08', scheduled: 1, cancelled: 0, noShows: 0 }, { day: '2035-04-01', scheduled: 0, cancelled: 1, noShows: 0 }]);
  assert.equal(granularity, 'week');
  assert.equal(trend[0].start, '2035-01-01'); assert.equal(new Date(`${trend[0].start}T00:00:00Z`).getUTCDay(), 1);
  assert.equal(trend[0].scheduled, 2); assert.equal(trend[1].scheduled, 1);
  assert.equal(trend.at(-1).cancelled, 1);
  assert.equal(trend.reduce((sum, bucket) => sum + bucket.scheduled, 0), 3);
});
test('scope is validated before any aggregate runs', async () => {
  const { prisma, service } = fixture();
  await assert.rejects(service.find(query, { ...context, institutionId: undefined }), status(400));
  await assert.rejects(service.find({ ...query, branchId: randomUUID() }, { ...context, branchId: randomUUID() }), status(404));
  prisma.service.findFirst = async () => null;
  await assert.rejects(service.find({ ...query, serviceId: randomUUID() }, context), status(404));
  assert.equal(prisma.$transaction.mock.callCount(), 0);
});
test('all aggregates run read-only in one repeatable-read snapshot with bound parameters', async () => {
  const { prisma, service } = fixture();
  const filters = { branchId: randomUUID(), serviceId: randomUUID(), professionalId: randomUUID() };
  await service.find({ ...query, ...filters }, context);
  const [queries, options] = prisma.$transaction.mock.calls[0].arguments;
  assert.equal(queries.length, 8); assert.equal(options.isolationLevel, 'RepeatableRead');
  for (const sql of queries) {
    assert.doesNotMatch(sql.sql, /\b(INSERT|UPDATE|DELETE|CALL|TRUNCATE)\b/i);
    for (const value of [context.institutionId, filters.branchId, filters.serviceId]) assert.ok(!sql.sql.includes(value));
  }
  const all = queries.flatMap((sql) => sql.values);
  for (const value of [context.institutionId, ...Object.values(filters), 'America/Santiago', DASHBOARD_RANKING_LIMIT]) assert.ok(all.includes(value));
});
test('maps a decision-ready DTO with rates, rankings, waitlist and prioritized insights', async () => {
  const { data } = (await fixture().service.find(query, context));
  assert.deepEqual(data.period, query); assert.equal(data.granularity, 'day'); assert.equal(data.trend.length, 7);
  assert.deepEqual(data.indicators.slots, { released: 4, recovered: 1, recoveryRatePct: 25 });
  assert.deepEqual(data.appointmentStatus, { total: 20, booked: 4, attended: 9, noShows: 3, cancelled: 3, other: 1 });
  assert.deepEqual(data.rates, { attendanceRatePct: 75, noShowRatePct: 25, cancellationRatePct: 15, recoveryRatePct: 25,
    offerAcceptanceRatePct: 11.11, occupancyPct: 90 });
  assert.deepEqual(data.capacity, { total: 40, reserved: 36, available: 2, inProcess: 1, expired: 1 });
  assert.deepEqual(data.services[0], { id: 's1', name: 'Kinesiología', scheduled: 14, attended: 6, noShows: 3, cancelled: 2, noShowRatePct: 33.33, waiting: 5 });
  assert.deepEqual(data.professionals[0], { id: 'p1', name: 'Ana Pérez', scheduled: 20, attended: 9, noShows: 3, cancelled: 3, noShowRatePct: 25 });
  assert.deepEqual(data.waitlist, { active: 5, averageWaitDays: 3.3, oldestWaitDays: 9.5, byPriority: [{ name: 'Estándar', level: 0, count: 5 }] });
  const codes = data.insights.map((insight) => insight.code);
  assert.equal(codes[0], 'NO_SHOW_RATE'); assert.ok(codes.includes('DEMAND_OVER_CAPACITY'));
  assert.ok(codes.includes('LOW_RECOVERY')); assert.ok(codes.includes('OFFERS_EXPIRING'));
  assert.doesNotMatch(JSON.stringify(data), /email|password|token|rut/i);
});
test('empty period returns zeros without dividing by zero', async () => {
  const empty = [[{ scheduled: 0n, cancelled: 0n, noShows: 0n, released: 0n, recovered: 0n, sent: 0n, accepted: 0n, rejected: 0n, expired: 0n }],
    [{ total: 0n, booked: 0n, attended: 0n, noShows: 0n, cancelled: 0n }], [], [{ total: 0n, reserved: 0n, available: 0n, inProcess: 0n, expired: 0n }],
    [], [], [{ active: 0n, averageWaitDays: null, oldestWaitDays: null }], []];
  const { data } = await fixture(empty).service.find(query, context);
  assert.ok(Object.values(data.rates).every((value) => value === 0));
  assert.ok(data.trend.every((bucket) => !bucket.scheduled && !bucket.cancelled && !bucket.noShows));
  assert.deepEqual(data.insights.map((insight) => insight.code), ['NO_ACTIVITY']);
});
test('unsafe counts, inconsistent status totals and missing rows fail closed', async () => {
  for (const mutate of [(r) => { r[1][0].total = -1n; }, (r) => { r[1][0].total = 2n; }, (r) => { r[3] = []; },
    (r) => { r[4][0].waiting = 9007199254740993n; }, (r) => { r[6][0].averageWaitDays = Number.NaN; }]) {
    const results = rows(); mutate(results);
    await assert.rejects(fixture(results).service.find(query, context), status(503));
  }
});
