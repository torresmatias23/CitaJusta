import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mock, test } from 'node:test';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { AccessTokenGuard } from '../dist/auth/guards/access-token.guard.js';
import { AppointmentsController } from '../dist/appointments/appointments.controller.js';
import { AppointmentsService } from '../dist/appointments/appointments.service.js';
import { availableAvailabilityWhere } from '../dist/availability/availability.policy.js';

const hasStatus = (status) => (error) => error?.getStatus?.() === status;

function setup(options = {}) {
  const principal = { userId: randomUUID(), sessionId: randomUUID() };
  const initial = {
    id: randomUUID(),
    startsAt: new Date(Date.now() + 3_600_000),
    endsAt: new Date(Date.now() + 7_200_000),
    status: 'AVAILABLE',
    lockVersion: 4,
    blockedUntilAt: null,
    appointment: null,
    availability: {
      branchId: randomUUID(), serviceId: randomUUID(),
      professionalId: randomUUID(), attentionPointId: null,
      branch: { institutionId: randomUUID() },
    },
    ...options.slot,
  };
  const initialStatus = { id: randomUUID(), code: 'AGENDADA', active: true, isFinal: false };
  const state = { slot: structuredClone(initial), appointments: [], history: [], audit: [] };
  let working;
  const tx = {
    notification: { createMany: async () => ({ count: 1 }) },
    auditEvent: { create: mock.fn(async ({ data }) => { working.audit.push(data); return { id: data.id }; }) },
    user: { findFirst: mock.fn(async () => options.userMissing ? null : { id: principal.userId }) },
    agendaSlot: {
      findUnique: mock.fn(async () => options.slotMissing ? null : structuredClone(working.slot)),
      findFirst: mock.fn(async () => options.invalidContext ? null : { id: initial.id }),
      updateMany: mock.fn(async ({ where, data }) => {
        if (options.beforeWrite) await options.beforeWrite(working);
        if (options.conflict || working.slot.lockVersion !== where.lockVersion ||
            working.slot.status !== where.status || working.slot.startsAt <= where.startsAt.gt) {
          return { count: 0 };
        }
        working.slot.status = data.status;
        working.slot.lockVersion += data.lockVersion.increment;
        return { count: 1 };
      }),
    },
    appointmentStatus: {
      findUnique: mock.fn(async () => options.statusMissing ? null : { ...initialStatus, ...options.status }),
    },
    appointment: {
      create: mock.fn(async ({ data }) => {
        if (options.createError) throw options.createError;
        working.appointments.push(data);
        return { ...data, operationalNote: 'private', deletedAt: null, statusId: initialStatus.id };
      }),
    },
    appointmentHistory: {
      create: mock.fn(async ({ data }) => {
        if (options.historyError) throw options.historyError;
        working.history.push(data);
        return { id: data.id };
      }),
    },
  };
  const prisma = {
    $transaction: mock.fn(async (callback) => {
      working = structuredClone(state);
      const result = await callback(tx);
      if (options.commitError) throw options.commitError;
      Object.assign(state, working);
      return result;
    }),
  };
  return { service: new AppointmentsService(prisma), prisma, tx, state, initial, initialStatus, principal };
}

test('booking controller authenticates and delegates only slot id and principal', async () => {
  assert.deepEqual(Reflect.getMetadata(GUARDS_METADATA, AppointmentsController), [AccessTokenGuard]);
  const reserve = mock.fn(async () => ({ data: {} }));
  const controller = new AppointmentsController({ reserve });
  const agendaSlotId = randomUUID();
  const principal = { userId: randomUUID(), sessionId: randomUUID() };
  await controller.reserve({ agendaSlotId }, {
    principal, headers: { 'x-institution-id': randomUUID(), 'x-user-id': randomUUID() },
  });
  assert.deepEqual(reserve.mock.calls[0].arguments, [agendaSlotId, principal]);
});

test('booking rejects missing authentication and body identity, origin or unknown fields', () => {
  const reserve = mock.fn();
  const controller = new AppointmentsController({ reserve });
  const agendaSlotId = randomUUID();
  const request = { principal: { userId: randomUUID(), sessionId: randomUUID() } };
  assert.throws(() => controller.reserve({ agendaSlotId }, {}), hasStatus(401));
  for (const body of [null, {}, [], { agendaSlotId: 'invalid' },
    { agendaSlotId, userId: randomUUID() }, { agendaSlotId, origin: 'WEB' },
    { agendaSlotId, institutionId: randomUUID() }, { agendaSlotId, lockVersion: 1 },
    { agendaSlotId, status: 'AGENDADA' }]) {
    assert.throws(() => controller.reserve(body, request), hasStatus(400));
  }
  assert.equal(reserve.mock.callCount(), 0);
});

