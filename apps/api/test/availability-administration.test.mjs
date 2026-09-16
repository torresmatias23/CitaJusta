import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test, mock } from 'node:test';
import { GUARDS_METADATA } from '@nestjs/common/constants.js';
import { Prisma } from '../dist/generated/prisma/client.js';
import { AvailabilityAdministrationService } from '../dist/availability/availability-administration.service.js';
import { AvailabilityAdministrationController } from '../dist/availability/availability-administration.controller.js';
import { REQUIRE_PERMISSIONS_KEY } from '../dist/authorization/decorators/require-permissions.decorator.js';
import { createAvailabilitySchema, updateAvailabilitySchema, createBlockSchema, parseAdministrationInput,
  administrationContext, futureInterval, localWindow, slotIntervals, exceedsCapacity } from '../dist/availability/availability-administration.schemas.js';

const context = { userId: randomUUID(), institutionId: randomUUID(), permissions: [], roleCodes: [] };
const input = { branchId: randomUUID(), professionalId: randomUUID(), serviceId: randomUUID(), startsAt: '2035-01-15T12:00:00Z', endsAt: '2035-01-15T13:00:00Z' };
const hasStatus = (status) => (error) => error.getStatus?.() === status;
const oldSlot = { id: randomUUID(), startsAt: new Date(input.startsAt), endsAt: new Date(input.endsAt), status: 'AVAILABLE',
  lockVersion: 0, blockedUntilAt: null, appointment: null, reassignments: [] };
