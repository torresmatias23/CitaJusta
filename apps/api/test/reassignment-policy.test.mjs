import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test, mock } from 'node:test';
import { GUARDS_METADATA } from '@nestjs/common/constants.js';
import { ReassignmentPolicyController } from '../dist/reassignment-policy/reassignment-policy.controller.js';
import { ReassignmentPolicyService, isPolicyVersionConflict } from '../dist/reassignment-policy/reassignment-policy.service.js';
import { parsePolicy, policyContext, policyReadInput } from '../dist/reassignment-policy/reassignment-policy.schemas.js';
import { compareCandidates, rankCandidates } from '../dist/reassignments/reassignments.policy.js';
import { ReassignmentsService } from '../dist/reassignments/reassignments.service.js';
import { Prisma } from '../dist/generated/prisma/client.js';
import { REQUIRE_PERMISSIONS_KEY } from '../dist/authorization/decorators/require-permissions.decorator.js';

const context = { userId: randomUUID(), institutionId: randomUUID(), permissions: [], roleCodes: [] };
const input = { rankingStrategy: 'PRIORITY_THEN_WAITING', offerTtlMinutes: 10 };
const hasStatus = (code) => (error) => error.getStatus?.() === code;
function fixture() {
  let current = null; const versions = [];
  const db = {
    user: { findFirst: async () => ({ id: context.userId }) }, userRole: { count: mock.fn(async () => 1) },
    institution: { findFirst: mock.fn(async () => ({ currentReassignmentPolicy: current })),
      updateMany: mock.fn(async ({ data }) => { current = versions.find((v) => v.id === data.currentReassignmentPolicyId); return { count: 1 }; }) },
    reassignmentPolicy: { create: mock.fn(async ({ data }) => { const row = { ...data, createdAt: new Date() }; versions.push(row); return row; }) },
  };
  db.$transaction = mock.fn(async (work, options) => { assert.equal(options.isolationLevel, 'Serializable'); return work(db); });
  return { db, versions, service: new ReassignmentPolicyService(db, { getOrThrow: () => 15 }) };
}
test('policy GET/POST use existing three guards and separate explicit permissions', () => {
  assert.equal(Reflect.getMetadata(GUARDS_METADATA, ReassignmentPolicyController).length, 3);
  assert.deepEqual(Reflect.getMetadata(REQUIRE_PERMISSIONS_KEY, ReassignmentPolicyController.prototype.get), ['reassignments.policy.read']);
  assert.deepEqual(Reflect.getMetadata(REQUIRE_PERMISSIONS_KEY, ReassignmentPolicyController.prototype.configure), ['reassignments.policy.update']);
});
test('strict strategy/TTL schema accepts bounds and rejects overrides/coercion/missing fields', () => {
  for (const rankingStrategy of ['PRIORITY_THEN_WAITING', 'WAITING_THEN_PRIORITY']) for (const offerTtlMinutes of [1, 60]) assert.deepEqual(parsePolicy({ rankingStrategy, offerTtlMinutes }, {}), { rankingStrategy, offerTtlMinutes });
  for (const body of [{}, { rankingStrategy: 'OTHER', offerTtlMinutes: 10 }, ...[0, 61, 1.5, '10', null].map((offerTtlMinutes) => ({ ...input, offerTtlMinutes })),
    ...['institutionId', 'userId', 'createdByUserId', 'version', 'policyId', 'current', 'active'].map((key) => ({ ...input, [key]: 'override' }))]) assert.throws(() => parsePolicy(body, {}), hasStatus(400));
  assert.throws(() => parsePolicy(input, { force: true }), hasStatus(400));
  assert.throws(() => policyReadInput({ userId: context.userId }, {}), hasStatus(400));
});
test('context requires authenticated matching identity, institution and rejects BRANCH', () => {
  assert.throws(() => policyContext({}), hasStatus(401));
  assert.throws(() => policyContext({ principal: { userId: context.userId }, authorization: { ...context, institutionId: undefined } }), hasStatus(400));
  assert.throws(() => policyContext({ principal: { userId: context.userId }, authorization: { ...context, branchId: randomUUID() } }), hasStatus(403));
});
test('DEFAULT reads legacy effective TTL without writes or transactions', async () => {
  const { service, db, versions } = fixture();
  assert.deepEqual((await service.get(context)).data, { source: 'DEFAULT', id: null, version: null, ...input, offerTtlMinutes: 15 });
  assert.equal(versions.length, 0); assert.equal(db.$transaction.mock.callCount(), 0); assert.equal(db.institution.updateMany.mock.callCount(), 0);
});
test('first version, identical no-op and version 2 preserve immutable version 1 and actor', async () => {
  const { service, versions, db } = fixture();
  const first = await service.configure(input, context); assert.equal(first.created, true); assert.equal(first.data.version, 1);
  assert.equal(first.data.createdByUserId, context.userId); const before = structuredClone(versions[0]);
  const same = await service.configure(input, context); assert.equal(same.created, false); assert.deepEqual(same.data, first.data);
  const second = await service.configure({ ...input, offerTtlMinutes: 20 }, context); assert.equal(second.data.version, 2);
  assert.deepEqual(versions[0], before); assert.equal(versions.length, 2); assert.equal(db.institution.updateMany.mock.callCount(), 2);
  assert.equal((await service.get(context)).data.id, second.data.id);
});
test('institutional grants and current lookup cannot escape context; branch and revoked grant cannot write', async () => {
  const { service, db } = fixture(); await service.get(context);
  assert.equal(db.institution.findFirst.mock.calls[0].arguments[0].where.id, context.institutionId);
  assert.ok(JSON.stringify(db.userRole.count.mock.calls[0].arguments[0]).includes(context.institutionId));
  await assert.rejects(service.configure(input, { ...context, branchId: randomUUID() }), hasStatus(403));
  db.userRole.count.mock.mockImplementation(async () => 0);
  await assert.rejects(service.configure(input, { ...context, institutionId: randomUUID() }), hasStatus(403));
  assert.equal(db.reassignmentPolicy.create.mock.callCount(), 0);
});
test('version conflict detection excludes unrelated unique constraints and SQL errors', () => {
  const error = (target) => new Prisma.PrismaClientKnownRequestError('duplicate', { code: 'P2002', clientVersion: '7.10.0', meta: { target, modelName: 'ReassignmentPolicy' } });
  assert.equal(isPolicyVersionConflict(error(['institucion_id', 'version'])), true);
  assert.equal(isPolicyVersionConflict(error(['id'])), false);
  assert.equal(isPolicyVersionConflict({ code: '23505' }), false);
  const cause = { originalCode: '23505', kind: 'UniqueConstraintViolation', table: 'politicas_reasignacion', constraint: { index: 'politicas_reasignacion_institucion_id_version_key' } };
  const adapterError = () => new Prisma.PrismaClientKnownRequestError('duplicate', { code: 'P2002', clientVersion: '7.10.0', meta: { modelName: 'ReassignmentPolicy', driverAdapterError: { cause } } });
  assert.equal(isPolicyVersionConflict(adapterError()), true);
  cause.constraint.index = 'politicas_reasignacion_pkey'; assert.equal(isPolicyVersionConflict(adapterError()), false);
});
test('recognized contention retries entire transaction once; persistent failures become 409', async () => {
  const { service, db } = fixture();
  db.$transaction.mock.mockImplementationOnce(async () => { throw { code: 'P2034' }; });
  assert.equal((await service.configure(input, context)).data.version, 1);
  assert.equal(db.$transaction.mock.callCount(), 2);
  db.$transaction.mock.mockImplementation(async () => { throw { code: 'P2034' }; });
  await assert.rejects(service.configure(input, context), hasStatus(409));
  assert.equal(db.$transaction.mock.callCount(), 4);
});
test('ranking preserves exact legacy comparator and only reverses primary/secondary with deterministic id ties', () => {
  const candidates = [
    { id: 'b', enteredAt: new Date('2020-01-01'), priority: { level: 1 } },
    { id: 'c', enteredAt: new Date('2020-01-02'), priority: { level: 0 } },
    { id: 'a', enteredAt: new Date('2020-01-01'), priority: { level: 1 } },
  ]; const before = structuredClone(candidates);
  assert.deepEqual(rankCandidates(candidates, 'PRIORITY_THEN_WAITING'), [...candidates].sort(compareCandidates));
  assert.deepEqual(rankCandidates(candidates, 'PRIORITY_THEN_WAITING').map((c) => c.id), ['c', 'a', 'b']);
  assert.deepEqual(rankCandidates(candidates, 'WAITING_THEN_PRIORITY').map((c) => c.id), ['a', 'b', 'c']);
  assert.deepEqual(candidates, before);
});
test('generation stores resolved policy or legacy null and leaves eligibility snapshot shape intact', async () => {
  for (const policy of [null, { id: randomUUID(), rankingStrategy: 'WAITING_THEN_PRIORITY', offerTtlMinutes: 3 }]) {
    let saved;
    const branchId = randomUUID(); const serviceId = randomUUID(); const professionalId = randomUUID(); const slotId = randomUUID();
    const startsAt = new Date(Date.now() + 86400000); const endsAt = new Date(+startsAt + 1800000);
    const slot = { id: slotId, status: 'RELEASED', lockVersion: 1, startsAt, endsAt, blockedUntilAt: null,
      availability: { id: randomUUID(), branchId, serviceId, professionalId, attentionPointId: null,
        branch: { institution: { timeZone: 'UTC', currentReassignmentPolicy: policy } } },
      appointment: { id: randomUUID(), userId: randomUUID(), institutionId: context.institutionId, branchId, serviceId, professionalId,
        attentionPointId: null, startsAt, endsAt, deletedAt: null, status: { code: 'CANCELADA', isFinal: true }, cancellations: [{ id: randomUUID() }] } };
    const tx = { user: { findFirst: async () => ({ id: context.userId }) }, userRole: { count: async () => 1 },
      agendaSlot: { findFirst: async () => slot, updateMany: async () => ({ count: 1 }) }, availability: { count: async () => 1 },
      reassignment: { count: async () => 0, create: async ({ data }) => { saved = data; } }, appointmentOffer: { count: async () => 0 }, waitlistEntry: { findMany: async () => [] } };
    const service = new ReassignmentsService({ $transaction: (work) => work(tx) }, { getOrThrow: () => 10 });
    await service.generate(slotId, { ...context, permissions: ['reassignments.generate'] });
    assert.equal(saved.policyId, policy?.id ?? null); assert.equal(saved.criteriaSnapshot.offerTtlMinutes, policy?.offerTtlMinutes ?? 10);
    assert.equal(saved.status, 'EXHAUSTED'); assert.equal(saved.criteriaSnapshot.actorUserId, context.userId);
  }
});
