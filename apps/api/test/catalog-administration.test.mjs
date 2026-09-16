import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test, mock } from 'node:test';
import { GUARDS_METADATA } from '@nestjs/common/constants.js';
import { Prisma } from '../dist/generated/prisma/client.js';
import { CatalogAdministrationService, CATALOG_PERMISSIONS } from '../dist/services/catalog-administration.service.js';
import { BranchesController } from '../dist/services/branches.controller.js';
import { ServicesController } from '../dist/services/services.controller.js';
import { AuthorizationContextGuard } from '../dist/authorization/authorization-context.guard.js';
import { PermissionsGuard } from '../dist/authorization/permissions.guard.js';
import { REQUIRE_PERMISSIONS_KEY } from '../dist/authorization/decorators/require-permissions.decorator.js';
import { createBranchSchema, updateBranchSchema, createServiceSchema, updateServiceSchema,
  parseCatalogInput, catalogContext } from '../dist/services/catalog-administration.schemas.js';

const context = { userId: randomUUID(), institutionId: randomUUID(), roleCodes: [], permissions: Object.values(CATALOG_PERMISSIONS) };
const branchId = randomUUID();
const serviceId = randomUUID();
const hasStatus = (status) => (error) => error.getStatus?.() === status;
const baseService = { code: 'SERVICE', name: 'Atención', durationMinutes: 30 };
const baseBranch = { code: 'BRANCH', name: 'Sede' };

function fixture() {
  const tx = {
    auditEvent: { create: mock.fn(async ({ data }) => ({ id: data.id })) },
    userRole: { count: mock.fn(async () => 1) },
    institution: { findFirst: mock.fn(async () => ({ id: context.institutionId })) },
    branch: {
      create: mock.fn(async ({ data }) => ({ id: data.id, code: data.code, name: data.name, latitude: null, longitude: null })),
      findFirst: mock.fn(async () => ({ id: branchId })),
      update: mock.fn(async ({ data }) => ({ id: branchId, ...data, latitude: new Prisma.Decimal('-33.1234567'), longitude: null })),
      count: mock.fn(async ({ where }) => where.id.in.length),
    },
    serviceCategory: { findFirst: mock.fn(async () => ({ id: randomUUID() })) },
    service: {
      create: mock.fn(async ({ data }) => ({ id: data.id, ...baseService, branchAssignments: [] })),
      findFirst: mock.fn(async () => ({ minimumAdvanceMinutes: 0, maximumAdvanceDays: null })),
      update: mock.fn(async () => ({ id: serviceId })),
      findUniqueOrThrow: mock.fn(async () => ({ id: serviceId, ...baseService, active: false, branchAssignments: [{ branchId }] })),
    },
    serviceBranch: { updateMany: mock.fn(async () => ({ count: 1 })), upsert: mock.fn(async () => ({})) },
  };
  const prisma = { $transaction: mock.fn(async (work, options) => {
    assert.equal(options.isolationLevel, 'Serializable');
    return work(tx);
  }) };
  return { tx, prisma, service: new CatalogAdministrationService(prisma) };
}

test('HU-012 administrative methods carry explicit context and permission guards; GET unchanged', () => {
  for (const [controller, createPermission, updatePermission] of [
    [BranchesController, 'branches.create', 'branches.update'],
    [ServicesController, 'services.create', 'services.update'],
  ]) {
    for (const [method, permission] of [['create', createPermission], ['update', updatePermission]]) {
      assert.deepEqual(Reflect.getMetadata(GUARDS_METADATA, controller.prototype[method]), [AuthorizationContextGuard, PermissionsGuard]);
      assert.deepEqual(Reflect.getMetadata(REQUIRE_PERMISSIONS_KEY, controller.prototype[method]), [permission]);
    }
    assert.equal(Reflect.getMetadata(GUARDS_METADATA, controller.prototype.findAll ?? controller.prototype.findServices), undefined);
  }
});

