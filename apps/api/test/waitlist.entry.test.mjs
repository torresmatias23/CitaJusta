import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mock, test } from 'node:test';
import { WaitlistService } from '../dist/waitlist/waitlist.service.js';
import { WaitlistController } from '../dist/waitlist/waitlist.controller.js';
import { parseWaitlistEntry, parseWaitlistListing } from '../dist/waitlist/waitlist.schemas.js';
import { isTransactionConflict } from '../dist/database/transaction-conflict.js';

const hasStatus = (status) => (error) => error?.getStatus?.() === status;
function setup() {
  const principal = { userId: randomUUID(), sessionId: randomUUID() };
  const service = { id: randomUUID(), institutionId: randomUUID(), allowsWaitlist: true };
  const status = { id: randomUUID(), active: true, isFinal: false };
  const priority = { id: randomUUID(), active: true };
  const branch = { id: randomUUID() };
  const row = {
    id: randomUUID(), institutionId: service.institutionId, enteredAt: new Date('2026-09-01T10:00:00Z'),
    status: { code: 'ACTIVE' }, service: { ...service, name: 'Atención general' }, branch: null,
  };
  const tx = {
    notification: { createMany: async () => ({ count: 1 }) },
    user: { findFirst: mock.fn(async () => ({ id: principal.userId })) },
    service: { findFirst: mock.fn(async () => service) },
    branch: { findFirst: mock.fn(async () => branch) },
    waitlistStatus: { findUnique: mock.fn(async () => status) },
    priority: { findUnique: mock.fn(async () => priority) },
    waitlistEntry: {
      findFirst: mock.fn(async () => null),
      create: mock.fn(async ({ data }) => ({ ...row, id: data.id,
        branch: data.branchId ? { id: data.branchId, institutionId: service.institutionId, name: 'Sucursal' } : null })),
      findMany: mock.fn(async () => [row]),
    },
  };
  const prisma = { ...tx, $transaction: mock.fn(async (fn, options) => {
    assert.deepEqual(options, { isolationLevel: 'Serializable' });
    return fn(tx);
  }) };
  return { principal, service, status, priority, branch, row, tx, prisma, subject: new WaitlistService(prisma) };
}

test('waitlist controller uses only authenticated principal and requires authentication', async () => {
  const principal = { userId: randomUUID(), sessionId: randomUUID() };
  const input = { serviceId: randomUUID() };
  const enter = mock.fn(async () => ({ data: {} }));
  const findMine = mock.fn(async () => ({ data: [] }));
  const controller = new WaitlistController({ enter, findMine });
  await controller.enter(input, {}, { principal });
  await controller.findMine({}, undefined, { principal });
  assert.deepEqual(enter.mock.calls[0].arguments, [input, principal]);
  assert.deepEqual(findMine.mock.calls[0].arguments, [principal]);
  assert.throws(() => controller.enter(input, {}, {}), hasStatus(401));
  assert.throws(() => controller.findMine({}, undefined, {}), hasStatus(401));
});

test('waitlist strict schema rejects identity, administrative fields, preferences and queries', () => {
  const input = { serviceId: randomUUID() };
  assert.deepEqual(parseWaitlistEntry(input, {}), input);
  assert.deepEqual(parseWaitlistEntry({ ...input, branchId: randomUUID() }, {}).serviceId, input.serviceId);
  for (const body of [undefined, null, [], {}, { serviceId: 'invalid' }, { ...input, branchId: null }, { ...input, branchId: 'invalid' }]) {
    assert.throws(() => parseWaitlistEntry(body, {}), hasStatus(400));
  }
  for (const key of ['userId', 'institutionId', 'status', 'statusId', 'priorityId', 'priority', 'score', 'position', 'enteredAt', 'professionalId', 'allowsOtherBranches', 'preference', 'candidate', 'offer', 'reassignment']) {
    assert.throws(() => parseWaitlistEntry({ ...input, [key]: randomUUID() }, {}), hasStatus(400));
    assert.throws(() => parseWaitlistEntry(input, { [key]: randomUUID() }), hasStatus(400));
    assert.throws(() => parseWaitlistListing({ [key]: randomUUID() }, undefined), hasStatus(400));
    assert.throws(() => parseWaitlistListing({}, { [key]: randomUUID() }), hasStatus(400));
  }
  parseWaitlistListing({}, undefined);
});

