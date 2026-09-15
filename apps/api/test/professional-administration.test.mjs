import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test, mock } from 'node:test';
import { GUARDS_METADATA } from '@nestjs/common/constants.js';
import { Prisma } from '../dist/generated/prisma/client.js';
import { ProfessionalAdministrationService } from '../dist/professionals/professional-administration.service.js';
import { ProfessionalsController } from '../dist/professionals/professionals.controller.js';
import { AuthorizationContextGuard } from '../dist/authorization/authorization-context.guard.js';
import { PermissionsGuard } from '../dist/authorization/permissions.guard.js';
import { REQUIRE_PERMISSIONS_KEY } from '../dist/authorization/decorators/require-permissions.decorator.js';
import { createProfessionalSchema, updateProfessionalSchema, parseProfessionalInput, professionalAdministrationContext } from '../dist/professionals/schemas/professional-administration.schemas.js';

const context = { userId: randomUUID(), institutionId: randomUUID(), roleCodes: [], permissions: ['professionals.create', 'professionals.update'] };
const id = randomUUID();
const input = { userId: randomUUID(), branchIds: [randomUUID()], serviceIds: [randomUUID()], internalCode: 'STAFF' };
const hasStatus = (status) => (error) => error.getStatus?.() === status;
const now = new Date();
function fixture() {
  const row = { id, userId: input.userId, internalCode: 'STAFF', titleOrFunction: null, description: null,
    status: 'ACTIVE', createdAt: now, updatedAt: now,
    branchAssignments: input.branchIds.map((branchId) => ({ branchId })), serviceAssignments: input.serviceIds.map((serviceId) => ({ serviceId })) };
  const tx = {
    userRole: { count: mock.fn(async () => 1) }, institution: { findFirst: mock.fn(async () => ({ id: context.institutionId })) },
    user: { findFirst: mock.fn(async () => ({ id: input.userId })) },
    branch: { count: mock.fn(async ({ where }) => where.id.in.length) }, service: { count: mock.fn(async ({ where }) => where.id.in.length) },
    professional: { create: mock.fn(async () => row), findFirst: mock.fn(async () => ({ id })),
      update: mock.fn(async () => ({ id })), findUniqueOrThrow: mock.fn(async () => row) },
    professionalBranch: { updateMany: mock.fn(async () => ({ count: 1 })), upsert: mock.fn(async () => ({})) },
    professionalService: { updateMany: mock.fn(async () => ({ count: 1 })), upsert: mock.fn(async () => ({})) },
  };
  const prisma = { $transaction: mock.fn(async (work, options) => { assert.equal(options.isolationLevel, 'Serializable'); return work(tx); }) };
  return { tx, prisma, service: new ProfessionalAdministrationService(prisma) };
}