test('HU-012 schemas reject unknown identity, empty patches and malformed values', () => {
  for (const [schema, body] of [
    [createBranchSchema, { ...baseBranch, institutionId: context.institutionId }],
    [createBranchSchema, { ...baseBranch, latitude: 91 }],
    [createBranchSchema, { ...baseBranch, longitude: 0.12345678 }],
    [createBranchSchema, { ...baseBranch, email: 'bad' }],
    [createBranchSchema, { ...baseBranch, name: ' ' }],
    [updateBranchSchema, {}], [updateServiceSchema, {}],
    [createServiceSchema, { ...baseService, durationMinutes: 0 }],
    [createServiceSchema, { ...baseService, durationMinutes: 1.5 }],
    [createServiceSchema, { ...baseService, active: 'false' }],
    [createServiceSchema, { ...baseService, branchIds: [branchId, branchId] }],
    [createServiceSchema, { ...baseService, userId: context.userId }],
    [createServiceSchema, { ...baseService, deletedAt: null }],
  ]) assert.throws(() => parseCatalogInput(schema, body, {}), hasStatus(400));
  assert.throws(() => parseCatalogInput(createServiceSchema, baseService, { institutionId: context.institutionId }), hasStatus(400));
  assert.equal(parseCatalogInput(createBranchSchema, { ...baseBranch, name: ' Sede ' }, {}).name, 'Sede');
});

test('HU-012 context comes from authenticated authorization only', () => {
  assert.throws(() => catalogContext({}), hasStatus(401));
  assert.throws(() => catalogContext({ principal: { userId: randomUUID() }, authorization: context }), hasStatus(401));
  assert.throws(() => catalogContext({ principal: { userId: context.userId }, authorization: { ...context, institutionId: undefined } }), hasStatus(400));
  assert.equal(catalogContext({ principal: { userId: context.userId }, authorization: context }), context);
});

test('HU-012 create branch derives tenant, UUID and limits selected DTO fields', async () => {
  const { service, tx } = fixture();
  const result = await service.createBranch(baseBranch, context);
  const { data, select } = tx.branch.create.mock.calls[0].arguments[0];
  assert.equal(data.institutionId, context.institutionId);
  assert.match(result.data.id, /^[0-9a-f-]{36}$/);
  for (const field of ['institutionId', 'deletedAt', 'createdAt', 'roleAssignments']) assert.equal(select[field], undefined);
});

test('HU-012 scoped branch edit preserves tenant and serializes coordinates explicitly', async () => {
  const { service, tx } = fixture();
  const result = await service.updateBranch(branchId, { name: 'Editada' }, { ...context, branchId });
  assert.equal(result.data.latitude, '-33.1234567');
  assert.deepEqual(tx.branch.update.mock.calls[0].arguments[0].where, { id: branchId, institutionId: context.institutionId, deletedAt: null });
  const scopes = tx.userRole.count.mock.calls[0].arguments[0].where.AND[2].OR;
  assert.ok(scopes.some((scope) => scope.role.scope === 'BRANCH' && scope.branchId === branchId));
});

test('HU-012 another branch context never reaches a write', async () => {
  const { service, tx } = fixture();
  await assert.rejects(service.updateBranch(randomUUID(), { name: 'No' }, { ...context, branchId }), hasStatus(404));
  assert.equal(tx.branch.update.mock.callCount(), 0);
});

test('HU-012 institution-wide operations reject branch context and branch-only grants', async () => {
  const { service, tx } = fixture();
  await assert.rejects(service.createBranch(baseBranch, { ...context, branchId }), hasStatus(403));
  await assert.rejects(service.createService(baseService, { ...context, branchId }), hasStatus(403));
  await assert.rejects(service.updateService(serviceId, { active: false }, { ...context, branchId }), hasStatus(403));
  tx.userRole.count.mock.mockImplementation(async () => 0);
  await assert.rejects(service.createService(baseService, context), hasStatus(403));
  const scopes = tx.userRole.count.mock.calls[0].arguments[0].where.AND[2].OR;
  assert.deepEqual(scopes.map((scope) => scope.role.scope), ['GLOBAL', 'INSTITUTION']);
  assert.equal(tx.service.create.mock.callCount(), 0);
});

test('HU-012 unavailable institution and absent tenant-scoped resources return 404', async () => {
  const { service, tx } = fixture();
  tx.institution.findFirst.mock.mockImplementation(async () => null);
  await assert.rejects(service.createBranch(baseBranch, context), hasStatus(404));
  tx.institution.findFirst.mock.mockImplementation(async () => ({ id: context.institutionId }));
  tx.branch.findFirst.mock.mockImplementation(async () => null);
  tx.service.findFirst.mock.mockImplementation(async () => null);
  await assert.rejects(service.updateBranch(branchId, { name: 'No' }, context), hasStatus(404));
  await assert.rejects(service.updateService(serviceId, { active: false }, context), hasStatus(404));
});

