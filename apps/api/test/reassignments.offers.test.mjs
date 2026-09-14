import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { compareCandidates, exclusionReason, localTime, preferenceSnapshot } from '../dist/reassignments/reassignments.policy.js';
import { ReassignmentsService } from '../dist/reassignments/reassignments.service.js';
import { ReassignmentsController } from '../dist/reassignments/reassignments.controller.js';
import { validateEnvironment } from '../dist/config/environment.validation.js';
import { ReassignmentSupervisionService, mapSupervision, supervisionSelect } from '../dist/reassignments/reassignment-supervision.service.js';

const now = new Date('2026-09-01T12:00:00Z');

function supervisionRecord() {
  const institutionId = randomUUID(); const serviceId = randomUUID(); const branchId = randomUUID();
  const slotId = randomUUID(); const appointmentId = randomUUID(); const candidateId = randomUUID(); const userId = randomUUID();
  return {
    id: randomUUID(), institutionId, serviceId, agendaSlotId: slotId, status: 'OFFERING',
    ruleCode: 'PRIORITY_FIFO_V1', scoringVersion: 'v1', initialSlotVersion: 1, lockVersion: 0, closureReasonCode: null,
    criteriaSnapshot: { timeZone: 'America/Santiago', actorUserId: userId, secret: 'PRIVATE_MARKER' },
    detectedAt: now, startedAt: now, finishedAt: null, createdAt: now, updatedAt: now,
    institution: { id: institutionId, name: 'Institution' }, service: { id: serviceId, name: 'Service', institutionId },
    originCancellation: { id: randomUUID(), appointmentId, cancelledAt: now, cancelledByUserId: userId },
    agendaSlot: { id: slotId, status: 'RELEASED', startsAt: now, endsAt: now, lockVersion: 2,
      availability: { serviceId, branch: { id: branchId, institutionId, name: 'Branch' } } },
    appointment: { id: appointmentId, institutionId, serviceId, branchId, agendaSlotId: slotId, userId,
      status: { code: 'CANCELADA' }, origin: 'WEB', startsAt: now, endsAt: now },
    candidates: [{ id: candidateId, userId, waitlistEntryId: randomUUID(), evaluationStatus: 'ELIGIBLE', rankingPosition: 1,
      exclusionReasonCode: null, evaluatedAt: now, createdAt: now, priorityLevelSnapshot: 0, entryUpdatedAtSnapshot: now,
      totalScore: { toString: () => '0' }, scoreFactors: [{ code: 'PRIORITY_LEVEL', value: 0, secret: 'PRIVATE_MARKER' }],
      evaluationContext: { statusCode: 'ACTIVE', operationalNote: 'PRIVATE_MARKER' }, waitlistEntry: { institutionId, serviceId } }],
    offers: [{ id: randomUUID(), candidateId, attemptNumber: 1, status: 'PENDING', expectedSlotVersion: 2, lockVersion: 0,
      createdAt: now, expiresAt: new Date(now.getTime() + 600000), respondedAt: null, resolvedAt: null,
      respondedByUserId: null, resolutionReasonCode: null }],
  };
}
test('HU-016 mapper exposes controlled trace, ISO dates, decimal string and no arbitrary JSON', () => {
  const record = supervisionRecord(); const detail = mapSupervision(record, now).data;
  assert.equal(detail.activeOfferId, record.offers[0].id); assert.equal(detail.pendingOfferId, record.offers[0].id);
  assert.equal(detail.candidates[0].snapshot.totalScore, '0'); assert.equal(detail.detectedAt, now.toISOString());
  assert.equal(detail.offers[0].recipient.id, record.candidates[0].userId);
  assert.equal(detail.evaluation.initiation.kind, 'AUTHORIZED_REQUEST');
  assert.ok(!JSON.stringify(detail).includes('PRIVATE_MARKER')); assert.equal(detail.service.institutionId, undefined);
  assert.equal(supervisionSelect.appointment.select.operationalNote, undefined);
  assert.equal(supervisionSelect.candidates.select.user, undefined);
});
test('HU-016 active offer is derived without rewriting expired PENDING status', () => {
  const record = supervisionRecord();
  const detail = mapSupervision(record, record.offers[0].expiresAt).data;
  assert.equal(detail.activeOfferId, null); assert.equal(detail.pendingOfferId, record.offers[0].id);
  assert.equal(detail.offers[0].status, 'PENDING'); assert.equal(record.offers[0].status, 'PENDING');
  record.status = 'COMPLETED'; assert.equal(mapSupervision(record, now).data.activeOfferId, null);
});
test('HU-016 service uses consistent read-only scope and deterministic orders without catalog activity filters', async () => {
  const record = supervisionRecord(); let calls = 0;
  const context = { userId: randomUUID(), institutionId: record.institutionId, branchId: record.appointment.branchId, permissions: ['reassignments.read'], roleCodes: [] };
  const service = new ReassignmentSupervisionService({ $transaction: async (fn, options) => {
    assert.equal(options.isolationLevel, 'RepeatableRead');
    return fn({ reassignment: { findFirst: async ({ where, select }) => {
      calls++; assert.deepEqual(where, { id: record.id, institutionId: context.institutionId,
        agendaSlot: { availability: { branchId: context.branchId } } });
      assert.deepEqual(select.candidates.orderBy, [{ rankingPosition: { sort: 'asc', nulls: 'last' } }, { id: 'asc' }]);
      assert.deepEqual(select.offers.orderBy, [{ attemptNumber: 'asc' }, { id: 'asc' }]);
      assert.ok(!JSON.stringify(where).includes('active')); return record;
    } } });
  } });
  assert.equal((await service.getDetail(record.id, context)).data.id, record.id); assert.equal(calls, 1);
});
test('HU-016 denies missing permission/context before persistence', async () => {
  const service = new ReassignmentSupervisionService({});
  for (const context of [{ institutionId: randomUUID(), permissions: [] }, { permissions: ['reassignments.read'] }]) {
    await assert.rejects(service.getDetail(randomUUID(), context), (e) => e.getStatus() === 403);
  }
});
test('HU-016 returns identical 404 for absent records or inconsistent institutional links', async () => {
  for (const relation of ['missing', 'service', 'appointment', 'candidate']) {
    const record = supervisionRecord(); const context = { institutionId: record.institutionId, permissions: ['reassignments.read'] };
    if (relation === 'service') record.service.institutionId = randomUUID();
    if (relation === 'appointment') record.appointment.institutionId = randomUUID();
    if (relation === 'candidate') record.candidates[0].waitlistEntry.institutionId = randomUUID();
    const service = new ReassignmentSupervisionService({ $transaction: (fn) => fn({ reassignment: { findFirst: async () => relation === 'missing' ? null : record } }) });
    await assert.rejects(service.getDetail(record.id, context), (e) => e.getStatus() === 404 && e.message === 'Reassignment not found');
  }
});
test('HU-016 unexpected storage failures return sanitized 500', async () => {
  const service = new ReassignmentSupervisionService({ $transaction: async () => { throw new Error('PRIVATE_MARKER'); } });
  await assert.rejects(service.getDetail(randomUUID(), { institutionId: randomUUID(), permissions: ['reassignments.read'] }),
    (e) => e.getStatus() === 500 && !e.message.includes('PRIVATE_MARKER'));
});
test('HU-016 controller authenticates, rejects query/body/UUID extras and uses read permission metadata', () => {
  const id = randomUUID(); const context = { institutionId: randomUUID(), permissions: ['reassignments.read'] };
  const controller = new ReassignmentsController({}, { getDetail: (entryId, authorization) => ({ entryId, authorization }) });
  const request = { principal: { userId: randomUUID() }, authorization: context };
  assert.deepEqual(controller.getDetail({ reassignmentId: id }, {}, undefined, request), { entryId: id, authorization: context });
  for (const [params, query, body] of [[{ reassignmentId: 'bad' }, {}, undefined], [{ reassignmentId: id }, { userId: id }, undefined], [{ reassignmentId: id }, {}, { force: true }]]) {
    assert.throws(() => controller.getDetail(params, query, body, request), (e) => e.getStatus() === 400);
  }
  assert.throws(() => controller.getDetail({ reassignmentId: id }, {}, undefined, {}), (e) => e.getStatus() === 401);
  const metadata = Reflect.getMetadataKeys(controller.getDetail).map((key) => Reflect.getMetadata(key, controller.getDetail));
  assert.ok(metadata.some((value) => Array.isArray(value) && value.includes('reassignments.read')));
});
const slot = { institutionId: randomUUID(), serviceId: randomUUID(), branchId: randomUUID(), sourceUserId: randomUUID(),
  startsAt: new Date('2026-09-07T14:00:00Z'), endsAt: new Date('2026-09-07T14:30:00Z'), timeZone: 'America/Santiago' };
