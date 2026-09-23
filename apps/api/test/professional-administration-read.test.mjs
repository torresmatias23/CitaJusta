import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test, mock } from 'node:test';
import { randomUUID } from 'node:crypto';
import { GUARDS_METADATA, PATH_METADATA } from '@nestjs/common/constants.js';
import { AccessTokenGuard } from '../dist/auth/guards/access-token.guard.js';
import { AuthorizationContextGuard } from '../dist/authorization/authorization-context.guard.js';
import { PermissionsGuard } from '../dist/authorization/permissions.guard.js';
import { REQUIRE_PERMISSIONS_KEY } from '../dist/authorization/decorators/require-permissions.decorator.js';
import { ProfessionalsController } from '../dist/professionals/professionals.controller.js';
import { ProfessionalAdministrationService } from '../dist/professionals/professional-administration.service.js';
import { parseEligibleUserQuery, parseProfessionalRead } from '../dist/professionals/schemas/professional-administration.schemas.js';
import { parseLoginInput } from '../dist/auth/schemas/auth.schemas.js';
const context = { userId: randomUUID(), institutionId: randomUUID(), roleCodes: [], permissions: [] };
const user = { id: randomUUID(), email: 'account@example.test', firstNames: 'Ana', lastNames: 'Prueba' };
const status = code => error => error.getStatus?.() === code;
function setup() {
  const row = { id: randomUUID(), user, internalCode: null, titleOrFunction: null, description: null, status: 'SUSPENDED',
    createdAt: new Date(), updatedAt: new Date(), branchAssignments: [{ branchId: randomUUID() }], serviceAssignments: [{ serviceId: randomUUID() }] };
  const prisma = { userRole: { count: mock.fn(async () => 1) }, institution: { findFirst: mock.fn(async () => ({ id: context.institutionId })) },
    professional: { findMany: mock.fn(async () => [row]) }, user: { findFirst: mock.fn(async () => user) } };
  return { row, prisma, service: new ProfessionalAdministrationService(prisma) };
}
test('HU-030 static endpoints have guards and distinct permissions; public routes unchanged', () => {
  assert.deepEqual(Reflect.getMetadata(GUARDS_METADATA, ProfessionalsController), [AccessTokenGuard]);
  for (const [method, path, permission] of [['administrationList', 'administration', 'professionals.read'], ['eligibleUser', 'eligible-users', 'professionals.create']]) {
    const handler = ProfessionalsController.prototype[method];
    assert.equal(Reflect.getMetadata(PATH_METADATA, handler), path);
    assert.deepEqual(Reflect.getMetadata(GUARDS_METADATA, handler), [AuthorizationContextGuard, PermissionsGuard]);
    assert.deepEqual(Reflect.getMetadata(REQUIRE_PERMISSIONS_KEY, handler), [permission]);
    const controller = new ProfessionalsController({}, {});
    const query = method === 'eligibleUser' ? { email: user.email } : {};
    assert.throws(() => controller[method](undefined, query, {}), status(401));
    assert.throws(() => controller[method](undefined, query, { principal: { userId: randomUUID() }, authorization: context }), status(401));
  }
  for (const method of ['findAll', 'findById']) assert.equal(Reflect.getMetadata(GUARDS_METADATA, ProfessionalsController.prototype[method]), undefined);
  const methods = Object.getOwnPropertyNames(ProfessionalsController.prototype);
  assert.ok(methods.indexOf('eligibleUser') < methods.indexOf('findById'));
  assert.ok(methods.indexOf('administrationList') < methods.indexOf('findById'));
});
test('HU-030 exact email query reuses Auth normalization and rejects unknown/body fields', () => {
  const email = ' Account@Example.Test ';
  assert.equal(parseEligibleUserQuery(undefined, { email }), parseLoginInput({ email, password: 'test' }).email);
  for (const query of [{}, { email: '' }, { email: 'account' }, { email: ['a@example.test', 'b@example.test'] }, { email: user.email, institutionId: context.institutionId }, { email: user.email, limit: '10' }]) {
    assert.throws(() => parseEligibleUserQuery(undefined, query), status(400));
  }
  assert.throws(() => parseEligibleUserQuery({ userId: user.id }, { email: user.email }), status(400));
  assert.throws(() => parseProfessionalRead(undefined, { institutionId: context.institutionId }), status(400));
  assert.throws(() => parseProfessionalRead({ actor: user.id }, {}), status(400));
});
test('HU-030 administrative query scopes tenant, all statuses, active associations and stable order with exact DTO', async () => {
  const { service, prisma, row } = setup();
  const result = await service.list(context);
  assert.deepEqual(Object.keys(result.data[0]).sort(), ['id', 'user', 'internalCode', 'titleOrFunction', 'description', 'status', 'createdAt', 'updatedAt', 'branchIds', 'serviceIds'].sort());
  assert.deepEqual(result.data[0].user, user);
  assert.deepEqual(result.data[0].branchIds, row.branchAssignments.map(b => b.branchId));
  const { where, select, orderBy } = prisma.professional.findMany.mock.calls[0].arguments[0];
  assert.deepEqual(where, { institutionId: context.institutionId, deletedAt: null });
  assert.deepEqual(orderBy, [{ user: { lastNames: 'asc' } }, { user: { firstNames: 'asc' } }, { id: 'asc' }]);
  assert.deepEqual(select.user.select, { id: true, email: true, firstNames: true, lastNames: true });
  assert.deepEqual(select.branchAssignments.where, { active: true, branch: { institutionId: context.institutionId } });
  assert.deepEqual(select.serviceAssignments.where, { active: true, service: { institutionId: context.institutionId } });
  assert.deepEqual(select.branchAssignments.orderBy, { branchId: 'asc' });
  assert.deepEqual(select.serviceAssignments.orderBy, { serviceId: 'asc' });
  for (const field of ['institutionId', 'deletedAt', 'passwordHash', 'sessions']) assert.equal(select[field], undefined);
});
test('HU-030 eligible query is exact, ACTIVE/nondeleted and excludes all existing institution profiles', async () => {
  const { service, prisma } = setup();
  assert.deepEqual(await service.eligibleUser(user.email, context), { data: user });
  assert.deepEqual(prisma.user.findFirst.mock.calls[0].arguments[0], {
    where: { email: user.email, status: 'ACTIVE', deletedAt: null, professionalProfiles: { none: { institutionId: context.institutionId } } },
    select: { id: true, email: true, firstNames: true, lastNames: true },
  });
  prisma.user.findFirst.mock.mockImplementation(async () => null);
  await assert.rejects(service.eligibleUser(user.email, context), error => status(404)(error) && error.message === 'User not available');
});
test('HU-030 reads require selected active institution, live permission and institutional grants', async () => {
  for (const [method, permission] of [['list', 'professionals.read'], ['eligibleUser', 'professionals.create']]) {
    const { service, prisma } = setup();
    const invoke = c => method === 'list' ? service.list(c) : service.eligibleUser(user.email, c);
    await assert.rejects(invoke({ ...context, institutionId: undefined }), status(400));
    await assert.rejects(invoke({ ...context, branchId: randomUUID() }), status(403));
    prisma.userRole.count.mock.mockImplementation(async () => 0);
    await assert.rejects(invoke(context), status(403));
    const grant = prisma.userRole.count.mock.calls[0].arguments[0].where;
    assert.equal(grant.role.permissions.some.permission.code, permission);
    assert.deepEqual(grant.AND[2].OR, [{ role: { scope: 'GLOBAL' } }, { role: { scope: 'INSTITUTION' }, institutionId: context.institutionId }]);
    prisma.userRole.count.mock.mockImplementation(async () => 1);
    prisma.institution.findFirst.mock.mockImplementation(async () => null);
    await assert.rejects(invoke(context), status(404));
    assert.deepEqual(prisma.institution.findFirst.mock.calls[0].arguments[0].where, { id: context.institutionId, status: 'ACTIVE', deletedAt: null });
    assert.equal(prisma.professional.findMany.mock.callCount() + prisma.user.findFirst.mock.callCount(), 0);
  }
});
