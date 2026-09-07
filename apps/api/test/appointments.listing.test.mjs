import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mock, test } from 'node:test';
import { RequestMethod } from '@nestjs/common';
import { GUARDS_METADATA, METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { AccessTokenGuard } from '../dist/auth/guards/access-token.guard.js';
import { AppointmentsController } from '../dist/appointments/appointments.controller.js';
import { AppointmentsService } from '../dist/appointments/appointments.service.js';

const principal = { userId: randomUUID(), sessionId: randomUUID() };
const hasStatus = (status) => (error) => error?.getStatus?.() === status;

function appointment(overrides = {}) {
  const institutionId = randomUUID();
  return {
    id: randomUUID(),
    userId: principal.userId,
    institutionId,
    startsAt: new Date('2026-01-01T10:00:00.000Z'),
    endsAt: new Date('2026-01-01T10:30:00.000Z'),
    origin: 'WEB',
    status: { code: 'AGENDADA', allowsCancellation: true },
    branch: { id: randomUUID(), institutionId, name: 'Branch', email: 'private@example.com' },
    service: { id: randomUUID(), institutionId, name: 'Service', active: false },
    professional: {
      id: randomUUID(), institutionId, internalCode: 'private',
      user: { firstNames: 'Ana', lastNames: 'Perez', email: 'private@example.com' },
    },
    operationalNote: 'private',
    createdByUserId: randomUUID(),
    deletedAt: null,
    ...overrides,
  };
}

function setup(rows = []) {
  const findMany = mock.fn(async () => rows);
  return { service: new AppointmentsService({ appointment: { findMany } }), findMany };
}

test('my appointments route requires AccessTokenGuard and delegates only the principal', async () => {
  const findMine = mock.fn(async () => ({ data: [] }));
  const controller = new AppointmentsController({ findMine });
  const handler = AppointmentsController.prototype.findMine;
  assert.deepEqual(Reflect.getMetadata(GUARDS_METADATA, AppointmentsController), [AccessTokenGuard]);
  assert.equal(Reflect.getMetadata(PATH_METADATA, AppointmentsController), 'appointments');
  assert.equal(Reflect.getMetadata(PATH_METADATA, handler), 'me');
  assert.equal(Reflect.getMetadata(METHOD_METADATA, handler), RequestMethod.GET);
  assert.deepEqual(await controller.findMine({}, undefined, { principal }), { data: [] });
  assert.deepEqual(findMine.mock.calls[0].arguments, [principal]);
  assert.throws(() => controller.findMine({}, undefined, {}), hasStatus(401));
  assert.equal(findMine.mock.callCount(), 1);
});

test('my appointments rejects identity, tenant and arbitrary filters in query or body', () => {
  const findMine = mock.fn();
  const controller = new AppointmentsController({ findMine });
  for (const fields of [
    { userId: randomUUID() }, { institutionId: randomUUID() }, { branchId: randomUUID() },
    { status: 'AGENDADA' }, { orderBy: 'desc' }, { userId: [principal.userId, randomUUID()] },
    { where: { userId: { not: principal.userId } } },
  ]) {
    assert.throws(() => controller.findMine(fields, undefined, { principal }), hasStatus(400));
    assert.throws(() => controller.findMine({}, fields, { principal }), hasStatus(400));
  }
  assert.equal(findMine.mock.callCount(), 0);
});

test('my appointments scopes SQL to the current owner and excludes soft-deleted appointments', async () => {
  const { service, findMany } = setup();
  const secondPrincipal = { userId: randomUUID(), sessionId: randomUUID() };
  await service.findMine(principal);
  await service.findMine(secondPrincipal);
  assert.deepEqual(findMany.mock.calls.map(({ arguments: [query] }) => query.where), [
    { userId: principal.userId, deletedAt: null },
    { userId: secondPrincipal.userId, deletedAt: null },
  ]);
});

test('my appointments with no rows returns an empty data array', async () => {
  assert.deepEqual(await setup().service.findMine(principal), { data: [] });
});

test('my appointments selects and maps only the defined public fields', async () => {
  const row = appointment();
  const { service, findMany } = setup([row]);
  assert.deepEqual(await service.findMine(principal), {
    data: [{
      id: row.id, institutionId: row.institutionId, status: 'AGENDADA',
      startsAt: row.startsAt.toISOString(), endsAt: row.endsAt.toISOString(), origin: 'WEB',
      branch: { id: row.branch.id, name: row.branch.name },
      service: { id: row.service.id, name: row.service.name },
      professional: { id: row.professional.id, firstNames: 'Ana', lastNames: 'Perez' },
    }],
  });
  assert.deepEqual(findMany.mock.calls[0].arguments[0].select, {
    id: true, institutionId: true, startsAt: true, endsAt: true, origin: true,
    status: { select: { code: true } },
    branch: { select: { id: true, institutionId: true, name: true } },
    service: { select: { id: true, institutionId: true, name: true } },
    professional: {
      select: {
        id: true, institutionId: true,
        user: { select: { firstNames: true, lastNames: true } },
      },
    },
  });
});

test('my appointments requests ascending start time with a deterministic id tie-breaker', async () => {
  const { service, findMany } = setup();
  await service.findMine(principal);
  assert.deepEqual(findMany.mock.calls[0].arguments[0].orderBy, [{ startsAt: 'asc' }, { id: 'asc' }]);
});

test('my appointments preserves past and future dates, stored statuses and origins without writes', async () => {
  const rows = [
    appointment({ startsAt: new Date(0), endsAt: new Date(60_000) }),
    appointment({
      startsAt: new Date('2099-01-01T10:00:00.000Z'),
      endsAt: new Date('2099-01-01T10:30:00.000Z'),
      status: { code: 'HISTORICAL_STATUS' }, origin: 'REASSIGNMENT',
    }),
  ];
  const before = structuredClone(rows);
  const { service, findMany } = setup(rows);
  const response = await service.findMine(principal);
  assert.deepEqual(response.data.map(({ status, origin, startsAt }) => ({ status, origin, startsAt })),
    rows.map((row) => ({ status: row.status.code, origin: row.origin, startsAt: row.startsAt.toISOString() })));
  assert.deepEqual(rows, before);
  assert.equal(findMany.mock.callCount(), 1);
});

test('my appointments hides inconsistent tenant relations without filtering valid owned institutions', async () => {
  const valid = [appointment(), appointment()];
  const invalid = ['branch', 'service', 'professional'].map((relation) => {
    const row = appointment();
    row[relation].institutionId = randomUUID();
    return row;
  });
  const response = await setup([...invalid, ...valid]).service.findMine(principal);
  assert.deepEqual(response.data.map(({ id }) => id), valid.map(({ id }) => id));
});
