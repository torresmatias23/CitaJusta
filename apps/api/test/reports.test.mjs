import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test, mock } from 'node:test';
import { randomUUID } from 'node:crypto';
import { GUARDS_METADATA } from '@nestjs/common/constants.js';
import { ReportsController } from '../dist/reports/reports.controller.js';
import { ReportsService } from '../dist/reports/reports.service.js';
import { parseReportsQuery } from '../dist/reports/reports.schemas.js';
import { institutionalDay } from '../dist/agenda/agenda.schemas.js';
import { REQUIRE_PERMISSIONS_KEY } from '../dist/authorization/decorators/require-permissions.decorator.js';

const context = { institutionId: randomUUID(), userId: randomUUID(), permissions: ['reports.read'], roleCodes: [] };
const query = { from: '2035-01-15', to: '2035-01-16' };
const status = (code) => (error) => error.getStatus?.() === code;
const zero = { scheduled: 0n, cancelled: 0n, noShows: 0n, released: 0n, recovered: 0n, sent: 0n, accepted: 0n, rejected: 0n, expired: 0n };
function fixture(counts = zero, timeZone = 'America/Santiago') {
  const prisma = { institution: { findUnique: async () => ({ timeZone }) },
    branch: { findFirst: mock.fn(async () => ({ id: randomUUID() })) },
    service: { findFirst: mock.fn(async () => ({ id: randomUUID() })) },
    professional: { findFirst: mock.fn(async () => ({ id: randomUUID() })) },
    $queryRaw: mock.fn(async () => [counts]) };
  return { prisma, service: new ReportsService(prisma) };
}

test('reports uses the three existing guards and reports.read', () => {
  assert.deepEqual(Reflect.getMetadata(GUARDS_METADATA, ReportsController).map((guard) => guard.name),
    ['AccessTokenGuard', 'AuthorizationContextGuard', 'PermissionsGuard']);
  assert.deepEqual(Reflect.getMetadata(REQUIRE_PERMISSIONS_KEY, ReportsController.prototype.find), ['reports.read']);
});
test('controller rejects absent or mismatching authenticated identity', () => {
  const controller = new ReportsController({ find() { assert.fail('no read'); } });
  for (const request of [{}, { principal: { userId: context.userId } }, { principal: { userId: randomUUID() }, authorization: context }]) {
    assert.throws(() => controller.find(query, undefined, request), status(401));
  }
});
test('strict dates, IDs, unknown fields and functional bodies', () => {
  assert.deepEqual(parseReportsQuery(query, {}), query);
  for (const invalid of [{}, { from: query.from }, { ...query, from: '2035-02-30' }, { ...query, from: '2035-1-15' },
    { ...query, from: '2035-01-17' }, { ...query, from: [query.from] }, { ...query, extra: '' },
    { ...query, institutionId: context.institutionId }, { ...query, userId: context.userId },
    ...['branchId', 'serviceId', 'professionalId'].map((key) => ({ ...query, [key]: 'invalid' }))]) {
    assert.throws(() => parseReportsQuery(invalid, undefined), status(400));
  }
  for (const body of [null, [], 'x', { userId: context.userId }]) assert.throws(() => parseReportsQuery(query, body), status(400));
});
test('period includes both endpoints and allows exactly 366 calendar days', () => {
  for (const range of [{ from: '2024-01-01', to: '2024-12-31' }, { from: '2025-01-01', to: '2026-01-01' }, { from: query.from, to: query.from }]) {
    assert.deepEqual(parseReportsQuery(range, undefined), range);
  }
  assert.throws(() => parseReportsQuery({ from: '2024-01-01', to: '2025-01-01' }), status(400));
});
test('requires institution and prevents branch scope escape before aggregate', async () => {
  const { prisma, service } = fixture();
  await assert.rejects(service.find(query, { ...context, institutionId: undefined }), status(400));
  await assert.rejects(service.find({ ...query, branchId: randomUUID() }, { ...context, branchId: randomUUID() }), status(404));
  assert.equal(prisma.$queryRaw.mock.callCount(), 0);
});
for (const name of ['branch', 'service', 'professional']) test(`rejects foreign ${name} without aggregating`, async () => {
  const { prisma, service } = fixture(); prisma[name].findFirst = async () => null;
  await assert.rejects(service.find({ ...query, [`${name}Id`]: randomUUID() }, context), status(404));
  assert.equal(prisma.$queryRaw.mock.callCount(), 0);
});
test('scope and all filters are bound values, never interpolated SQL identifiers', async () => {
  const { prisma, service } = fixture();
  const filters = { branchId: randomUUID(), serviceId: randomUUID(), professionalId: randomUUID() };
  await service.find({ ...query, ...filters }, { ...context, branchId: filters.branchId });
  const sql = prisma.$queryRaw.mock.calls[0].arguments[0];
  for (const [key, value] of Object.entries(filters)) {
    assert.ok(sql.values.includes(value)); assert.ok(!sql.sql.includes(value));
    assert.deepEqual(prisma[key.replace('Id', '')].findFirst.mock.calls[0].arguments[0].where, { id: value, institutionId: context.institutionId });
  }
  assert.ok(sql.values.includes(context.institutionId));
});
test('range reuses institutionalDay across DST and sends inclusive/exclusive bounds', async () => {
  const { prisma, service } = fixture(zero, 'America/New_York');
  const range = { from: '2035-03-11', to: '2035-03-11' };
  await service.find(range, context);
  const dates = prisma.$queryRaw.mock.calls[0].arguments[0].values.filter((value) => value instanceof Date);
  const expected = institutionalDay(range.from, 'America/New_York');
  assert.deepEqual(dates, [expected.gte, expected.lt]);
  assert.equal((dates[1] - dates[0]) / 3_600_000, 23);
});
test('single aggregate returns safe numeric DTO and rounded recovery without exposing internal data', async () => {
  const counts = { scheduled: 11n, cancelled: 4n, noShows: 2n, released: 3n, recovered: 1n, sent: 8n, accepted: 1n, rejected: 3n, expired: 4n, private: 'secret' };
  const { prisma, service } = fixture(counts);
  assert.deepEqual(await service.find(query, context), { data: { period: query,
    appointments: { scheduled: 11, cancelled: 4, noShows: 2 }, slots: { released: 3, recovered: 1, recoveryRatePct: 33.33 },
    offers: { sent: 8, accepted: 1, rejected: 3, expired: 4 } } });
  assert.equal(prisma.$queryRaw.mock.callCount(), 1);
  const sql = prisma.$queryRaw.mock.calls[0].arguments[0].sql;
  assert.doesNotMatch(sql, /\b(INSERT|UPDATE|DELETE|CALL)\b/i);
  assert.match(sql, /statement_timestamp/);
});
test('zero releases produces finite zero rate even with a recovery from a previous period', async () => {
  const { service } = fixture({ ...zero, recovered: 1n });
  assert.equal((await service.find(query, context)).data.slots.recoveryRatePct, 0);
});
test('unsafe counts and missing aggregate fail closed', async () => {
  for (const value of [-1n, 9007199254740992n]) await assert.rejects(fixture({ ...zero, sent: value }).service.find(query, context), status(503));
  const { prisma, service } = fixture(); prisma.$queryRaw = async () => [];
  await assert.rejects(service.find(query, context), status(503));
});