for (const withBranch of [false, true]) test(`entry uses server-owned fields and public DTO, branch=${withBranch}`, async () => {
  const s = setup();
  const input = { serviceId: s.service.id, ...(withBranch ? { branchId: s.branch.id } : {}) };
  const result = await s.subject.enter(input, s.principal);
  const data = s.tx.waitlistEntry.create.mock.calls[0].arguments[0].data;
  assert.deepEqual(Object.keys(data).sort(), ['id', 'userId', 'institutionId', 'serviceId', 'branchId', 'priorityId', 'statusId'].sort());
  assert.equal(data.userId, s.principal.userId);
  assert.equal(data.institutionId, s.service.institutionId);
  assert.equal(data.priorityId, s.priority.id);
  assert.equal(data.statusId, s.status.id);
  assert.equal(data.branchId, withBranch ? s.branch.id : null);
  assert.deepEqual(Object.keys(result.data).sort(), ['id', 'status', 'enteredAt', 'service', 'branch'].sort());
  assert.deepEqual(result.data.service, { id: s.service.id, name: 'Atención general' });
  assert.equal(result.data.enteredAt, '2026-09-01T10:00:00.000Z');
  assert.equal(result.data.status, 'ACTIVE');
  assert.deepEqual(result.data.branch, withBranch ? { id: s.branch.id, name: 'Sucursal' } : null);
  assert.deepEqual(s.tx.user.findFirst.mock.calls[0].arguments[0].where, { id: s.principal.userId, status: 'ACTIVE', deletedAt: null });
  assert.deepEqual(s.tx.service.findFirst.mock.calls[0].arguments[0].where, {
    id: s.service.id, active: true, deletedAt: null, institution: { status: 'ACTIVE', deletedAt: null },
  });
  assert.deepEqual(s.tx.priority.findUnique.mock.calls[0].arguments[0].where, {
    institutionId_code: { institutionId: s.service.institutionId, code: 'STANDARD' },
  });
  if (withBranch) assert.deepEqual(s.tx.branch.findFirst.mock.calls[0].arguments[0].where, {
    id: s.branch.id, institutionId: s.service.institutionId, status: 'ACTIVE', deletedAt: null,
    serviceAssignments: { some: { serviceId: s.service.id, active: true } },
  });
});

for (const [model, status] of [['user', 401], ['service', 404], ['branch', 404]]) {
  test(`entry rejects invalid ${model} before writes`, async () => {
    const s = setup();
    s.tx[model].findFirst.mock.mockImplementation(async () => null);
    await assert.rejects(s.subject.enter({ serviceId: s.service.id, branchId: s.branch.id }, s.principal), hasStatus(status));
    assert.equal(s.tx.waitlistEntry.create.mock.callCount(), 0);
  });
}
test('entry rejects service with waitlist disabled', async () => {
  const s = setup(); s.service.allowsWaitlist = false;
  await assert.rejects(s.subject.enter({ serviceId: s.service.id }, s.principal), hasStatus(409));
  assert.equal(s.tx.waitlistEntry.create.mock.callCount(), 0);
});
for (const invalid of ['missing status', 'inactive status', 'final status', 'missing priority', 'inactive priority']) {
  test(`entry returns 503 for ${invalid} without writes or bootstrap`, async () => {
    const s = setup();
    if (invalid === 'missing status') s.tx.waitlistStatus.findUnique.mock.mockImplementation(async () => null);
    if (invalid === 'inactive status') s.status.active = false;
    if (invalid === 'final status') s.status.isFinal = true;
    if (invalid === 'missing priority') s.tx.priority.findUnique.mock.mockImplementation(async () => null);
    if (invalid === 'inactive priority') s.priority.active = false;
    await assert.rejects(s.subject.enter({ serviceId: s.service.id }, s.principal), hasStatus(503));
    assert.equal(s.tx.waitlistEntry.create.mock.callCount(), 0);
  });
}
test('equivalence is user/institution/service, independent of branch and catalog active flag', async () => {
  const s = setup();
  s.tx.waitlistEntry.findFirst.mock.mockImplementation(async () => ({ id: randomUUID() }));
  await assert.rejects(s.subject.enter({ serviceId: s.service.id, branchId: s.branch.id }, s.principal), hasStatus(409));
  assert.deepEqual(s.tx.waitlistEntry.findFirst.mock.calls[0].arguments[0].where, {
    userId: s.principal.userId, institutionId: s.service.institutionId, serviceId: s.service.id,
    deletedAt: null, status: { isFinal: false },
  });
  assert.equal(s.tx.waitlistEntry.create.mock.callCount(), 0);
});
test('Serializable retries the entire transaction once then observes committed duplicate', async () => {
  const s = setup(); let attempts = 0;
  s.prisma.$transaction.mock.mockImplementation(async (fn) => {
    if (++attempts === 1) throw { code: 'P2034' };
    s.tx.waitlistEntry.findFirst.mock.mockImplementation(async () => ({ id: randomUUID() }));
    return fn(s.tx);
  });
  await assert.rejects(s.subject.enter({ serviceId: s.service.id }, s.principal), hasStatus(409));
  assert.equal(attempts, 2);
  assert.equal(s.tx.waitlistEntry.create.mock.callCount(), 0);
});
test('Serializable can retry successfully and never retries persistently more than once', async () => {
  const s = setup(); let attempts = 0;
  s.prisma.$transaction.mock.mockImplementation(async (fn) => {
    if (++attempts === 1) throw { code: 'P2034' };
    return fn(s.tx);
  });
  await s.subject.enter({ serviceId: s.service.id }, s.principal);
  assert.equal(attempts, 2);
  s.prisma.$transaction.mock.mockImplementation(async () => { throw { code: 'P2034' }; });
  await assert.rejects(s.subject.enter({ serviceId: s.service.id }, s.principal), hasStatus(409));
  assert.equal(s.prisma.$transaction.mock.callCount(), 4);
});
for (const code of ['P2002', 'P2003', '23505', '23503', '42601', 'unknown']) test(`storage ${code} is not retried or misclassified as 409`, async () => {
  const s = setup();
  const original = { code, message: 'sensitive database detail' };
  s.tx.waitlistEntry.create.mock.mockImplementation(async () => { throw original; });
  await assert.rejects(s.subject.enter({ serviceId: s.service.id }, s.principal), (error) => {
    assert.equal(error.getStatus(), 500);
    assert.equal(error.cause, original);
    assert.ok(!JSON.stringify(error.getResponse()).includes('sensitive'));
    return true;
  });
  assert.equal(s.prisma.$transaction.mock.callCount(), 1);
});
test('programming errors retain their internal cause and are not treated as transaction conflicts', async () => {
  const s = setup();
  const original = new TypeError('sensitive programming detail');
  s.tx.waitlistEntry.create.mock.mockImplementation(async () => { throw original; });
  assert.equal(isTransactionConflict(original), false);
  await assert.rejects(s.subject.enter({ serviceId: s.service.id }, s.principal), (error) => {
    assert.equal(error.getStatus(), 500);
    assert.equal(error.cause, original);
    assert.ok(!JSON.stringify(error.getResponse()).includes('sensitive'));
    return true;
  });
  assert.equal(s.prisma.$transaction.mock.callCount(), 1);
});
test('listing scopes open own entries, orders deterministically and hides incoherent tenants', async () => {
  const s = setup();
  s.tx.waitlistEntry.findMany.mock.mockImplementation(async () => [s.row,
    { ...s.row, service: { ...s.row.service, institutionId: randomUUID() } },
    { ...s.row, branch: { id: randomUUID(), name: 'Foreign', institutionId: randomUUID() } },
  ]);
  const result = await s.subject.findMine(s.principal);
  assert.equal(result.data.length, 1);
  const query = s.tx.waitlistEntry.findMany.mock.calls[0].arguments[0];
  assert.deepEqual(query.where, { userId: s.principal.userId, deletedAt: null, status: { isFinal: false } });
  assert.deepEqual(query.orderBy, [{ enteredAt: 'asc' }, { id: 'asc' }]);
  s.tx.waitlistEntry.findMany.mock.mockImplementation(async () => []);
  assert.deepEqual(await s.subject.findMine(s.principal), { data: [] });
});

