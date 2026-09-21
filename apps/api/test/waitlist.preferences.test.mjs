import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { parseWaitlistPreferences, parseWaitlistEntryParams } from '../dist/waitlist/waitlist.schemas.js';
import { WaitlistPreferencesService } from '../dist/waitlist/waitlist-preferences.service.js';

const empty = { preferredDays: [], timeRanges: [], preferredBranchIds: [], allowsOtherBranches: false, acceptsAnyProfessional: true };
const principal = { userId: randomUUID() };
const institutionId = randomUUID();
function setup(overrides = {}) {
  const entry = { id: randomUUID(), institutionId, serviceId: randomUUID(), updatedAt: new Date(),
    allowsOtherBranches: false, status: { code: 'ACTIVE', isFinal: false },
    service: { institutionId }, branch: null, preference: null, preferredBranches: [], ...overrides };
  let reads = 0; let writes = 0; let attempts = 0;
  const tx = {
    notification: { createMany: async () => ({ count: 1 }) },
    user: { findFirst: async () => ({ id: principal.userId }) },
    waitlistEntry: {
      findFirst: async ({ where }) => { reads++; assert.deepEqual(where, { id: entry.id, userId: principal.userId, deletedAt: null }); return entry; },
      update: async ({ data }) => { writes++; entry.updatedAt = data.updatedAt; entry.status = { code: 'WITHDRAWN', isFinal: true }; return entry; },
    },
    waitlistStatus: { findUnique: async () => ({ id: randomUUID(), active: true, isFinal: true }) },
  };
  const prisma = { $transaction: async (fn, options) => { attempts++; assert.equal(options.isolationLevel, 'Serializable'); return fn(tx); } };
  return { entry, tx, prisma, service: new WaitlistPreferencesService(prisma), counts: () => ({ reads, writes, attempts }) };
}

test('preferences accept ISO weekdays, adjacent wall-clock ranges and empty full replacement', () => {
  assert.deepEqual(parseWaitlistPreferences(empty, {}), empty);
  const body = { ...empty, preferredDays: [1, 7], timeRanges: [{ start: '08:00', end: '09:00' }, { start: '09:00', end: '10:00' }] };
  assert.deepEqual(parseWaitlistPreferences(body, {}), body);
});
const branch = randomUUID();
for (const [label, patch] of Object.entries({
  'duplicate days': { preferredDays: [1, 1] }, 'invalid day': { preferredDays: [0] },
  'fractional day': { preferredDays: [1.5] }, 'string day': { preferredDays: ['1'] },
  'duplicate branches': { preferredBranchIds: [branch, branch.toUpperCase()] },
  'invalid uuid': { preferredBranchIds: ['bad'] },
  'equal range': { timeRanges: [{ start: '10:00', end: '10:00' }] },
  'overnight range': { timeRanges: [{ start: '23:00', end: '01:00' }] },
  'invalid clock': { timeRanges: [{ start: '24:00', end: '25:00' }] },
  'duplicate ranges': { timeRanges: [{ start: '08:00', end: '09:00' }, { start: '08:00', end: '09:00' }] },
  'overlap': { timeRanges: [{ start: '09:00', end: '11:00' }, { start: '08:00', end: '10:00' }] },
  'nested extra': { timeRanges: [{ start: '08:00', end: '09:00', day: 1 }] },
  'owner override': { userId: randomUUID() }, 'institution override': { institutionId },
})) test(`preferences reject ${label}`, () => {
  assert.throws(() => parseWaitlistPreferences({ ...empty, ...patch }, {}), (e) => e.getStatus() === 400);
});
test('preferences reject partial body, query and invalid path UUID', () => {
  for (const fn of [() => parseWaitlistPreferences({}, {}), () => parseWaitlistPreferences(empty, { userId: principal.userId }), () => parseWaitlistEntryParams({ waitlistEntryId: 'bad' })]) {
    assert.throws(fn, (e) => e.getStatus() === 400);
  }
});
test('GET without preference is stable and read-only', async () => {
  const s = setup(); assert.deepEqual(await s.service.get(s.entry.id, principal), { data: empty });
  assert.equal(s.counts().writes, 0);
});
test('missing/foreign entry is 404 and inactive user is 401', async () => {
  const s = setup(); s.tx.waitlistEntry.findFirst = async () => null;
  await assert.rejects(s.service.get(s.entry.id, principal), (e) => e.getStatus() === 404);
  s.tx.user.findFirst = async () => null;
  await assert.rejects(s.service.get(s.entry.id, principal), (e) => e.getStatus() === 401);
});
test('final entries reject PUT and incompatible final withdrawal', async () => {
  const s = setup({ status: { code: 'OTHER', isFinal: true } });
  await assert.rejects(s.service.replace(s.entry.id, empty, principal), (e) => e.getStatus() === 409);
  await assert.rejects(s.service.withdraw(s.entry.id, principal), (e) => e.getStatus() === 409);
  assert.equal(s.counts().writes, 0);
});
test('withdraw persists once, preserves data and never updates twice', async () => {
  const s = setup(); const before = s.entry.updatedAt;
  const result = await s.service.withdraw(s.entry.id, principal);
  assert.deepEqual(result, { data: { id: s.entry.id, status: 'WITHDRAWN' } });
  assert.ok(s.entry.updatedAt > before);
  const stamp = s.entry.updatedAt;
  assert.deepEqual(await s.service.withdraw(s.entry.id, principal), result);
  assert.equal(s.entry.updatedAt, stamp); assert.equal(s.counts().writes, 1);
});
test('withdraw missing/incompatible catalog returns 503', async () => {
  for (const catalog of [null, { active: false, isFinal: true }, { active: true, isFinal: false }]) {
    const s = setup(); s.tx.waitlistStatus.findUnique = async () => catalog;
    await assert.rejects(s.service.withdraw(s.entry.id, principal), (e) => e.getStatus() === 503);
    assert.equal(s.counts().writes, 0);
  }
});
test('serialization retry repeats ownership read and observes winner withdrawal', async () => {
  const s = setup(); let failed = false;
  s.tx.waitlistEntry.update = async () => {
    assert.equal(failed, false); failed = true;
    s.entry.status = { code: 'WITHDRAWN', isFinal: true };
    throw { code: 'P2034' };
  };
  assert.equal((await s.service.withdraw(s.entry.id, principal)).data.status, 'WITHDRAWN');
  assert.equal(s.counts().reads, 2); assert.equal(s.counts().attempts, 2);
});
test('persistent conflict is 409; arbitrary storage errors remain sanitized 500', async () => {
  for (const [error, status, attempts] of [[{ code: 'P2034' }, 409, 2], [new Error('private detail'), 500, 1]]) {
    const s = setup(); s.tx.waitlistEntry.findFirst = async () => { throw error; };
    await assert.rejects(s.service.get(s.entry.id, principal), (e) => e.getStatus() === status && !e.message.includes('private detail'));
    assert.equal(s.counts().attempts, attempts);
  }
});

