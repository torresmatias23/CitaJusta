import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test, mock } from 'node:test';
import { randomUUID } from 'node:crypto';
import { GUARDS_METADATA } from '@nestjs/common/constants.js';
import { AgendaController } from '../dist/agenda/agenda.controller.js';
import { AgendaService } from '../dist/agenda/agenda.service.js';
import { parseAgendaQuery, institutionalDay } from '../dist/agenda/agenda.schemas.js';
import { localWindow } from '../dist/availability/availability-administration.schemas.js';
import { REQUIRE_PERMISSIONS_KEY } from '../dist/authorization/decorators/require-permissions.decorator.js';

const context = { institutionId: randomUUID(), userId: randomUUID(), permissions: ['agenda.read'], roleCodes: [] };
const query = { date: '2035-01-15' };
const status = (code) => (error) => error.getStatus?.() === code;
function fixture() {
  const prisma = { institution: { findUnique: async () => ({ timeZone: 'America/Santiago' }) },
    branch: { findFirst: async () => ({ id: randomUUID() }) }, service: { findFirst: async () => ({ id: randomUUID() }) },
    professional: { findFirst: async () => ({ id: randomUUID() }) }, appointment: { findMany: mock.fn(async () => []) } };
  return { prisma, service: new AgendaService(prisma) };
}
test('agenda uses all existing guards and explicit agenda.read permission', () => {
  assert.equal(Reflect.getMetadata(GUARDS_METADATA, AgendaController).length, 3);
  assert.deepEqual(Reflect.getMetadata(REQUIRE_PERMISSIONS_KEY, AgendaController.prototype.find), ['agenda.read']);
});
test('agenda rejects missing principal/context and mismatched identity', () => {
  const controller = new AgendaController({ find() { assert.fail('must not query'); } });
  for (const request of [{}, { principal: { userId: context.userId } }, { principal: { userId: randomUUID() }, authorization: context }]) {
    assert.throws(() => controller.find(query, undefined, request), status(401));
  }
});
test('agenda requires institution context', async () => {
  await assert.rejects(fixture().service.find(query, { ...context, institutionId: undefined }), status(400));
});
test('agenda accepts a strict date and rejects invalid/unknown query and functional body', () => {
  assert.deepEqual(parseAgendaQuery(query, undefined), query);
  for (const invalid of [{}, { date: '2035-02-30' }, { date: '2035-1-15' }, { ...query, branchId: 'bad' },
    { ...query, institutionId: context.institutionId }, { ...query, userId: context.userId }, { ...query, date: ['2035-01-15'] }]) {
    assert.throws(() => parseAgendaQuery(invalid, undefined), status(400));
  }
  assert.throws(() => parseAgendaQuery(query, { userId: context.userId }), status(400));
});
test('institution day agrees with HU014 and honors DST short/long days', () => {
  const range = institutionalDay(query.date, 'America/Santiago');
  assert.equal(range.gte.toISOString(), '2035-01-15T03:00:00.000Z');
  assert.equal(localWindow(range.gte, new Date(+range.gte + 60_000), 'America/Santiago').date.toISOString().slice(0, 10), query.date);
  for (const [date, hours] of [['2035-03-11', 23], ['2035-11-04', 25]]) {
    const day = institutionalDay(date, 'America/New_York'); assert.equal((day.lt - day.gte) / 3_600_000, hours);
  }
  assert.throws(() => institutionalDay(query.date, 'Invalid/Zone'), status(503));
  for (const date of ['0001-01-01', '0099-12-31', '9999-12-31']) {
    assert.equal(institutionalDay(date, 'UTC').gte.toISOString().slice(0, 10), date);
  }
});
test('institution query scopes all persisted relations, excludes only deleted appointments and orders deterministically', async () => {
  const { service, prisma } = fixture(); await service.find(query, context);
  const { where, orderBy } = prisma.appointment.findMany.mock.calls[0].arguments[0];
  assert.equal(where.institutionId, context.institutionId); assert.equal(where.deletedAt, null);
  for (const name of ['branch', 'service', 'professional']) assert.deepEqual(where[name], { institutionId: context.institutionId });
  assert.equal(where.status, undefined); assert.deepEqual(orderBy, [{ startsAt: 'asc' }, { id: 'asc' }]);
});
test('branch context cannot escape and filters translate exactly', async () => {
  const { service, prisma } = fixture(); const branchId = randomUUID();
  await assert.rejects(service.find({ ...query, branchId: randomUUID() }, { ...context, branchId }), status(404));
  const filtered = { ...query, serviceId: randomUUID(), professionalId: randomUUID(), status: 'CANCELADA' };
  await service.find(filtered, { ...context, branchId });
  const { where } = prisma.appointment.findMany.mock.calls[0].arguments[0];
  assert.equal(where.branchId, branchId); assert.equal(where.serviceId, filtered.serviceId);
  assert.equal(where.professionalId, filtered.professionalId); assert.deepEqual(where.status, { code: 'CANCELADA' });
});
for (const resource of ['branch', 'service', 'professional']) test(`agenda rejects foreign ${resource} before appointment query`, async () => {
  const { service, prisma } = fixture(); prisma[resource].findFirst = async () => null;
  await assert.rejects(service.find({ ...query, [`${resource}Id`]: randomUUID() }, context), status(404));
  assert.equal(prisma.appointment.findMany.mock.callCount(), 0);
});
test('agenda maps only public fields and completes using read-only delegates without transaction', async () => {
  const { service, prisma } = fixture();
  const person = { id: randomUUID(), firstNames: 'Test', lastNames: 'User', passwordHash: 'private' };
  prisma.appointment.findMany.mock.mockImplementation(async () => [{ id: randomUUID(), startsAt: new Date('2035-01-15T12:00Z'), endsAt: new Date('2035-01-15T13:00Z'), origin: 'WEB',
    status: { code: 'CANCELADA', name: 'Cancelada' }, branch: { id: randomUUID(), name: 'Sede' }, service: { id: randomUUID(), name: 'Servicio' },
    professional: { id: randomUUID(), titleOrFunction: null, user: person }, user: person, operationalNote: 'private' }]);
  const result = await service.find(query, context);
  assert.equal(JSON.stringify(result).includes('private'), false);
  assert.deepEqual(Object.keys(result.data[0]).sort(), ['id', 'startsAt', 'endsAt', 'origin', 'status', 'branch', 'service', 'professional', 'user'].sort());
  assert.equal(result.data[0].startsAt, '2035-01-15T12:00:00.000Z');
});