test('booking creates AGENDADA with server-owned identity, WEB origin and initial history atomically', async () => {
  const f = setup();
  const result = await f.service.reserve(f.initial.id, f.principal);
  assert.equal(f.prisma.$transaction.mock.calls[0].arguments[1].isolationLevel, 'Serializable');
  assert.deepEqual(f.tx.user.findFirst.mock.calls[0].arguments[0].where, {
    id: f.principal.userId, status: 'ACTIVE', deletedAt: null,
  });
  assert.equal(f.state.slot.status, 'RESERVED');
  assert.equal(f.state.slot.lockVersion, 5);
  assert.equal(f.state.appointments.length, 1);
  const appointment = f.state.appointments[0];
  assert.equal(appointment.agendaSlotId, f.initial.id);
  assert.equal(appointment.userId, f.principal.userId);
  assert.equal(appointment.createdByUserId, f.principal.userId);
  assert.equal(appointment.origin, 'WEB');
  assert.equal(appointment.statusId, f.initialStatus.id);
  assert.equal(appointment.institutionId, f.initial.availability.branch.institutionId);
  assert.equal(appointment.branchId, f.initial.availability.branchId);
  assert.equal(appointment.serviceId, f.initial.availability.serviceId);
  assert.equal(appointment.professionalId, f.initial.availability.professionalId);
  assert.equal(f.state.history.length, 1);
  const history = f.state.history[0];
  assert.equal(history.appointmentId, appointment.id);
  assert.equal(history.previousStatusId, null);
  assert.equal(history.newStatusId, f.initialStatus.id);
  assert.equal(history.previousUserId, null);
  assert.equal(history.newUserId, f.principal.userId);
  assert.equal(history.actorUserId, f.principal.userId);
  assert.equal(result.data.status, 'AGENDADA');
});

test('booking response contains only the controlled appointment DTO', async () => {
  const f = setup();
  const { data } = await f.service.reserve(f.initial.id, f.principal);
  assert.deepEqual(Object.keys(data).sort(), [
    'id', 'agendaSlotId', 'institutionId', 'branchId', 'serviceId',
    'professionalId', 'startsAt', 'endsAt', 'origin', 'status',
  ].sort());
  assert.equal(data.startsAt, f.initial.startsAt.toISOString());
  assert.equal(data.endsAt, f.initial.endsAt.toISOString());
});

test('booking returns 404 for a nonexistent slot without any writes', async () => {
  const f = setup({ slotMissing: true });
  await assert.rejects(f.service.reserve(f.initial.id, f.principal), hasStatus(404));
  assert.equal(f.tx.agendaSlot.updateMany.mock.callCount(), 0);
});

test('booking rejects a user deactivated after authentication within the transaction', async () => {
  const f = setup({ userMissing: true });
  await assert.rejects(f.service.reserve(f.initial.id, f.principal), hasStatus(401));
  assert.equal(f.tx.agendaSlot.findUnique.mock.callCount(), 0);
});

test('booking rejects inactive or incoherent institutional relations before writes', async () => {
  const f = setup({ invalidContext: true });
  await assert.rejects(f.service.reserve(f.initial.id, f.principal), hasStatus(404));
  assert.equal(f.tx.agendaSlot.updateMany.mock.callCount(), 0);
});

test('booking and availability enforce the same tenant, assignment and attention-point policy', async () => {
  const f = setup();
  await f.service.reserve(f.initial.id, f.principal);
  const context = {
    institutionId: f.initial.availability.branch.institutionId,
    branchId: f.initial.availability.branchId,
    serviceId: f.initial.availability.serviceId,
  };
  const predicate = availableAvailabilityWhere(context, f.initial.availability.professionalId);
  const readWhere = f.tx.agendaSlot.findFirst.mock.calls[0].arguments[0].where;
  const writeWhere = f.tx.agendaSlot.updateMany.mock.calls[0].arguments[0].where;
  assert.deepEqual(readWhere.availability, predicate);
  assert.deepEqual(writeWhere.availability, predicate);
  assert.equal(predicate.branch.institutionId, context.institutionId);
  assert.equal(predicate.service.institutionId, context.institutionId);
  assert.equal(predicate.professional.institutionId, context.institutionId);
  assert.equal(writeWhere.lockVersion, f.initial.lockVersion);
  assert.equal(writeWhere.status, 'AVAILABLE');
  assert.deepEqual(writeWhere.appointment, { is: null });
  assert.ok(writeWhere.startsAt.gt instanceof Date);
});