const entry = () => ({ id: randomUUID(), institutionId: slot.institutionId, serviceId: slot.serviceId, userId: randomUUID(),
  branchId: slot.branchId, branch: { institutionId: slot.institutionId }, priorityId: randomUUID(),
  priority: { institutionId: slot.institutionId, code: 'STANDARD', active: true, level: 0 },
  enteredAt: new Date('2026-08-01T12:00:00Z'), updatedAt: now, status: { id: randomUUID(), code: 'ACTIVE', isFinal: false },
  user: { status: 'ACTIVE', deletedAt: null }, minimumNoticeMinutes: 0, deadlineDate: null, allowsOtherBranches: false, preferredBranches: [],
  preference: { acceptsAnyProfessional: true, acceptsAnyTime: false, acceptsWeekend: false,
    preferredDays: [{ dayOfWeek: 1 }], timeRanges: [{ startTime: new Date('1970-01-01T10:00:00Z'), endTime: new Date('1970-01-01T12:00:00Z') }] } });
test('compatible entry uses institutional wall-clock time, ISO day and complete slot interval', () => {
  assert.deepEqual(localTime(slot.startsAt, slot.timeZone), { date: '2026-09-07', weekday: 1, seconds: 11 * 3600 });
  assert.equal(exclusionReason(entry(), slot, now), null);
});
for (const [name, change, reason] of [
  ['different service', (e) => e.serviceId = randomUUID(), 'INCOHERENT_CONTEXT'],
  ['different institution', (e) => e.institutionId = randomUUID(), 'INCOHERENT_CONTEXT'],
  ['cancelled owner', (e) => e.userId = slot.sourceUserId, 'SOURCE_USER'],
  ['inactive user', (e) => e.user.status = 'PENDING', 'USER_UNAVAILABLE'],
  ['deleted user', (e) => e.user.deletedAt = now, 'USER_UNAVAILABLE'],
  ['global priority', (e) => e.priority.institutionId = null, 'PRIORITY_UNAVAILABLE'],
  ['inactive priority', (e) => e.priority.active = false, 'PRIORITY_UNAVAILABLE'],
  ['specific professional', (e) => e.preference.acceptsAnyProfessional = false, 'SPECIFIC_PROFESSIONAL_UNDEFINED'],
  ['missing preference', (e) => e.preference = null, 'PREFERENCES_UNDEFINED'],
  ['no branch consent', (e) => e.branchId = null, 'BRANCH_INCOMPATIBLE'],
  ['empty days', (e) => e.preference.preferredDays = [], 'DAYS_UNDEFINED'],
  ['wrong day', (e) => e.preference.preferredDays = [{ dayOfWeek: 2 }], 'DAY_INCOMPATIBLE'],
  ['empty ranges', (e) => e.preference.timeRanges = [], 'TIME_UNDEFINED'],
  ['wrong range', (e) => e.preference.timeRanges[0].endTime = new Date('1970-01-01T10:30:00Z'), 'TIME_INCOMPATIBLE'],
  ['deadline', (e) => e.deadlineDate = new Date('2026-09-06T00:00:00Z'), 'DEADLINE_EXCEEDED'],
  ['minimum notice', (e) => e.minimumNoticeMinutes = 999999, 'INSUFFICIENT_NOTICE'],
]) test(`excludes ${name} with stable reason`, () => { const e = entry(); change(e); assert.equal(exclusionReason(e, slot, now), reason); });
test('branch consent, explicit preferred branch and explicit any-time are respected', () => {
  const e = entry(); e.branchId = null; e.allowsOtherBranches = true;
  assert.equal(exclusionReason(e, slot, now), null);
  e.allowsOtherBranches = false; e.preferredBranches = [{ branchId: slot.branchId, branch: { institutionId: slot.institutionId } }];
  assert.equal(exclusionReason(e, slot, now), null);
  e.preference.timeRanges = []; e.preference.acceptsAnyTime = true;
  assert.equal(exclusionReason(e, slot, now), null);
});
test('explicit weekend choice is preserved despite legacy default acceptsWeekend=false', () => {
  const e = entry(); e.preference.preferredDays = [{ dayOfWeek: 7 }];
  assert.equal(exclusionReason(e, { ...slot, startsAt: new Date('2026-09-13T14:00:00Z'), endsAt: new Date('2026-09-13T14:30:00Z') }, now), null);
});
test('ranking is configured level ASC, enteredAt ASC then UUID ASC', () => {
  const a = entry(); const b = entry(); b.priority.level = 1;
  assert.ok(compareCandidates(a, b) < 0); b.priority.level = 0; b.enteredAt = new Date('2026-08-02T12:00:00Z');
  assert.ok(compareCandidates(a, b) < 0); b.enteredAt = a.enteredAt;
  a.id = '00000000-0000-4000-8000-000000000001'; b.id = '00000000-0000-4000-8000-000000000002';
  assert.ok(compareCandidates(a, b) < 0);
});
test('snapshot is JSON-safe and remains independent of subsequent preference edits', () => {
  const e = entry(); const snapshot = preferenceSnapshot(e); e.preference.preferredDays[0].dayOfWeek = 3;
  assert.deepEqual(snapshot.preferences.preferredDays, [1]);
  assert.equal(snapshot.enteredAt, e.enteredAt.toISOString()); assert.equal(snapshot.statusCode, 'ACTIVE');
  assert.deepEqual(JSON.parse(JSON.stringify(snapshot)), snapshot);
});
test('TTL defaults to 10, coerces configured positive integer and rejects invalid values', () => {
  const env = { DATABASE_URL: 'postgresql://USER:PASSWORD@localhost/DATABASE', JWT_ACCESS_SECRET: 'a'.repeat(32), JWT_REFRESH_SECRET: 'b'.repeat(32) };
  assert.equal(validateEnvironment(env).WAITLIST_OFFER_TTL_MINUTES, 10);
  assert.equal(validateEnvironment({ ...env, WAITLIST_OFFER_TTL_MINUTES: '15' }).WAITLIST_OFFER_TTL_MINUTES, 15);
  for (const value of ['0', '-1', '1.5', 'NaN', '']) assert.throws(() => validateEnvironment({ ...env, WAITLIST_OFFER_TTL_MINUTES: value }), /WAITLIST_OFFER_TTL_MINUTES/);
});
test('controller rejects missing identity, arbitrary body/query and missing context', () => {
  const controller = new ReassignmentsController({
    generate: (id, context) => ({ id, context }),
    acceptOffer: (id, principal) => ({ id, principal }),
    rejectOffer: (id, principal) => ({ id, principal }),
  });
  const request = { principal: { userId: randomUUID() }, authorization: { userId: randomUUID(), institutionId: slot.institutionId, permissions: ['reassignments.generate'] } };
  const params = { agendaSlotId: randomUUID() };
  assert.equal(controller.generate(params, {}, undefined, request).id, params.agendaSlotId);
  for (const [p, q, b, r, status] of [[params, {}, undefined, {}, 401], [params, { userId: 'x' }, undefined, request, 400],
    [params, {}, { ttl: 10 }, request, 400], [{ agendaSlotId: 'bad' }, {}, undefined, request, 400],
    [params, {}, undefined, { ...request, authorization: { ...request.authorization, institutionId: undefined } }, 400]]) {
    assert.throws(() => controller.generate(p, q, b, r), (e) => e.getStatus() === status);
  }

  const offerId = randomUUID();
  const selfRequest = { principal: { userId: randomUUID(), sessionId: randomUUID() } };
  assert.equal(controller.accept({ offerId }, {}, undefined, selfRequest).id, offerId);
  for (const [p, q, b, r, status] of [
    [{ offerId }, {}, undefined, {}, 401],
    [{ offerId }, { userId: 'x' }, undefined, selfRequest, 400],
    [{ offerId }, {}, { userId: 'x' }, selfRequest, 400],
    [{ offerId: 'bad' }, {}, undefined, selfRequest, 400],
  ]) {
    assert.throws(() => controller.accept(p, q, b, r), (e) => e.getStatus() === status);
  }

  assert.equal(controller.reject({ offerId }, {}, undefined, selfRequest).id, offerId);
  for (const [p, q, b, r, status] of [
    [{ offerId }, {}, undefined, {}, 401],
    [{ offerId }, { userId: 'x' }, undefined, selfRequest, 400],
    [{ offerId }, {}, { userId: 'x' }, selfRequest, 400],
    [{ offerId: 'bad' }, {}, undefined, selfRequest, 400],
  ]) {
    assert.throws(() => controller.reject(p, q, b, r), (e) => e.getStatus() === status);
  }
});
test('transaction retry is complete, bounded, and does not mask unexpected SQL errors', async () => {
  for (const [error, expected, count] of [[{ code: 'P2034' }, 409, 2], [new Error('secret storage detail'), 500, 1]]) {
    let attempts = 0;
    const prisma = { $transaction: async (_fn, options) => { attempts++; assert.equal(options.isolationLevel, 'Serializable'); throw error; } };
    const service = new ReassignmentsService(prisma, {});
    await assert.rejects(service.generate(randomUUID(), {}), (e) => e.getStatus() === expected && !e.message.includes('secret'));
    assert.equal(attempts, count);
  }
});

