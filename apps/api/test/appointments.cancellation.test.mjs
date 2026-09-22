import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mock, test } from 'node:test';
import { RequestMethod } from '@nestjs/common';
import { GUARDS_METADATA, HTTP_CODE_METADATA, METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { AccessTokenGuard } from '../dist/auth/guards/access-token.guard.js';
import { AppointmentsController } from '../dist/appointments/appointments.controller.js';
import { AppointmentsService } from '../dist/appointments/appointments.service.js';
import { ReassignmentsService } from '../dist/reassignments/reassignments.service.js';

const hasStatus = (status) => (error) => error?.getStatus?.() === status;

function setup(options = {}) {
  const principal = { userId: randomUUID(), sessionId: randomUUID() };
  const context = {
    institutionId: randomUUID(), branchId: randomUUID(),
    serviceId: randomUUID(), professionalId: randomUUID(),
  };
  const slot = {
    id: randomUUID(), status: 'RESERVED', lockVersion: 3,
    startsAt: new Date('2099-01-01T10:00:00.000Z'), endsAt: new Date('2099-01-01T10:30:00.000Z'), blockedUntilAt: null,
    availability: {
      branchId: context.branchId, serviceId: context.serviceId,
      id: randomUUID(), professionalId: context.professionalId, attentionPointId: null,
      branch: { institutionId: context.institutionId, institution: { timeZone: 'UTC', currentReassignmentPolicy: null } },
    },
    ...options.slot,
  };
  const appointment = {
    id: randomUUID(), ...context, userId: principal.userId, deletedAt: null,
    agendaSlotId: slot.id, statusId: randomUUID(), attentionPointId: null,
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
  const state = { appointment, slot, cancellations: [], history: [], audit: [], processes: [], candidates: [], offers: [], notifications: [], entries: [] };
  const original = structuredClone(state);
  let working;
  let transactionAttempt = 0;
  const tx = {
    notification: { createMany: async ({ data }) => {
      working.notifications.push(...data);
      if (options.notificationError && data[0].type === 'OFFER_CREATED') throw options.notificationError;
      return { count: data.length };
    } },
    auditEvent: { create: mock.fn(async ({ data }) => { working.audit.push(data); return { id: data.id }; }) },
    user: { findFirst: mock.fn(async () => options.userMissing ? null : { id: principal.userId }) },
    userRole: { count: async () => options.noGrant ? 0 : 1 },
    availability: { count: async () => options.unavailable ? 0 : 1 },
    waitlistEntry: { findMany: async () => {
      options.afterEvaluation?.();
      return structuredClone(working.entries);
    } },
    reassignment: {
      count: async () => working.processes.length,
      create: async ({ data }) => { working.processes.push(data); return data; },
    },
    reassignmentCandidate: { createMany: async ({ data }) => {
      working.candidates.push(...data.map((row) => ({ ...row, totalScore: row.totalScore?.toString() ?? null })));
      return { count: data.length };
    } },
    appointmentOffer: {
      count: async () => working.offers.filter((offer) => offer.status === 'PENDING').length,
      create: async ({ data }) => { working.offers.push(data); return { id: data.id }; },
    },
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
      findFirst: async ({ where, include }) => {
        if (where.id !== working.slot.id || where.availability.branch.institutionId !== context.institutionId ||
          (where.availability.branchId && where.availability.branchId !== context.branchId)) return null;
        const cancellationId = include.appointment.include.cancellations.where.id;
        return { ...structuredClone(working.slot), appointment: { ...structuredClone(working.appointment),
          cancellations: working.cancellations.filter((row) => !cancellationId || row.id === cancellationId).slice(-1) } };
      },
      updateMany: mock.fn(async ({ where, data }) => {
        if (where.status === 'RESERVED') options.beforeRelease?.(working);
        if (where.status !== working.slot.status || where.lockVersion !== working.slot.lockVersion ||
            (where.appointment && where.appointment.is.userId !== working.appointment.userId)) return { count: 0 };
        Object.assign(working.slot, { ...data, lockVersion: working.slot.lockVersion + data.lockVersion.increment });
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
    principal, context, state, original, tx, prisma, cancelledStatus,
    service: new AppointmentsService(prisma, { getOrThrow: () => 10 }),
    manual: new ReassignmentsService(prisma, { getOrThrow: () => 10 }),
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
  assert.equal(state.slot.lockVersion, original.slot.lockVersion + 2);
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
  assert.equal(tx.agendaSlot.updateMany.mock.callCount(), 2);
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
  assert.equal(state.slot.lockVersion, original.slot.lockVersion + 2);
  assert.equal(state.cancellations.length, 1);
  assert.equal(state.history.length, 1);
  for (const call of prisma.$transaction.mock.calls) {
    assert.deepEqual(call.arguments[1], { isolationLevel: 'Serializable' });
  }
});

function eligible(f, level = 1) {
  return { id: randomUUID(), userId: randomUUID(), ...f.context, priorityId: randomUUID(),
    enteredAt: new Date('2026-01-01T12:00:00Z'), updatedAt: new Date('2026-01-01T12:00:00Z'),
    deadlineDate: null, minimumNoticeMinutes: 0, allowsOtherBranches: false,
    status: { id: randomUUID(), code: 'ACTIVE', isFinal: false }, user: { status: 'ACTIVE', deletedAt: null },
    priority: { institutionId: f.context.institutionId, code: 'STANDARD', level, active: true },
    branch: { institutionId: f.context.institutionId }, preferredBranches: [],
    preference: { acceptsAnyProfessional: true, acceptsAnyTime: true, acceptsWeekend: true,
      preferredDays: [1,2,3,4,5,6,7].map((dayOfWeek) => ({ dayOfWeek })), timeRanges: [] } };
}

test('HU-025 cancellation starts first offer with original ranking, SYSTEM audit and recipient notification', async () => {
  const f = setup(); const first = eligible(f, 1), second = eligible(f, 2); f.state.entries.push(second, first);
  await f.service.cancel(f.state.appointment.id, f.principal);
  assert.equal(f.state.processes.length, 1); assert.equal(f.state.offers.length, 1);
  const process = f.state.processes[0], offer = f.state.offers[0];
  assert.equal(process.status, 'OFFERING'); assert.equal(process.originCancellationId, f.state.cancellations[0].id);
  assert.equal(process.initialSlotVersion, f.original.slot.lockVersion + 1);
  assert.equal(process.criteriaSnapshot.actorUserId, null);
  assert.equal(offer.expectedSlotVersion, f.state.slot.lockVersion); assert.equal(offer.attemptNumber, 1);
  assert.equal(offer.expiresAt - offer.createdAt, 600000);
  const winner = f.state.candidates.find((row) => row.id === offer.candidateId);
  assert.equal(winner.userId, first.userId); assert.equal(winner.rankingPosition, 1);
  for (const event of f.state.audit) {
    assert.equal(event.actorType, event.actionCode === 'APPOINTMENT_CANCELLED' ? 'USER' : 'SYSTEM');
    assert.equal(event.actorUserId, event.actionCode === 'APPOINTMENT_CANCELLED' ? f.principal.userId : null);
  }
  assert.deepEqual(f.state.audit.map((row) => row.actionCode), ['APPOINTMENT_CANCELLED', 'REASSIGNMENT_STARTED', 'OFFER_CREATED']);
  assert.equal(f.state.notifications.find((row) => row.type === 'OFFER_CREATED').recipientUserId, first.userId);
  const before = structuredClone(f.state); await f.service.cancel(f.state.appointment.id, f.principal); assert.deepEqual(f.state, before);
});
test('HU-025 no eligible entries creates one EXHAUSTED process with no offer under replay', async () => {
  const f = setup(); const excluded = eligible(f); excluded.userId = f.principal.userId; f.state.entries.push(excluded);
  await f.service.cancel(f.state.appointment.id, f.principal);
  assert.equal(f.state.processes.length, 1); assert.equal(f.state.processes[0].status, 'EXHAUSTED');
  assert.equal(f.state.candidates[0].exclusionReasonCode, 'SOURCE_USER'); assert.equal(f.state.offers.length, 0);
  assert.equal(f.state.audit.at(-1).actionCode, 'REASSIGNMENT_EXHAUSTED'); assert.equal(f.state.audit.at(-1).actorType, 'SYSTEM');
  const before = structuredClone(f.state); await f.service.cancel(f.state.appointment.id, f.principal); assert.deepEqual(f.state, before);
});
test('HU-025 past, blocked or inactive contexts cancel successfully without partial reassignment', async () => {
  for (const options of [{ slot: { startsAt: new Date(0) } }, { slot: { blockedUntilAt: new Date('2100-01-01') } }, { unavailable: true }]) {
    const f = setup(options); await f.service.cancel(f.state.appointment.id, f.principal);
    assert.equal(f.state.appointment.status.code, 'CANCELADA'); assert.equal(f.state.cancellations.length, 1);
    assert.equal(f.state.processes.length, 0); assert.equal(f.state.offers.length, 0); assert.equal(f.state.candidates.length, 0);
    assert.equal(f.state.slot.lockVersion, f.original.slot.lockVersion + 1);
  }
});
test('HU-025 expiry during evaluation skips auto start before process/candidate/offer writes', async (t) => {
  const f = setup({ afterEvaluation: () => t.mock.timers.enable({ apis: ['Date'], now: +new Date('2100-01-01') }) });
  f.state.entries.push(eligible(f)); await f.service.cancel(f.state.appointment.id, f.principal);
  assert.equal(f.state.cancellations.length, 1); assert.equal(f.state.processes.length, 0); assert.equal(f.state.offers.length, 0);
});
test('HU-025 first offer notification failure rolls back cancellation, process, offer, audits and history', async () => {
  const f = setup({ notificationError: new Error('private failure') }); f.state.entries.push(eligible(f));
  const before = structuredClone(f.state); await assert.rejects(f.service.cancel(f.state.appointment.id, f.principal), hasStatus(500));
  assert.deepEqual(f.state, before);
});
test('HU-025 manual start preserves permission/scope/errors and USER actor after blocked release is unblocked', async () => {
  const f = setup({ slot: { blockedUntilAt: new Date('2100-01-01') } }); f.state.entries.push(eligible(f));
  await f.service.cancel(f.state.appointment.id, f.principal);
  const context = { ...f.context, userId: f.principal.userId, permissions: ['reassignments.generate'] };
  await assert.rejects(f.manual.generate(f.state.slot.id, { ...context, permissions: [] }), hasStatus(403));
  await assert.rejects(f.manual.generate(f.state.slot.id, { ...context, institutionId: randomUUID() }), hasStatus(404));
  await assert.rejects(f.manual.generate(f.state.slot.id, { ...context, branchId: randomUUID() }), hasStatus(404));
  await assert.rejects(f.manual.generate(f.state.slot.id, context), hasStatus(409));
  f.state.slot.blockedUntilAt = null;
  const result = await f.manual.generate(f.state.slot.id, context);
  assert.equal(result.data.status, 'OFFERING'); assert.ok(result.data.offer);
  assert.equal(f.state.audit.find((row) => row.actionCode === 'REASSIGNMENT_STARTED').actorType, 'USER');
  const before = structuredClone(f.state); await assert.rejects(f.manual.generate(f.state.slot.id, context), hasStatus(409)); assert.deepEqual(f.state, before);
});
test('HU-025 adapter serialization/deadlock retries the whole cancellation once, without duplicate effects', async () => {
  for (const originalCode of ['40001', '40P01']) {
    const f = setup({ commitErrors: [{ name: 'DriverAdapterError', cause: { kind: 'TransactionWriteConflict', originalCode } }] });
    f.state.entries.push(eligible(f)); await f.service.cancel(f.state.appointment.id, f.principal);
    assert.equal(f.prisma.$transaction.mock.callCount(), 2); assert.equal(f.state.cancellations.length, 1);
    assert.equal(f.state.processes.length, 1); assert.equal(f.state.offers.length, 1);
  }
});