test('HU-012 service creation validates category and branches in the authorized institution', async () => {
  const { service, tx } = fixture();
  const categoryId = randomUUID();
  await service.createService({ ...baseService, categoryId, branchIds: [branchId] }, context);
  assert.deepEqual(tx.serviceCategory.findFirst.mock.calls[0].arguments[0].where, { id: categoryId, institutionId: context.institutionId, active: true });
  assert.deepEqual(tx.branch.count.mock.calls[0].arguments[0].where, { id: { in: [branchId] }, institutionId: context.institutionId, deletedAt: null, status: 'ACTIVE' });
  const { data } = tx.service.create.mock.calls[0].arguments[0];
  assert.equal(data.institutionId, context.institutionId);
  assert.deepEqual(data.branchAssignments, { create: [{ branchId }] });
});

test('HU-012 invalid related resources fail before writing', async () => {
  const { service, tx } = fixture();
  tx.serviceCategory.findFirst.mock.mockImplementation(async () => null);
  await assert.rejects(service.createService({ ...baseService, categoryId: randomUUID() }, context), hasStatus(404));
  tx.branch.count.mock.mockImplementation(async () => 0);
  await assert.rejects(service.createService({ ...baseService, branchIds: [branchId] }, context), hasStatus(404));
  assert.equal(tx.service.create.mock.callCount(), 0);
});

test('HU-012 advance window validates merged values on PATCH, not just submitted fields', async () => {
  const { service, tx } = fixture();
  await assert.rejects(service.createService({ ...baseService, minimumAdvanceMinutes: 1441, maximumAdvanceDays: 1 }, context), hasStatus(400));
  tx.service.findFirst.mock.mockImplementation(async () => ({ minimumAdvanceMinutes: 3000, maximumAdvanceDays: 4 }));
  await assert.rejects(service.updateService(serviceId, { maximumAdvanceDays: 1 }, context), hasStatus(400));
  assert.equal(tx.service.update.mock.callCount(), 0);
});

test('HU-012 active-only PATCH keeps associations and does not require active category', async () => {
  const { service, tx } = fixture();
  const result = await service.updateService(serviceId, { active: false }, context);
  assert.equal(result.data.active, false);
  assert.deepEqual(result.data.branchIds, [branchId]);
  assert.equal(tx.serviceBranch.updateMany.mock.callCount(), 0);
  assert.equal(tx.serviceCategory.findFirst.mock.callCount(), 0);
  assert.deepEqual(tx.service.update.mock.calls[0].arguments[0].data, { active: false });
});

test('HU-012 branch assignment replacement deactivates and upserts, never deletes', async () => {
  const { service, tx } = fixture();
  await service.updateService(serviceId, { branchIds: [branchId] }, context);
  assert.deepEqual(tx.serviceBranch.updateMany.mock.calls[0].arguments[0], {
    where: { serviceId, branchId: { notIn: [branchId] } }, data: { active: false },
  });
  assert.deepEqual(tx.serviceBranch.upsert.mock.calls[0].arguments[0].update, { active: true });
});

test('HU-012 duplicate unique constraint is a controlled 409', async () => {
  const { service, tx } = fixture();
  tx.branch.create.mock.mockImplementation(async () => { throw new Prisma.PrismaClientKnownRequestError('private detail', { code: 'P2002', clientVersion: '7' }); });
  await assert.rejects(service.createBranch(baseBranch, context), (error) => hasStatus(409)(error) && !error.message.includes('private'));
});

test('HU-012 serialization retry repeats authorization, relation checks and entire write', async () => {
  const { service, tx, prisma } = fixture();
  let attempt = 0;
  tx.service.create.mock.mockImplementation(async () => {
    if (attempt++ === 0) throw { code: 'P2034' };
    return { id: serviceId, branchAssignments: [] };
  });
  await service.createService({ ...baseService, branchIds: [branchId] }, context);
  assert.equal(prisma.$transaction.mock.callCount(), 2);
  assert.equal(tx.userRole.count.mock.callCount(), 2);
  assert.equal(tx.branch.count.mock.callCount(), 2);
});

test('HU-012 persistent transaction conflict returns 409 after bounded retry', async () => {
  const { service, tx, prisma } = fixture();
  tx.branch.create.mock.mockImplementation(async () => { throw { code: 'P2034' }; });
  await assert.rejects(service.createBranch(baseBranch, context), hasStatus(409));
  assert.equal(prisma.$transaction.mock.callCount(), 2);
});

test('HU-012 programming/storage failures propagate, not falsely translated to conflict', async () => {
  const { service, tx, prisma } = fixture();
  const failure = new TypeError('Unexpected implementation failure');
  tx.serviceBranch.upsert.mock.mockImplementation(async () => { throw failure; });
  await assert.rejects(service.updateService(serviceId, { branchIds: [branchId] }, context), (error) => error === failure);
  assert.equal(prisma.$transaction.mock.callCount(), 1);
});
