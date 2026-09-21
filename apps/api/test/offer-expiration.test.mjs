import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { ReassignmentsService } from '../dist/reassignments/reassignments.service.js';

function fixture() {
  const institutionId = randomUUID(), branchId = randomUUID(), serviceId = randomUUID(), professionalId = randomUUID();
  const slotId = randomUUID(), sourceUserId = randomUUID(), recipientId = randomUUID(), entryId = randomUUID();
  const now = new Date(); const startsAt = new Date(+now + 86_400_000); startsAt.setUTCHours(12, 0, 0, 0);
  const endsAt = new Date(+startsAt + 1_800_000);
  const state = { offers: [], audit: [], candidates: [], availabilityCount: 1 };
  state.slot = { id: slotId, status: 'RELEASED', lockVersion: 3, startsAt, endsAt, blockedUntilAt: null,
    availability: { id: randomUUID(), branchId, serviceId, professionalId, attentionPointId: null,
      branch: { institutionId, institution: { timeZone: 'UTC' } } },
    appointment: { id: randomUUID(), institutionId, branchId, serviceId, professionalId, attentionPointId: null,
      agendaSlotId: slotId, userId: sourceUserId, deletedAt: null, startsAt, endsAt, status: { code: 'CANCELADA', isFinal: true } } };
  state.process = { id: randomUUID(), institutionId, appointmentId: state.slot.appointment.id, agendaSlotId: slotId,
    serviceId, sourceUserId, status: 'OFFERING', lockVersion: 0, policy: { offerTtlMinutes: 7 } };
  state.offer = { id: randomUUID(), reassignmentId: state.process.id, candidateId: randomUUID(), agendaSlotId: slotId,
    attemptNumber: 1, status: 'PENDING', expectedSlotVersion: 3, expiresAt: new Date(+now - 1000),
    respondedAt: null, respondedByUserId: null, resolvedAt: null, lockVersion: 0,
    candidate: { id: randomUUID(), userId: recipientId, waitlistEntryId: entryId, evaluationStatus: 'ELIGIBLE', rankingPosition: 1 } };
  state.entry = { userId: recipientId, institutionId, serviceId };
  function candidate() {
    const id = randomUUID(), userId = randomUUID();
    return { id, userId, waitlistEntryId: randomUUID(), rankingPosition: 2, entryUpdatedAtSnapshot: now,
      waitlistEntry: { id: randomUUID(), userId, institutionId, serviceId, branchId, updatedAt: now, minimumNoticeMinutes: 0,
        deadlineDate: null, allowsOtherBranches: false, user: { status: 'ACTIVE', deletedAt: null },
        priority: { institutionId, active: true }, preferredBranches: [],
        preference: { acceptsAnyProfessional: true, acceptsAnyTime: true,
          preferredDays: [1,2,3,4,5,6,7].map((dayOfWeek) => ({ dayOfWeek })), timeRanges: [] } } };
  }
  state.candidates.push(candidate());
  let failAt; const queries = []; let transactions = 0;
  const prisma = { $transaction: async (work, options) => {
    transactions++; assert.equal(options.isolationLevel, 'Serializable');
    const working = structuredClone(state);
    const tx = {
    notification: { createMany: async () => ({ count: 1 }) },
      appointmentOffer: {
        findUnique: async () => ({ ...structuredClone(working.offer), reassignment: structuredClone(working.process) }),
        updateMany: async ({ where, data }) => {
          assert.equal(where.status, 'PENDING'); assert.equal(where.lockVersion, working.offer.lockVersion);
          assert.ok(working.offer.expiresAt <= where.expiresAt.lte);
          Object.assign(working.offer, data, { lockVersion: working.offer.lockVersion + 1 }); return { count: 1 };
        },
        count: async () => 0,
        create: async ({ data }) => { working.offers.push(data); if (failAt === 'offer') throw new Error('storage failed'); return { id: data.id }; },
      },
      agendaSlot: { findUnique: async () => structuredClone(working.slot), count: async () => 1 },
      availability: { count: async () => working.availabilityCount },
      waitlistEntry: { findUnique: async () => working.entry },
      reassignmentCandidate: { findMany: async (query) => { queries.push(query); return working.candidates; } },
      reassignment: { updateMany: async ({ data }) => {
        Object.assign(working.process, data); if (failAt === 'process') throw new Error('storage failed'); return { count: 1 };
      } },
      auditEvent: { create: async ({ data }) => { working.audit.push(data); if (failAt === 'audit') throw new Error('storage failed'); return { id: data.id }; } },
    };
    const result = await work(tx); Object.assign(state, working); return result;
  } };
  return { state, candidate, queries, prisma, service: new ReassignmentsService(prisma, { getOrThrow: () => 10 }),
    fail: (stage) => { failAt = stage; }, transactions: () => transactions };
}