test('HU-013 administrative routes declare existing guards and independent permissions', () => {
  for (const method of ['create', 'update']) {
    assert.deepEqual(Reflect.getMetadata(GUARDS_METADATA, ProfessionalsController.prototype[method]), [AuthorizationContextGuard, PermissionsGuard]);
    assert.deepEqual(Reflect.getMetadata(REQUIRE_PERMISSIONS_KEY, ProfessionalsController.prototype[method]), [`professionals.${method}`]);
  }
  assert.equal(Reflect.getMetadata(GUARDS_METADATA, ProfessionalsController.prototype.findAll), undefined);
});
test('HU-013 creation requires valid identity and initial nonduplicate associations', () => {
  for (const body of [{}, { ...input, userId: 'bad' }, { ...input, institutionId: randomUUID() },
    { ...input, branchIds: [] }, { ...input, serviceIds: [] }, { ...input, branchIds: [input.branchIds[0], input.branchIds[0]] },
    { ...input, serviceIds: ['bad'] }, { ...input, internalCode: ' ' }, { ...input, status: 'DELETED' },
    { ...input, roles: ['ADMIN'] }]) assert.throws(() => parseProfessionalInput(createProfessionalSchema, body, {}), hasStatus(400));
  assert.deepEqual(parseProfessionalInput(createProfessionalSchema, input, {}), input);
});
test('HU-013 PATCH is partial nonempty, cannot change user, and rejects query overrides', () => {
  for (const body of [{}, { userId: input.userId }, { deletedAt: null }, { titleOrFunction: 'x'.repeat(161) },
    { serviceIds: [input.serviceIds[0], input.serviceIds[0]] }]) assert.throws(() => parseProfessionalInput(updateProfessionalSchema, body, {}), hasStatus(400));
  assert.throws(() => parseProfessionalInput(updateProfessionalSchema, { status: 'INACTIVE' }, { userId: input.userId }), hasStatus(400));
  assert.deepEqual(parseProfessionalInput(updateProfessionalSchema, { internalCode: null, branchIds: [] }, {}), { internalCode: null, branchIds: [] });
});
test('HU-013 context must match authenticated principal and contain institution', () => {
  assert.throws(() => professionalAdministrationContext({}), hasStatus(401));
  assert.throws(() => professionalAdministrationContext({ principal: { userId: input.userId }, authorization: context }), hasStatus(401));
  assert.throws(() => professionalAdministrationContext({ principal: { userId: context.userId }, authorization: { ...context, institutionId: undefined } }), hasStatus(400));
});
test('HU-013 creates nested assignments atomically with server-controlled tenant and selected DTO', async () => {
  const { service, tx } = fixture();
  const result = await service.create(input, context);
  const args = tx.professional.create.mock.calls[0].arguments[0];
  assert.equal(args.data.institutionId, context.institutionId);
  assert.deepEqual(args.data.branchAssignments.create, input.branchIds.map((branchId) => ({ branchId })));
  assert.deepEqual(args.data.serviceAssignments.create, input.serviceIds.map((serviceId) => ({ serviceId })));
  assert.deepEqual(tx.user.findFirst.mock.calls[0].arguments[0].where, { id: input.userId, status: 'ACTIVE', deletedAt: null });
  assert.equal(result.data.createdAt, now.toISOString());
  for (const field of ['institutionId', 'deletedAt', 'user', 'appointments']) assert.equal(args.select[field], undefined);
  assert.equal(args.select.branchAssignments.where.branch.institutionId, context.institutionId);
});
for (const [model, message] of [['branch', 'foreign branch'], ['service', 'foreign service']]) {
  test(`HU-013 rejects ${message} before writing and scopes SQL to institution`, async () => {
    const { service, tx } = fixture();
    tx[model].count.mock.mockImplementation(async () => 0);
    await assert.rejects(service.create(input, context), hasStatus(404));
    assert.equal(tx[model].count.mock.calls[0].arguments[0].where.institutionId, context.institutionId);
    assert.equal(tx.professional.create.mock.callCount(), 0);
  });
}
test('HU-013 unavailable users and institutions fail without creating a professional', async () => {
  const { service, tx } = fixture();
  tx.user.findFirst.mock.mockImplementation(async () => null);
  await assert.rejects(service.create(input, context), hasStatus(404));
  tx.institution.findFirst.mock.mockImplementation(async () => null);
  await assert.rejects(service.create(input, context), hasStatus(404));
  assert.equal(tx.professional.create.mock.callCount(), 0);
});
test('HU-013 no grants or branch scope cannot authorize institutional writes', async () => {
  const { service, tx } = fixture();
  await assert.rejects(service.create(input, { ...context, branchId: input.branchIds[0] }), hasStatus(403));
  tx.userRole.count.mock.mockImplementation(async () => 0);
  await assert.rejects(service.create(input, context), hasStatus(403));
  const where = tx.userRole.count.mock.calls[0].arguments[0].where;
  assert.deepEqual(where.AND[2].OR, [{ role: { scope: 'GLOBAL' } }, { role: { scope: 'INSTITUTION' }, institutionId: context.institutionId }]);
  assert.equal(tx.professional.create.mock.callCount(), 0);
});
test('HU-013 unknown/cross-tenant professional returns 404 before any update', async () => {
  const { service, tx } = fixture();
  tx.professional.findFirst.mock.mockImplementation(async () => null);
  await assert.rejects(service.update(id, { status: 'INACTIVE' }, context), hasStatus(404));
  assert.deepEqual(tx.professional.findFirst.mock.calls[0].arguments[0].where, { id, institutionId: context.institutionId, deletedAt: null });
  assert.equal(tx.professional.update.mock.callCount(), 0);
});
test('HU-013 profile-only edits preserve associations and reactivation does not rewrite identity', async () => {
  const { service, tx } = fixture();
  await service.update(id, { status: 'ACTIVE', titleOrFunction: 'Atención' }, context);
  const data = tx.professional.update.mock.calls[0].arguments[0].data;
  assert.equal(data.userId, undefined);
  assert.equal(data.status, 'ACTIVE');
  assert.ok(data.updatedAt instanceof Date);
  assert.equal(tx.professionalBranch.updateMany.mock.callCount(), 0);
  assert.equal(tx.professionalService.updateMany.mock.callCount(), 0);
});
test('HU-013 association replacement retains records and custom durations', async () => {
  const { service, tx } = fixture();
  await service.update(id, { branchIds: input.branchIds, serviceIds: input.serviceIds }, context);
  assert.deepEqual(tx.professionalBranch.updateMany.mock.calls[0].arguments[0].data, { active: false });
  assert.deepEqual(tx.professionalService.upsert.mock.calls[0].arguments[0].update, { active: true });
  assert.equal(tx.professionalService.upsert.mock.calls[0].arguments[0].update.customDurationMinutes, undefined);
});
test('HU-013 duplicate DB constraints produce a sanitized conflict', async () => {
  const { service, tx } = fixture();
  tx.professional.create.mock.mockImplementation(async () => { throw new Prisma.PrismaClientKnownRequestError('sensitive SQL', { code: 'P2002', clientVersion: '7' }); });
  await assert.rejects(service.create(input, context), (error) => hasStatus(409)(error) && !error.message.includes('SQL'));
});
test('HU-013 serialization retry rechecks grants, users and relations in a new transaction', async () => {
  const { service, tx, prisma } = fixture();
  let attempt = 0;
  const create = tx.professional.create;
  tx.professional.create = async (args) => { if (attempt++ === 0) throw { code: 'P2034' }; return create(args); };
  await service.create(input, context);
  assert.equal(prisma.$transaction.mock.callCount(), 2);
  assert.equal(tx.userRole.count.mock.callCount(), 2);
  assert.equal(tx.user.findFirst.mock.callCount(), 2);
  assert.equal(tx.service.count.mock.callCount(), 2);
});
test('HU-013 retry is bounded and unrelated failures are not masked as conflicts', async () => {
  const { service, tx, prisma } = fixture();
  tx.professional.create.mock.mockImplementation(async () => { throw { code: 'P2034' }; });
  await assert.rejects(service.create(input, context), hasStatus(409));
  assert.equal(prisma.$transaction.mock.callCount(), 2);
  const failure = new TypeError('Programming defect');
  tx.professionalService.upsert.mock.mockImplementation(async () => { throw failure; });
  await assert.rejects(service.update(id, { serviceIds: input.serviceIds }, context), (error) => error === failure);
  assert.equal(prisma.$transaction.mock.callCount(), 3);
});