test('acceptance transaction retry is bounded and storage errors remain sanitized', async () => {
  const principal = { userId: randomUUID(), sessionId: randomUUID() };
  for (const [error, expected, count] of [[{ code: 'P2034' }, 409, 2], [new Error('private acceptance storage detail'), 500, 1]]) {
    let attempts = 0;
    const prisma = { $transaction: async (_fn, options) => { attempts++; assert.equal(options.isolationLevel, 'Serializable'); throw error; } };
    const service = new ReassignmentsService(prisma, {});
    await assert.rejects(service.acceptOffer(randomUUID(), principal), (e) => e.getStatus() === expected && !e.message.includes('private'));
    assert.equal(attempts, count);
  }
});

test('rejection transaction retry is bounded and storage errors remain sanitized', async () => {
  const principal = { userId: randomUUID(), sessionId: randomUUID() };
  for (const [error, expected, count] of [[{ code: 'P2034' }, 409, 2], [new Error('private rejection storage detail'), 500, 1]]) {
    let attempts = 0;
    const prisma = { $transaction: async (_fn, options) => { attempts++; assert.equal(options.isolationLevel, 'Serializable'); throw error; } };
    const service = new ReassignmentsService(prisma, {});
    await assert.rejects(service.rejectOffer(randomUUID(), principal), (e) => e.getStatus() === expected && !e.message.includes('private'));
    assert.equal(attempts, count);
  }
});