test('expiry leaves current and every terminal offer untouched', async () => {
  for (const status of ['PENDING', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'INVALIDATED', 'CANCELLED']) {
    const f = fixture(); f.state.offer.status = status;
    f.state.offer.expiresAt = new Date(Date.now() + (status === 'PENDING' ? 60_000 : -60_000));
    const before = structuredClone(f.state); await f.service.expireOffer(f.state.offer.id); assert.deepEqual(f.state, before);
  }
});

test('expiry equality persists EXPIRED without human response, advances once with bound TTL and minimal SYSTEM audit', async (t) => {
  const f = fixture(); const now = Date.now(); f.state.offer.expiresAt = new Date(now);
  t.mock.timers.enable({ apis: ['Date'], now });
  const result = await f.service.expireOffer(f.state.offer.id);
  assert.deepEqual(result, { status: 'EXPIRED', processStatus: 'OFFERING' });
  assert.equal(f.state.offer.status, 'EXPIRED'); assert.equal(+f.state.offer.resolvedAt, now);
  assert.equal(f.state.offer.respondedAt, null); assert.equal(f.state.offer.respondedByUserId, null);
  assert.equal(f.state.offer.lockVersion, 1); assert.equal(f.state.offers.length, 1);
  assert.equal(f.state.offers[0].attemptNumber, 2); assert.equal(f.state.offers[0].expectedSlotVersion, 3);
  assert.equal(f.state.offers[0].expiresAt - f.state.offers[0].createdAt, 7 * 60_000);
  assert.deepEqual(f.state.audit.map((e) => e.actionCode), ['OFFER_EXPIRED', 'OFFER_CREATED']);
  const event = f.state.audit[0];
  assert.equal(event.actorType, 'SYSTEM'); assert.equal(event.actorUserId, null);
  assert.equal(event.institutionId, f.state.process.institutionId); assert.equal(event.branchId, f.state.slot.availability.branchId);
  assert.equal(event.reasonCode, 'OFFER_TTL_ELAPSED');
  for (const key of ['email','password','passwordHash','accessToken','refreshToken','authorization','cookie','body']) assert.ok(!(key in event));
  const before = structuredClone(f.state); await f.service.expireOffer(f.state.offer.id); assert.deepEqual(f.state, before);
});

test('continuation skips changed snapshots and incompatible candidates; scopes later unused/open entries', async () => {
  const f = fixture(); const changed = f.candidate(); changed.waitlistEntry.updatedAt = new Date(0);
  const incompatible = f.candidate(); incompatible.waitlistEntry.user.status = 'INACTIVE';
  const foreign = f.candidate(); foreign.waitlistEntry.institutionId = randomUUID();
  f.state.candidates.unshift(changed, incompatible, foreign);
  await f.service.expireOffer(f.state.offer.id);
  assert.equal(f.state.offers[0].candidateId, f.state.candidates[3].id);
  assert.deepEqual(f.queries[0].where, { reassignmentId: f.state.process.id, evaluationStatus: 'ELIGIBLE',
    rankingPosition: { gt: 1 }, offers: { none: {} }, waitlistEntry: { deletedAt: null, status: { isFinal: false } } });
});

