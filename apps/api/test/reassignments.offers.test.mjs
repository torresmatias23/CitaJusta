import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { compareCandidates, exclusionReason, localTime, preferenceSnapshot } from '../dist/reassignments/reassignments.policy.js';
import { ReassignmentsService } from '../dist/reassignments/reassignments.service.js';
import { ReassignmentsController } from '../dist/reassignments/reassignments.controller.js';
import { validateEnvironment } from '../dist/config/environment.validation.js';

const now = new Date('2026-09-01T12:00:00Z');
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