test('booking rejects every non-AVAILABLE slot and a future temporary block', async () => {
  for (const slot of [
    ...['RESERVED', 'BLOCKED', 'RELEASED', 'EXPIRED'].map((status) => ({ status })),
    { blockedUntilAt: new Date(Date.now() + 60_000) },
  ]) {
    const f = setup({ slot });
    await assert.rejects(f.service.reserve(f.initial.id, f.principal), hasStatus(409));
    assert.equal(f.tx.agendaSlot.updateMany.mock.callCount(), 0);
  }
});

test('booking accepts an elapsed temporary block', async () => {
  const f = setup({ slot: { blockedUntilAt: new Date(Date.now() - 1000) } });
  await f.service.reserve(f.initial.id, f.principal);
  assert.equal(f.state.slot.status, 'RESERVED');
});

test('booking rejects past slots and invalid intervals', async () => {
  for (const slot of [
    { startsAt: new Date(Date.now() - 1000) },
    { endsAt: new Date(Date.now() - 1000) },
  ]) {
    const f = setup({ slot });
    await assert.rejects(f.service.reserve(f.initial.id, f.principal), hasStatus(409));
    assert.equal(f.tx.agendaSlot.updateMany.mock.callCount(), 0);
  }
});

test('booking never replaces an existing appointment even if its slot is AVAILABLE', async () => {
  const f = setup({ slot: { appointment: { id: randomUUID() } } });
  await assert.rejects(f.service.reserve(f.initial.id, f.principal), hasStatus(409));
  assert.equal(f.tx.appointment.create.mock.callCount(), 0);
});

test('booking fails safely for a missing, inactive or final AGENDADA without bootstrapping it', async () => {
  for (const options of [{ statusMissing: true }, { status: { active: false } }, { status: { isFinal: true } }]) {
    const f = setup(options);
    await assert.rejects(f.service.reserve(f.initial.id, f.principal), hasStatus(503));
    assert.equal(f.tx.agendaSlot.updateMany.mock.callCount(), 0);
    assert.equal(f.state.appointments.length, 0);
  }
});

test('booking returns conflict when lockVersion, slot status or start time changes before the write', async () => {
  for (const beforeWrite of [
    (working) => { working.slot.lockVersion++; },
    (working) => { working.slot.status = 'RESERVED'; },
    (working) => { working.slot.startsAt = new Date(Date.now() - 1000); },
  ]) {
    const f = setup({ beforeWrite });
    await assert.rejects(f.service.reserve(f.initial.id, f.principal), hasStatus(409));
    assert.equal(f.tx.appointment.create.mock.callCount(), 0);
    assert.equal(f.state.history.length, 0);
  }
});

test('booking rolls back the slot after a UNIQUE or foreign-key conflict', async () => {
  for (const code of ['P2002', 'P2003']) {
    const f = setup({ createError: { code } });
    await assert.rejects(f.service.reserve(f.initial.id, f.principal), hasStatus(409));
    assert.equal(f.tx.agendaSlot.updateMany.mock.callCount(), 1);
    assert.deepEqual(f.state.slot, f.initial);
    assert.equal(f.state.appointments.length, 0);
    assert.equal(f.state.history.length, 0);
  }
});

test('booking maps serialization conflicts to 409 and rolls back all records', async () => {
  const f = setup({ commitError: { code: 'P2034' } });
  await assert.rejects(f.service.reserve(f.initial.id, f.principal), hasStatus(409));
  assert.deepEqual(f.state.slot, f.initial);
  assert.equal(f.state.appointments.length, 0);
  assert.equal(f.state.history.length, 0);
});

test('booking rolls back appointment and slot if history fails, without exposing storage errors', async () => {
  const f = setup({ historyError: new Error('sensitive-storage-detail') });
  await assert.rejects(f.service.reserve(f.initial.id, f.principal), (error) => {
    assert.equal(error.getStatus(), 500);
    assert.equal(JSON.stringify(error.getResponse()).includes('sensitive-storage-detail'), false);
    return true;
  });
  assert.equal(f.tx.appointment.create.mock.callCount(), 1);
  assert.deepEqual(f.state.slot, f.initial);
  assert.equal(f.state.appointments.length, 0);
  assert.equal(f.state.history.length, 0);
});
