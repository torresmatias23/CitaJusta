import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test, mock } from 'node:test';
import { GUARDS_METADATA, PATH_METADATA } from '@nestjs/common/constants.js';
import { AccessTokenGuard } from '../dist/auth/guards/access-token.guard.js';
import { AuthorizationContextGuard } from '../dist/authorization/authorization-context.guard.js';
import { PermissionsGuard } from '../dist/authorization/permissions.guard.js';
import { REQUIRE_PERMISSIONS_KEY } from '../dist/authorization/decorators/require-permissions.decorator.js';
import { BranchesController } from '../dist/services/branches.controller.js';
import { ServicesController } from '../dist/services/services.controller.js';
import { CatalogAdministrationService } from '../dist/services/catalog-administration.service.js';
const context = { userId: randomUUID(), institutionId: randomUUID(), roleCodes: [], permissions: [] };
const branchId = randomUUID();
const status = code => error => error.getStatus?.() === code;
function setup() {
  const prisma = {
    userRole: { count: mock.fn(async () => 1) },
    institution: { findFirst: mock.fn(async () => ({ id: context.institutionId })) },
    branch: { findMany: mock.fn(async () => [{ id: branchId, status: 'INACTIVE', latitude: null, longitude: null }]) },
    service: { findMany: mock.fn(async () => [{ id: randomUUID(), active: false, branchAssignments: [{ branchId }] }]) },
    serviceCategory: { findMany: mock.fn(async () => []) },
  };
  return { prisma, service: new CatalogAdministrationService(prisma) };
}
test('HU-029 static routes have access/context/permission guards and separate read permissions', () => {
  for (const [Controller, method, path, permission] of [
    [BranchesController, 'administrationList', 'administration', 'branches.read'],
    [ServicesController, 'administrationList', 'administration', 'services.read'],
    [ServicesController, 'categories', 'categories', 'services.read'],
  ]) {
    assert.deepEqual(Reflect.getMetadata(GUARDS_METADATA, Controller), [AccessTokenGuard]);
    assert.deepEqual(Reflect.getMetadata(GUARDS_METADATA, Controller.prototype[method]), [AuthorizationContextGuard, PermissionsGuard]);
    assert.deepEqual(Reflect.getMetadata(REQUIRE_PERMISSIONS_KEY, Controller.prototype[method]), [permission]);
    assert.equal(Reflect.getMetadata(PATH_METADATA, Controller.prototype[method]), path);
    const controller = new Controller({}, {});
    assert.throws(() => controller[method](undefined, {}, {}), status(401));
    assert.throws(() => controller[method](undefined, {}, { principal: { userId: randomUUID() }, authorization: context }), status(401));
    assert.throws(() => controller[method](undefined, { institutionId: randomUUID() }, {}), status(400));
    assert.throws(() => controller[method]({ institutionId: randomUUID() }, {}, {}), status(400));
  }
  for (const method of ['findAll', 'findById']) assert.equal(Reflect.getMetadata(GUARDS_METADATA, ServicesController.prototype[method]), undefined);
  assert.equal(Reflect.getMetadata(GUARDS_METADATA, BranchesController.prototype.findServices), undefined);
});
test('HU-029 branches include inactive, exclude deleted, derive tenant and bound branch scope', async () => {
  const { prisma, service } = setup();
  assert.equal((await service.listBranches(context)).data[0].status, 'INACTIVE');
  assert.deepEqual(prisma.branch.findMany.mock.calls[0].arguments[0].where, { institutionId: context.institutionId, deletedAt: null });
  await service.listBranches({ ...context, branchId });
  assert.deepEqual(prisma.branch.findMany.mock.calls[1].arguments[0].where, { institutionId: context.institutionId, deletedAt: null, id: branchId });
  const grant = prisma.userRole.count.mock.calls[1].arguments[0].where;
  assert.equal(grant.role.permissions.some.permission.code, 'branches.read');
  assert.deepEqual(grant.AND[2].OR.map(x => x.role.scope), ['GLOBAL', 'INSTITUTION', 'BRANCH']);
  prisma.branch.findMany.mock.mockImplementation(async () => []);
  await assert.rejects(service.listBranches({ ...context, branchId }), status(404));
});
test('HU-029 service/category reads share institutional grant and enforce safe selects', async () => {
  const { prisma, service } = setup();
  const result = await service.listServices(context);
  assert.equal(result.data[0].active, false);
  assert.deepEqual(result.data[0].branchIds, [branchId]);
  assert.equal(result.data[0].branchAssignments, undefined);
  const query = prisma.service.findMany.mock.calls[0].arguments[0];
  assert.deepEqual(query.where, { institutionId: context.institutionId, deletedAt: null });
  assert.deepEqual(query.select.branchAssignments.where, { active: true, branch: { institutionId: context.institutionId, deletedAt: null } });
  for (const key of ['institutionId', 'deletedAt', 'createdAt']) assert.equal(query.select[key], undefined);
  await service.listCategories(context);
  const category = prisma.serviceCategory.findMany.mock.calls[0].arguments[0];
  assert.deepEqual(category.where, { institutionId: context.institutionId, active: true });
  assert.deepEqual(category.select, { id: true, name: true });
  for (const call of prisma.userRole.count.mock.calls) {
    assert.equal(call.arguments[0].where.role.permissions.some.permission.code, 'services.read');
    assert.deepEqual(call.arguments[0].where.AND[2].OR.map(x => x.role.scope), ['GLOBAL', 'INSTITUTION']);
  }
  await assert.rejects(service.listServices({ ...context, branchId }), status(403));
  await assert.rejects(service.listCategories({ ...context, branchId }), status(403));
});
test('HU-029 rejects missing institution, revoked grants and unavailable institution before reading', async () => {
  for (const method of ['listBranches', 'listServices', 'listCategories']) {
    const { prisma, service } = setup();
    await assert.rejects(service[method]({ ...context, institutionId: undefined }), status(400));
    prisma.userRole.count.mock.mockImplementation(async () => 0);
    await assert.rejects(service[method](context), status(403));
    prisma.userRole.count.mock.mockImplementation(async () => 1);
    prisma.institution.findFirst.mock.mockImplementation(async () => null);
    await assert.rejects(service[method](context), status(404));
    assert.deepEqual(prisma.institution.findFirst.mock.calls[0].arguments[0].where, { id: context.institutionId, status: 'ACTIVE', deletedAt: null });
    assert.equal(prisma.branch.findMany.mock.callCount() + prisma.service.findMany.mock.callCount() + prisma.serviceCategory.findMany.mock.callCount(), 0);
  }
});
