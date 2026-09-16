import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mock, test } from 'node:test';
import { RequestMethod } from '@nestjs/common';
import { GUARDS_METADATA, HTTP_CODE_METADATA, METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { AccessTokenGuard } from '../dist/auth/guards/access-token.guard.js';
import { AppointmentsController } from '../dist/appointments/appointments.controller.js';
import { AppointmentsService } from '../dist/appointments/appointments.service.js';

const hasStatus = (status) => (error) => error?.getStatus?.() === status;

function setup(options = {}) {
  const principal = { userId: randomUUID(), sessionId: randomUUID() };
  const context = {
    institutionId: randomUUID(), branchId: randomUUID(),
    serviceId: randomUUID(), professionalId: randomUUID(),
  };
  const slot = {
    id: randomUUID(), status: 'RESERVED', lockVersion: 3,
    availability: {
      branchId: context.branchId, serviceId: context.serviceId,
      professionalId: context.professionalId,
      branch: { institutionId: context.institutionId },
    },
    ...options.slot,
  };
  const appointment = {
    id: randomUUID(), ...context, userId: principal.userId, deletedAt: null,
    agendaSlotId: slot.id, statusId: randomUUID(),
    startsAt: new Date('2099-01-01T10:00:00.000Z'),
    endsAt: new Date('2099-01-01T10:30:00.000Z'),
    origin: 'WEB', operationalNote: 'private', createdByUserId: principal.userId,
    status: { code: 'AGENDADA', active: true, isFinal: false, allowsCancellation: true, ...options.status },
    branch: { id: context.branchId, institutionId: context.institutionId, name: 'Branch', email: 'private@example.com' },
    service: { id: context.serviceId, institutionId: context.institutionId, name: 'Service', active: true },
    professional: {
      id: context.professionalId, institutionId: context.institutionId, internalCode: 'private',
      user: { firstNames: 'Ana', lastNames: 'Perez', email: 'private@example.com' },
    },
    ...options.appointment,
  };
  const cancelledStatus = {
    id: randomUUID(), code: 'CANCELADA', active: true, isFinal: true,
    allowsCancellation: false, allowsConfirmation: false, ...options.cancelledStatus,
  };
  const state = { appointment, slot, cancellations: [], history: [], audit: [] };
  const original = structuredClone(state);
  let working;
  let transactionAttempt = 0;
  const tx = {
    auditEvent: { create: mock.fn(async ({ data }) => { working.audit.push(data); return { id: data.id }; }) },
    user: { findFirst: mock.fn(async () => options.userMissing ? null : { id: principal.userId }) },
    appointment: {
      findFirst: mock.fn(async ({ where }) => {
        if (options.missing || where.id !== working.appointment.id ||
            where.userId !== working.appointment.userId || working.appointment.deletedAt !== null) return null;
        return { ...structuredClone(working.appointment), agendaSlot: structuredClone(working.slot) };
      }),
      updateMany: mock.fn(async ({ where, data }) => {
        if (options.appointmentConflict || where.statusId !== working.appointment.statusId ||
            where.userId !== working.appointment.userId) return { count: 0 };
        working.appointment.statusId = data.statusId;
        working.appointment.status = structuredClone(cancelledStatus);
        return { count: 1 };
      }),
    },
    appointmentStatus: {
      findUnique: mock.fn(async () => options.catalogMissing ? null : cancelledStatus),
    },
    agendaSlot: {
      updateMany: mock.fn(async ({ where, data }) => {
        options.beforeRelease?.(working);
        if (where.status !== working.slot.status || where.lockVersion !== working.slot.lockVersion ||
            where.appointment.is.userId !== working.appointment.userId) return { count: 0 };
        Object.assign(working.slot, { status: data.status, lockVersion: working.slot.lockVersion + data.lockVersion.increment });
        return { count: 1 };
      }),
    },
    cancellation: {
      create: mock.fn(async ({ data }) => {
        if (options.cancellationError) throw options.cancellationError;
        working.cancellations.push(data);
        return { id: data.id };
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
      const commitError = options.commitErrors ? options.commitErrors[transactionAttempt++] : options.commitError;
      if (commitError) throw commitError;
      Object.assign(state, working);
      return result;
    }),
  };
  return {
    principal, state, original, tx, prisma, cancelledStatus,
    service: new AppointmentsService(prisma),
  };
}

test('cancellation controller is authenticated POST with 200 and delegates only id/principal', async () => {
  const response = { data: { status: 'CANCELADA' } };
  const cancel = mock.fn(async () => response);
  const controller = new AppointmentsController({ cancel });
  const principal = { userId: randomUUID(), sessionId: randomUUID() };
  const appointmentId = randomUUID();
  const handler = AppointmentsController.prototype.cancel;
  assert.deepEqual(Reflect.getMetadata(GUARDS_METADATA, AppointmentsController), [AccessTokenGuard]);
  assert.equal(Reflect.getMetadata(PATH_METADATA, handler), ':appointmentId/cancel');
  assert.equal(Reflect.getMetadata(METHOD_METADATA, handler), RequestMethod.POST);
  assert.equal(Reflect.getMetadata(HTTP_CODE_METADATA, handler), 200);
  assert.deepEqual(await controller.cancel({ appointmentId }, {}, undefined, { principal }), response);
  assert.deepEqual(cancel.mock.calls[0].arguments, [appointmentId, principal]);
  assert.throws(() => controller.cancel({ appointmentId }, {}, undefined, {}), hasStatus(401));
  assert.equal(cancel.mock.callCount(), 1);
});

test('cancellation rejects invalid ids and any query/body/param identity or functional fields', () => {
  const cancel = mock.fn();
  const controller = new AppointmentsController({ cancel });
  const request = { principal: { userId: randomUUID(), sessionId: randomUUID() } };
  const params = { appointmentId: randomUUID() };
  for (const invalid of [{}, { appointmentId: 'bad' }, { ...params, userId: randomUUID() }]) {
    assert.throws(() => controller.cancel(invalid, {}, undefined, request), hasStatus(400));
  }
  for (const fields of [{ userId: randomUUID() }, { institutionId: randomUUID() }, { status: 'CANCELADA' }, { reason: 'text' }]) {
    assert.throws(() => controller.cancel(params, fields, undefined, request), hasStatus(400));
    assert.throws(() => controller.cancel(params, {}, fields, request), hasStatus(400));
  }
  assert.equal(cancel.mock.callCount(), 0);
});

test('cancellation atomically preserves appointment/owner/slot link, releases once and records actor and states', async () => {
  const { service, principal, state, original, tx, prisma, cancelledStatus } = setup();
  const id = state.appointment.id;
  assert.deepEqual(await service.cancel(id, principal), {
    data: {
      id, institutionId: original.appointment.institutionId, status: 'CANCELADA',
      startsAt: original.appointment.startsAt.toISOString(),
      endsAt: original.appointment.endsAt.toISOString(), origin: 'WEB',
      branch: { id: original.appointment.branchId, name: 'Branch' },
      service: { id: original.appointment.serviceId, name: 'Service' },
      professional: { id: original.appointment.professionalId, firstNames: 'Ana', lastNames: 'Perez' },
    },
  });
  assert.deepEqual(prisma.$transaction.mock.calls[0].arguments[1], { isolationLevel: 'Serializable' });
  assert.deepEqual(tx.appointment.findFirst.mock.calls[0].arguments[0].where, { id, userId: principal.userId, deletedAt: null });
  assert.equal(state.appointment.id, original.appointment.id);
  assert.equal(state.appointment.userId, principal.userId);
  assert.equal(state.appointment.agendaSlotId, original.slot.id);
  assert.equal(state.appointment.deletedAt, null);
  assert.equal(state.appointment.statusId, cancelledStatus.id);
  assert.equal(state.slot.status, 'RELEASED');
  assert.equal(state.slot.lockVersion, original.slot.lockVersion + 1);
  assert.deepEqual(tx.agendaSlot.updateMany.mock.calls[0].arguments[0].where, {
    id: original.slot.id, status: 'RESERVED', lockVersion: original.slot.lockVersion,
    appointment: { is: { id, userId: principal.userId, deletedAt: null, statusId: original.appointment.statusId } },
  });
  assert.deepEqual(tx.appointment.updateMany.mock.calls[0].arguments[0], {
    where: {
      id, userId: principal.userId, deletedAt: null, agendaSlotId: original.slot.id,
      statusId: original.appointment.statusId,
      status: { code: 'AGENDADA', active: true, isFinal: false, allowsCancellation: true },
    },
    data: { statusId: cancelledStatus.id },
  });
  assert.equal(state.cancellations.length, 1);
  const { id: cancellationId, ...cancellation } = state.cancellations[0];
  assert.match(cancellationId, /^[0-9a-f-]{36}$/);
  assert.deepEqual(cancellation, { appointmentId: id, cancelledByUserId: principal.userId, releasesSlot: true });
  assert.equal(state.history.length, 1);
  const { id: historyId, ...history } = state.history[0];
  assert.match(historyId, /^[0-9a-f-]{36}$/);
  assert.deepEqual(history, {
    appointmentId: id, previousStatusId: original.appointment.statusId, newStatusId: cancelledStatus.id,
    previousUserId: principal.userId, newUserId: principal.userId, actorUserId: principal.userId,
  });
});

test('cancellation returns identical 404 for missing, deleted and foreign-owned appointments without writes', async () => {
  for (const options of [{ missing: true }, { appointment: { deletedAt: new Date() } }, { appointment: { userId: randomUUID() } }]) {
    const { service, principal, state, original } = setup(options);
    await assert.rejects(service.cancel(state.appointment.id, principal), (error) =>
      error.getStatus() === 404 && error.message === 'Appointment not found');
    assert.deepEqual(state, original);
  }
});

test('cancellation revalidates an active undeleted user inside the transaction', async () => {
  const { service, principal, state, original, tx } = setup({ userMissing: true });
  await assert.rejects(service.cancel(state.appointment.id, principal), hasStatus(401));
  assert.equal(tx.appointment.findFirst.mock.callCount(), 0);
  assert.deepEqual(state, original);
});

test('cancellation hides incoherent tenant and slot relationships without writes', async () => {
  const scenarios = ['branch', 'service', 'professional'].map((key) => (state) => {
    state.appointment[key].institutionId = randomUUID();
  });
  for (const key of ['branchId', 'serviceId', 'professionalId']) {
    scenarios.push((state) => { state.slot.availability[key] = randomUUID(); });
  }
  scenarios.push((state) => { state.slot.availability.branch.institutionId = randomUUID(); });
  for (const mutate of scenarios) {
    const { service, principal, state } = setup();
    mutate(state);
    const before = structuredClone(state);
    await assert.rejects(service.cancel(state.appointment.id, principal), hasStatus(404));
    assert.deepEqual(state, before);
  }
});

test('cancellation only accepts active non-final AGENDADA with allowsCancellation enabled', async () => {
  for (const status of [{ code: 'OTHER_STATE' }, { active: false }, { isFinal: true }, { allowsCancellation: false }]) {
    const { service, principal, state, original } = setup({ status });
    await assert.rejects(service.cancel(state.appointment.id, principal), hasStatus(409));
    assert.deepEqual(state, original);
  }
});

test('cancellation requires RESERVED and never changes AVAILABLE, RELEASED, BLOCKED or EXPIRED slots', async () => {
  for (const status of ['AVAILABLE', 'RELEASED', 'BLOCKED', 'EXPIRED']) {
    const { service, principal, state, original } = setup({ slot: { status } });
    await assert.rejects(service.cancel(state.appointment.id, principal), hasStatus(409));
    assert.deepEqual(state, original);
  }
});

test('cancellation retries on CANCELADA succeed without another history, cancellation or version increment', async () => {
  const { service, principal, state, tx } = setup();
  const response = await service.cancel(state.appointment.id, principal);
  const before = structuredClone(state);
  assert.deepEqual(await service.cancel(state.appointment.id, principal), response);
  assert.deepEqual(state, before);
  assert.equal(tx.agendaSlot.updateMany.mock.callCount(), 1);
  assert.equal(tx.cancellation.create.mock.callCount(), 1);
  assert.equal(tx.appointmentHistory.create.mock.callCount(), 1);
});

test('already CANCELADA returns its public DTO without provisioning or validating a new transition', async () => {
  const { service, principal, state, original, tx } = setup({
    status: { code: 'CANCELADA', active: false, isFinal: true, allowsCancellation: false },
    slot: { status: 'RELEASED' }, catalogMissing: true,
  });
  const response = await service.cancel(state.appointment.id, principal);
  assert.equal(response.data.id, state.appointment.id);
  assert.equal(response.data.status, 'CANCELADA');
  assert.deepEqual(Object.keys(response.data).sort(), [
    'id', 'institutionId', 'status', 'startsAt', 'endsAt', 'origin', 'branch', 'service', 'professional',
  ].sort());
  assert.equal(tx.appointmentStatus.findUnique.mock.callCount(), 0);
  assert.equal(tx.agendaSlot.updateMany.mock.callCount(), 0);
  assert.equal(tx.appointment.updateMany.mock.callCount(), 0);
  assert.equal(tx.cancellation.create.mock.callCount(), 0);
  assert.equal(tx.appointmentHistory.create.mock.callCount(), 0);
  assert.deepEqual(state, original);
});

test('cancellation fails with controlled 503 for missing or incompatible CANCELADA configuration', async () => {
  for (const options of [
    { catalogMissing: true }, { cancelledStatus: { active: false } }, { cancelledStatus: { isFinal: false } },
    { cancelledStatus: { allowsCancellation: true } }, { cancelledStatus: { allowsConfirmation: true } },
  ]) {
    const { service, principal, state, original, tx } = setup(options);
    await assert.rejects(service.cancel(state.appointment.id, principal), hasStatus(503));
    assert.equal(tx.agendaSlot.updateMany.mock.callCount(), 0);
    assert.deepEqual(state, original);
  }
});

test('cancellation stale version, slot state or ownership conflicts roll back', async () => {
  for (const beforeRelease of [
    (state) => { state.slot.lockVersion++; },
    (state) => { state.slot.status = 'BLOCKED'; },
    (state) => { state.appointment.userId = randomUUID(); },
  ]) {
    const { service, principal, state, original } = setup({ beforeRelease });
    await assert.rejects(service.cancel(state.appointment.id, principal), hasStatus(409));
    assert.deepEqual(state, original);
  }
});

test('cancellation rolls back the slot when the conditional appointment update loses the race', async () => {
  const { service, principal, state, original } = setup({ appointmentConflict: true });
  await assert.rejects(service.cancel(state.appointment.id, principal), hasStatus(409));
  assert.deepEqual(state, original);
});

test('cancellation rolls back every write if cancellation or history storage fails without leaking errors', async () => {
  for (const key of ['cancellationError', 'historyError']) {
    const { service, principal, state, original } = setup({ [key]: new Error('private-storage-details') });
    await assert.rejects(service.cancel(state.appointment.id, principal), (error) =>
      error.getStatus() === 500 && error.message === 'Unable to cancel appointment');
    assert.deepEqual(state, original);
  }
});

test('cancellation maps serialization and structural conflicts to 409 with complete rollback', async () => {
  for (const code of ['P2034', 'P2002', 'P2003']) {
    const { service, principal, state, original, prisma } = setup({ commitError: { code } });
    await assert.rejects(service.cancel(state.appointment.id, principal), hasStatus(409));
    assert.deepEqual(state, original);
    assert.equal(prisma.$transaction.mock.callCount(), code === 'P2034' ? 2 : 1);
  }
});

test('cancellation retries one rolled-back serialization failure in a fresh transaction', async () => {
  const { service, principal, state, original, prisma } = setup({ commitErrors: [{ code: 'P2034' }] });
  const response = await service.cancel(state.appointment.id, principal);
  assert.equal(response.data.status, 'CANCELADA');
  assert.equal(prisma.$transaction.mock.callCount(), 2);
  assert.equal(state.slot.lockVersion, original.slot.lockVersion + 1);
  assert.equal(state.cancellations.length, 1);
  assert.equal(state.history.length, 1);
  for (const call of prisma.$transaction.mock.calls) {
    assert.deepEqual(call.arguments[1], { isolationLevel: 'Serializable' });
  }
});