test('valid process with no candidates is EXHAUSTED and legacy continuation keeps configured TTL', async () => {
  const f = fixture(); f.state.candidates = [];
  await f.service.expireOffer(f.state.offer.id);
  assert.equal(f.state.process.status, 'EXHAUSTED'); assert.ok(f.state.process.finishedAt);
  assert.equal(f.state.process.closureReasonCode, 'CANDIDATES_EXHAUSTED_AFTER_EXPIRATION');
  assert.equal(f.state.offers.length, 0); assert.equal(f.state.audit[1].actionCode, 'REASSIGNMENT_EXHAUSTED');
  const legacy = fixture(); legacy.state.process.policy = null; await legacy.service.expireOffer(legacy.state.offer.id);
  assert.equal(legacy.state.offers[0].expiresAt - legacy.state.offers[0].createdAt, 600_000);
});

test('normal slot/context changes CANCEL without rebasing expected version or transferring the appointment', async () => {
  for (const patch of [
    (s) => { s.slot.startsAt = new Date(0); }, (s) => { s.slot.status = 'RESERVED'; },
    (s) => { s.slot.lockVersion++; }, (s) => { s.slot.blockedUntilAt = new Date(Date.now() + 60_000); },
    (s) => { s.slot.appointment.deletedAt = new Date(); },
    (s) => { s.slot.availability.serviceId = randomUUID(); },
  ]) {
    const f = fixture(); patch(f.state); const slot = structuredClone(f.state.slot);
    await f.service.expireOffer(f.state.offer.id);
    assert.equal(f.state.process.status, 'CANCELLED'); assert.equal(f.state.offers.length, 0);
    assert.equal(f.state.offer.expectedSlotVersion, 3); assert.deepEqual(f.state.slot, slot);
  }
});

test('real relational incoherence becomes FAILED without repairing relations', async () => {
  const f = fixture(); f.state.slot.appointment.institutionId = randomUUID();
  const slot = structuredClone(f.state.slot); await f.service.expireOffer(f.state.offer.id);
  assert.equal(f.state.process.status, 'FAILED'); assert.equal(f.state.process.closureReasonCode, 'REASSIGNMENT_INVARIANT_VIOLATION');
  assert.equal(f.state.offer.status, 'EXPIRED'); assert.equal(f.state.offers.length, 0); assert.deepEqual(f.state.slot, slot);
});

test('inconsistent pending offer never rewrites a terminal process', async () => {
  const f = fixture(); f.state.process.status = 'COMPLETED'; const before = structuredClone(f.state);
  await assert.rejects(f.service.expireOffer(f.state.offer.id), (e) => e.getStatus() === 409); assert.deepEqual(f.state, before);
});

test('persistence failures rollback offer/continuation/process/audit and can be retried later', async () => {
  for (const stage of ['offer','process','audit']) {
    const f = fixture(); if (stage === 'process') f.state.candidates = [];
    const before = structuredClone(f.state); f.fail(stage);
    await assert.rejects(f.service.expireOffer(f.state.offer.id), (e) => e.getStatus() === 500);
    assert.deepEqual(f.state, before); f.fail(null); await f.service.expireOffer(f.state.offer.id);
    assert.equal(f.state.offer.status, 'EXPIRED');
  }
});

test('serialization/deadlock retries are bounded; infrastructure errors never become FAILED', async () => {
  for (const error of [{ code: 'P2034' }, { name: 'DriverAdapterError', cause: { kind: 'TransactionWriteConflict', originalCode: '40P01' } }, new Error('offline')]) {
    const f = fixture(); const before = structuredClone(f.state); let calls = 0;
    f.prisma.$transaction = async () => { calls++; throw error; };
    await assert.rejects(f.service.expireOffer(f.state.offer.id)); assert.equal(calls, error instanceof Error ? 1 : 2);
    assert.deepEqual(f.state, before);
  }
});