test('adapter commit serialization conflicts retry once, unrelated errors never do', async () => {
  const s = setup();
  const conflict = { name: 'DriverAdapterError', cause: { kind: 'TransactionWriteConflict', originalCode: '40001' } };
  assert.ok(isTransactionConflict(conflict));
  assert.ok(isTransactionConflict({ ...conflict, cause: { ...conflict.cause, originalCode: '40P01' } }));
  for (const error of [undefined, null, '40001', {}, { code: 'P2002' }, { code: 'P2003' },
    { message: 'serialization failure 40001 deadlock detected' },
    { name: 'DriverAdapterError', cause: null },
    { name: 'DriverAdapterError', cause: { originalCode: '40001' } },
    { ...conflict, cause: { ...conflict.cause, originalCode: '23505' } },
    { ...conflict, cause: { ...conflict.cause, originalCode: '23503' } },
    { ...conflict, cause: { kind: 'OtherError', originalCode: '40001' } },
    { name: 'OtherError', cause: conflict.cause }]) assert.equal(isTransactionConflict(error), false);
  let attempts = 0;
  s.prisma.$transaction.mock.mockImplementation(async (fn) => {
    if (++attempts === 1) throw conflict;
    return fn(s.tx);
  });
  await s.subject.enter({ serviceId: s.service.id }, s.principal);
  assert.equal(attempts, 2);
  s.prisma.$transaction.mock.mockImplementation(async () => { throw conflict; });
  await assert.rejects(s.subject.enter({ serviceId: s.service.id }, s.principal), hasStatus(409));
  assert.equal(s.prisma.$transaction.mock.callCount(), 4);
});

for (const previous of ['finalized', 'deleted']) test(`${previous} entry does not block a new enrollment`, async () => {
  const s = setup();
  const oldEntry = { deletedAt: previous === 'deleted' ? new Date() : null, status: { isFinal: previous === 'finalized' } };
  s.tx.waitlistEntry.findFirst.mock.mockImplementation(async ({ where }) =>
    oldEntry.deletedAt === where.deletedAt && oldEntry.status.isFinal === where.status.isFinal ? { id: randomUUID() } : null);
  await s.subject.enter({ serviceId: s.service.id }, s.principal);
  assert.equal(s.tx.waitlistEntry.create.mock.callCount(), 1);
});