test('PUT validates branch scope and replaces children without changing entry origin fields', async () => {
  const s = setup(); const preferenceId = randomUUID(); const calls = [];
  const input = { ...empty, preferredDays: [1, 5], timeRanges: [{ start: '08:30', end: '12:00' }], preferredBranchIds: [branch], allowsOtherBranches: true, acceptsAnyProfessional: false };
  s.tx.branch = { findMany: async ({ where }) => {
    assert.deepEqual(where, { id: { in: [branch] }, institutionId, status: 'ACTIVE', deletedAt: null,
      serviceAssignments: { some: { serviceId: s.entry.serviceId, active: true } } });
    return [{ id: branch }];
  } };
  s.tx.waitlistPreference = { upsert: async ({ where, create, update }) => {
    assert.deepEqual(where, { waitlistEntryId: s.entry.id });
    assert.equal(create.waitlistEntryId, s.entry.id); assert.equal(create.acceptsAnyProfessional, false);
    assert.deepEqual(update, { acceptsAnyProfessional: false }); return { id: preferenceId };
  } };
  for (const model of ['waitlistPreferredDay', 'waitlistTimeRange', 'waitlistPreferredBranch']) {
    s.tx[model] = {
      deleteMany: async (args) => calls.push({ model, operation: 'delete', args }),
      createMany: async (args) => calls.push({ model, operation: 'create', args }),
    };
  }
  s.tx.waitlistEntry.update = async ({ data }) => {
    assert.deepEqual(Object.keys(data).sort(), ['allowsOtherBranches', 'updatedAt']);
    assert.ok(data.updatedAt > s.entry.updatedAt);
    return { ...s.entry, ...data, preference: { id: preferenceId, acceptsAnyProfessional: false,
      preferredDays: [{ dayOfWeek: 1 }, { dayOfWeek: 5 }], timeRanges: [{ startTime: new Date('1970-01-01T08:30:00Z'), endTime: new Date('1970-01-01T12:00:00Z') }] },
      preferredBranches: [{ branchId: branch, branch: { institutionId } }] };
  };
  assert.deepEqual(await s.service.replace(s.entry.id, input, principal), { data: input });
  assert.deepEqual(calls.map((c) => c.operation), ['delete', 'delete', 'delete', 'create', 'create', 'create']);
  assert.deepEqual(calls[5].args.data, [{ waitlistEntryId: s.entry.id, branchId: branch, preferenceOrder: 1 }]);
  assert.equal(calls[4].args.data[0].startTime.toISOString(), '1970-01-01T08:30:00.000Z');
});
test('PUT rejects invalid preferred branch before any preference write', async () => {
  const s = setup(); s.tx.branch = { findMany: async () => [] };
  await assert.rejects(s.service.replace(s.entry.id, { ...empty, preferredBranchIds: [branch] }, principal), (e) => e.getStatus() === 404);
  assert.equal(s.counts().writes, 0);
});