function fixture() {
  const record = { id: randomUUID(), professionalId: input.professionalId, branchId: input.branchId, serviceId: input.serviceId,
    attentionPointId: null, ...localWindow(new Date(input.startsAt), new Date(input.endsAt), 'UTC'), active: true, capacity: 1,
    origin: 'MANUAL', createdAt: new Date(), updatedAt: new Date() };
  const tx = {
    auditEvent: { create: mock.fn(async ({ data }) => ({ id: data.id })) },
    userRole: { count: mock.fn(async () => 1) }, branch: { findFirst: mock.fn(async () => ({ institution: { timeZone: 'UTC' } })) },
    professional: { findFirst: mock.fn(async () => ({ serviceAssignments: [{ customDurationMinutes: null }] })) },
    service: { findFirst: mock.fn(async () => ({ durationMinutes: 30 })) },
    attentionPoint: { findFirst: mock.fn(async () => ({ capacity: 1 })), findUniqueOrThrow: mock.fn(async () => ({ capacity: 1 })) },
    availability: { findFirst: mock.fn(async () => record), findMany: mock.fn(async () => []),
      create: mock.fn(async ({ data }) => ({ ...record, ...data })), update: mock.fn(async ({ data }) => ({ ...record, ...data })) },
    agendaSlot: { findFirst: mock.fn(async () => null), findMany: mock.fn(async () => []),
      upsert: mock.fn(async ({ create }) => ({ ...create })), updateMany: mock.fn(async () => ({ count: 1 })) },
    scheduleBlock: { findFirst: mock.fn(async () => null), findMany: mock.fn(async () => []), create: mock.fn(async ({ data }) => ({ ...data, createdAt: new Date() })) },
    holiday: { findMany: mock.fn(async () => []) }, appointment: { count: mock.fn(async () => 0) },
  };
  const prisma = { $transaction: mock.fn(async (work, options) => { assert.equal(options.isolationLevel, 'Serializable'); return work(tx); }) };
  return { tx, record, prisma, service: new AvailabilityAdministrationService(prisma) };
}
test('HU-014 guards and permissions protect only the new administrative controller', () => {
  assert.equal(Reflect.getMetadata(GUARDS_METADATA, AvailabilityAdministrationController).length, 3);
  for (const action of ['create', 'update', 'block']) assert.deepEqual(Reflect.getMetadata(REQUIRE_PERMISSIONS_KEY, AvailabilityAdministrationController.prototype[action]), [`availability.${action}`]);
});
test('HU-014 strict schemas reject identities, invalid dates, sub-minute precision and empty patches', () => {
  for (const body of [{ ...input, institutionId: context.institutionId }, { ...input, startsAt: '2035-02-30T12:00:00Z' },
    { ...input, startsAt: '2035-01-15T12:00:01Z' }, { ...input, capacity: 2 }, { ...input, professionalId: 'bad' }]) {
    assert.throws(() => parseAdministrationInput(createAvailabilitySchema, body, {}), hasStatus(400));
  }
  for (const body of [{}, { active: true }, { startsAt: input.startsAt }, { branchId: input.branchId }]) {
    assert.throws(() => parseAdministrationInput(updateAvailabilitySchema, body, {}), hasStatus(400));
  }
  assert.deepEqual(parseAdministrationInput(updateAvailabilitySchema, { active: false }, {}), { active: false });
  assert.throws(() => parseAdministrationInput(createBlockSchema, { branchId: input.branchId, startsAt: input.startsAt, endsAt: input.endsAt, createdByUserId: context.userId }, {}), hasStatus(400));
  assert.throws(() => parseAdministrationInput(createAvailabilitySchema, input, { userId: context.userId }), hasStatus(400));
});
test('HU-014 rejects invalid/past ranges and requires complete service-duration slots', () => {
  assert.throws(() => futureInterval(input.endsAt, input.startsAt), hasStatus(400));
  assert.throws(() => futureInterval('2000-01-01', '2000-01-02'), hasStatus(400));
  assert.throws(() => slotIntervals(new Date(input.startsAt), new Date(input.endsAt), 45), hasStatus(400));
  assert.equal(slotIntervals(new Date(input.startsAt), new Date(input.endsAt), 30).length, 2);
});
test('HU-014 institutional wall times are explicit; cross-day and DST-transition windows rejected', () => {
  const window = localWindow(new Date(input.startsAt), new Date(input.endsAt), 'America/Santiago');
  assert.equal(window.date.toISOString(), '2035-01-15T00:00:00.000Z');
  assert.equal(window.startTime.getUTCHours(), 9);
  assert.throws(() => localWindow(new Date('2035-01-15T23:00Z'), new Date('2035-01-16T01:00Z'), 'UTC'), hasStatus(400));
  assert.throws(() => localWindow(new Date('2035-03-11T06:30Z'), new Date('2035-03-11T08:30Z'), 'America/New_York'), hasStatus(400));
});
test('HU-014 capacity permits compatible overlap and touching boundaries', () => {
  assert.equal(exceedsCapacity([{ start: 0, end: 10 }, { start: 10, end: 20 }], 1), false);
  assert.equal(exceedsCapacity([{ start: 0, end: 20 }, { start: 10, end: 30 }], 2), false);
  assert.equal(exceedsCapacity([{ start: 0, end: 20 }, { start: 10, end: 30 }], 1), true);
});
test('HU-014 authenticated context identity cannot be replaced', () => {
  assert.throws(() => administrationContext({}), hasStatus(401));
  assert.throws(() => administrationContext({ principal: { userId: randomUUID() }, authorization: context }), hasStatus(401));
});
test('HU-014 creation uses custom duration, materializes controlled slots and active relation filters', async () => {
  const { service, tx } = fixture();
  tx.professional.findFirst.mock.mockImplementation(async () => ({ serviceAssignments: [{ customDurationMinutes: 15 }] }));
  const response = await service.create(input, context);
  assert.equal(response.data.slots.length, 4);
  assert.equal(response.data.origin, 'MANUAL');
  const where = tx.professional.findFirst.mock.calls[0].arguments[0].where;
  assert.equal(where.institutionId, context.institutionId);
  assert.deepEqual(where.branchAssignments, { some: { branchId: input.branchId, active: true } });
  assert.deepEqual(where.serviceAssignments, { some: { serviceId: input.serviceId, active: true } });
});
for (const model of ['professional', 'service', 'branch']) test(`HU-014 unavailable/cross-tenant ${model} rejects before writes`, async () => {
  const { service, tx } = fixture();
  tx[model].findFirst.mock.mockImplementation(async () => null);
  await assert.rejects(service.create(input, context), hasStatus(404));
  assert.equal(tx.availability.create.mock.callCount(), 0);
});
test('HU-014 foreign branch context and absent permission cannot write', async () => {
  const { service, tx } = fixture();
  await assert.rejects(service.create(input, { ...context, branchId: randomUUID() }), hasStatus(404));
  tx.userRole.count.mock.mockImplementation(async () => 0);
  await assert.rejects(service.create(input, context), hasStatus(403));
});
test('HU-014 overlapping professional ranges fail; different professionals remain compatible', async () => {
  const { service, tx } = fixture();
  tx.availability.findMany.mock.mockImplementation(async () => [{ professionalId: input.professionalId }]);
  await assert.rejects(service.create(input, context), hasStatus(409));
  tx.availability.findMany.mock.mockImplementation(async () => []);
  tx.agendaSlot.findFirst.mock.mockImplementation(async () => ({ id: oldSlot.id }));
  await assert.rejects(service.create(input, context), hasStatus(409));
});
test('HU-014 new availability respects existing schedule blocks and holidays', async () => {
  const { service, tx } = fixture();
  tx.scheduleBlock.findMany.mock.mockImplementation(async () => [{ startsAt: new Date(input.startsAt), endsAt: new Date(input.endsAt) }]);
  assert.ok((await service.create(input, context)).data.slots.every((slot) => slot.status === 'BLOCKED'));
  tx.scheduleBlock.findMany.mock.mockImplementation(async () => []);
  tx.holiday.findMany.mock.mockImplementation(async () => [{ blocksEntireDay: true }]);
  assert.ok((await service.create(input, context)).data.slots.every((slot) => slot.status === 'BLOCKED'));
});
test('HU-014 update retires unused slots with optimistic concurrency and regenerates atomically', async () => {
  const { service, tx, record } = fixture();
  tx.agendaSlot.findMany.mock.mockImplementation(async () => [oldSlot]);
  await service.update(record.id, { startsAt: input.startsAt, endsAt: input.endsAt }, context);
  const args = tx.agendaSlot.updateMany.mock.calls[0].arguments[0];
  assert.equal(args.where.lockVersion, 0);
  assert.deepEqual(args.data, { status: 'EXPIRED', lockVersion: { increment: 1 } });
  assert.equal(tx.agendaSlot.upsert.mock.callCount(), 2);
});
test('HU-014 deactivate availability preserves slots without regenerating or deleting', async () => {
  const { service, tx, record } = fixture();
  tx.agendaSlot.findMany.mock.mockImplementation(async () => [oldSlot]);
  assert.equal((await service.update(record.id, { active: false }, context)).data.active, false);
  assert.equal(tx.agendaSlot.upsert.mock.callCount(), 0);
});
test('HU-014 protected appointments, RELEASED, RESERVED and BLOCKED prohibit availability edits', async () => {
  const { service, tx, record } = fixture();
  for (const overrides of [{ status: 'RELEASED' }, { status: 'RESERVED' }, { status: 'BLOCKED' }, { appointment: { id: randomUUID() } }, { reassignments: [{ id: randomUUID() }] }]) {
    tx.agendaSlot.findMany.mock.mockImplementation(async () => [{ ...oldSlot, ...overrides }]);
    await assert.rejects(service.update(record.id, { active: false }, context), hasStatus(409));
  }
});
test('HU-014 block records authenticated actor and conditionally blocks available slots', async () => {
  const { service, tx } = fixture();
  tx.agendaSlot.findMany.mock.mockImplementation(async () => [oldSlot]);
  await service.block({ branchId: input.branchId, startsAt: input.startsAt, endsAt: input.endsAt, type: 'MANUAL' }, context);
  assert.equal(tx.scheduleBlock.create.mock.calls[0].arguments[0].data.createdByUserId, context.userId);
  assert.deepEqual(tx.agendaSlot.updateMany.mock.calls[0].arguments[0].data, { status: 'BLOCKED', lockVersion: { increment: 1 } });
});
test('HU-014 equivalent blocks and booked intervals fail before block INSERT', async () => {
  const { service, tx } = fixture();
  const body = { branchId: input.branchId, startsAt: input.startsAt, endsAt: input.endsAt, type: 'MANUAL' };
  tx.scheduleBlock.findFirst.mock.mockImplementation(async () => ({ id: randomUUID() }));
  await assert.rejects(service.block(body, context), hasStatus(409));
  tx.scheduleBlock.findFirst.mock.mockImplementation(async () => null);
  tx.appointment.count.mock.mockImplementation(async () => 1);
  await assert.rejects(service.block(body, context), hasStatus(409));
  assert.equal(tx.scheduleBlock.create.mock.callCount(), 0);
});
test('HU-014 stale slot update fails the enclosing transaction', async () => {
  const { service, tx, record } = fixture();
  tx.agendaSlot.findMany.mock.mockImplementation(async () => [oldSlot]);
  tx.agendaSlot.updateMany.mock.mockImplementation(async () => ({ count: 0 }));
  await assert.rejects(service.update(record.id, { active: false }, context), hasStatus(409));
  assert.equal(tx.availability.update.mock.callCount(), 0);
});
test('HU-014 bounded serialization retry repeats the complete validation and detects winner', async () => {
  const { service, tx, prisma } = fixture();
  tx.availability.create.mock.mockImplementation(async () => { throw { code: 'P2034' }; });
  await assert.rejects(service.create(input, context), hasStatus(409));
  assert.equal(prisma.$transaction.mock.callCount(), 2);
  assert.equal(tx.userRole.count.mock.callCount(), 2);
});
test('HU-014 unique constraints map to conflict, unexpected SQL/programming errors do not', async () => {
  const { service, tx } = fixture();
  tx.availability.create.mock.mockImplementation(async () => { throw new Prisma.PrismaClientKnownRequestError('private', { code: 'P2002', clientVersion: '7' }); });
  await assert.rejects(service.create(input, context), hasStatus(409));
  const failure = new TypeError('private');
  tx.availability.create.mock.mockImplementation(async () => { throw failure; });
  await assert.rejects(service.create(input, context), (error) => error === failure);
});
