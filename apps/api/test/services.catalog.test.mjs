import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mock, test } from 'node:test';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { AccessTokenGuard } from '../dist/auth/guards/access-token.guard.js';
import { InstitutionsController } from '../dist/institutions/institutions.controller.js';
import { BranchesController } from '../dist/services/branches.controller.js';
import { ServicesController } from '../dist/services/services.controller.js';
import { ServicesService } from '../dist/services/services.service.js';

function hasStatus(status) {
  return (error) =>
    typeof error?.getStatus === 'function' && error.getStatus() === status;
}

const institutionId = randomUUID();

function institutionRecord(overrides = {}) {
  return {
    id: institutionId,
    name: 'Institution',
    status: 'ACTIVE',
    deletedAt: null,
    ...overrides,
  };
}

function serviceRecord(overrides = {}) {
  return {
    id: randomUUID(),
    institutionId,
    code: 'GENERAL',
    name: 'General Service',
    description: 'Description',
    durationMinutes: 30,
    active: true,
    deletedAt: null,
    institution: institutionRecord(),
    category: {
      id: randomUUID(),
      institutionId,
      name: 'General Category',
      active: true,
    },
    createdAt: new Date(),
    ...overrides,
  };
}

function branchRecord(serviceId, overrides = {}) {
  return {
    id: randomUUID(),
    institutionId,
    code: 'CENTRAL',
    name: 'Central',
    municipality: 'Santiago',
    region: 'Metropolitana',
    status: 'ACTIVE',
    deletedAt: null,
    institution: {
      status: 'ACTIVE',
      deletedAt: null,
    },
    serviceAssignments: [{ serviceId, active: true }],
    ...overrides,
  };
}

test('catalog controllers require only the access token guard', () => {
  for (const controller of [
    InstitutionsController,
    BranchesController,
    ServicesController,
  ]) {
    assert.deepEqual(Reflect.getMetadata(GUARDS_METADATA, controller), [
      AccessTokenGuard,
    ]);
  }
});

test('service listing exposes only available services and safe category data', async () => {
  const available = serviceRecord();
  const crossTenantCategory = serviceRecord({
    id: randomUUID(),
    name: 'Service Without Public Category',
    category: {
      id: randomUUID(),
      institutionId: randomUUID(),
      name: 'Foreign Category',
      active: true,
    },
  });
  const inactiveCategory = serviceRecord({
    id: randomUUID(),
    name: 'Service With Inactive Category',
    category: {
      id: randomUUID(),
      institutionId,
      name: 'Inactive Category',
      active: false,
    },
  });
  const findMany = mock.fn(async () => [
    available,
    crossTenantCategory,
    inactiveCategory,
    serviceRecord({ active: false }),
    serviceRecord({ deletedAt: new Date() }),
    serviceRecord({
      institution: institutionRecord({ status: 'SUSPENDED' }),
    }),
  ]);
  const service = new ServicesService({ service: { findMany } });

  const result = await service.findAll();

  assert.equal(result.data.length, 3);
  assert.deepEqual(result.data[0], {
    id: available.id,
    code: 'GENERAL',
    name: 'General Service',
    description: 'Description',
    durationMinutes: 30,
    institution: { id: institutionId, name: 'Institution' },
    category: {
      id: available.category.id,
      name: 'General Category',
    },
  });
  assert.equal(result.data[1].category, null);
  assert.equal(result.data[2].category, null);
  const query = findMany.mock.calls[0].arguments[0];
  assert.deepEqual(query.where, {
    active: true,
    deletedAt: null,
    institution: { status: 'ACTIVE', deletedAt: null },
  });
  assert.deepEqual(query.orderBy, [{ name: 'asc' }, { id: 'asc' }]);
  assert.equal(query.select.requirements, undefined);
  assert.equal(query.select.createdAt, undefined);
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes('deletedAt'), false);
  assert.equal(serialized.includes('createdAt'), false);
});

test('service and branch params reject invalid UUIDs before delegation', () => {
  const findById = mock.fn();
  const findByBranch = mock.fn();
  const servicesController = new ServicesController({ findById });
  const branchesController = new BranchesController({ findByBranch });

  assert.throws(
    () => servicesController.findById({ serviceId: 'invalid' }),
    hasStatus(400),
  );
  assert.throws(
    () => branchesController.findServices({ branchId: 'invalid' }),
    hasStatus(400),
  );
  assert.equal(findById.mock.callCount(), 0);
  assert.equal(findByBranch.mock.callCount(), 0);
});

test('branch services use only active assignments for the requested branch', async () => {
  const branchId = randomUUID();
  const otherBranchId = randomUUID();
  const available = {
    ...serviceRecord(),
    branchAssignments: [{ branchId, active: true }],
  };
  const branchFindFirst = mock.fn(async () => ({
    id: branchId,
    institutionId,
    status: 'ACTIVE',
    deletedAt: null,
    institution: { status: 'ACTIVE', deletedAt: null },
  }));
  const serviceFindMany = mock.fn(async () => [
    available,
    {
      ...serviceRecord(),
      branchAssignments: [{ branchId: otherBranchId, active: true }],
    },
    {
      ...serviceRecord({ active: false }),
      branchAssignments: [{ branchId, active: true }],
    },
    {
      ...serviceRecord({
        institutionId: randomUUID(),
        institution: institutionRecord({ id: randomUUID() }),
      }),
      branchAssignments: [{ branchId, active: true }],
    },
  ]);
  const service = new ServicesService({
    branch: { findFirst: branchFindFirst },
    service: { findMany: serviceFindMany },
  });

  const result = await service.findByBranch(branchId);

  assert.deepEqual(result.data.map(({ id }) => id), [available.id]);
  const query = serviceFindMany.mock.calls[0].arguments[0];
  assert.equal(query.where.institutionId, institutionId);
  assert.deepEqual(query.where.branchAssignments, {
    some: { branchId, active: true },
  });
  assert.deepEqual(query.select.branchAssignments.where, {
    branchId,
    active: true,
  });
});

test('an unavailable branch returns 404 without querying services', async () => {
  for (const branch of [
    null,
    {
      id: randomUUID(),
      institutionId,
      status: 'INACTIVE',
      deletedAt: null,
      institution: { status: 'ACTIVE', deletedAt: null },
    },
  ]) {
    const serviceFindMany = mock.fn();
    const service = new ServicesService({
      branch: { findFirst: mock.fn(async () => branch) },
      service: { findMany: serviceFindMany },
    });

    await assert.rejects(
      service.findByBranch(randomUUID()),
      hasStatus(404),
    );
    assert.equal(serviceFindMany.mock.callCount(), 0);
  }
});

test('an unavailable service returns 404 without querying branches', async () => {
  for (const unavailableService of [
    null,
    serviceRecord({ active: false }),
  ]) {
    const branchFindMany = mock.fn();
    const service = new ServicesService({
      service: { findFirst: mock.fn(async () => unavailableService) },
      branch: { findMany: branchFindMany },
    });

    await assert.rejects(service.findById(randomUUID()), hasStatus(404));
    assert.equal(branchFindMany.mock.callCount(), 0);
  }
});

test('service detail includes only active requirements and available branches', async () => {
  const serviceId = randomUUID();
  const requirementId = randomUUID();
  const detail = {
    ...serviceRecord({ id: serviceId }),
    minimumAdvanceMinutes: 60,
    maximumAdvanceDays: 30,
    allowsWaitlist: true,
    requiresConfirmation: false,
    requirements: [
      {
        id: requirementId,
        name: 'Identity document',
        description: null,
        required: true,
        order: 1,
        active: true,
        createdAt: new Date(),
      },
      {
        id: randomUUID(),
        name: 'Inactive requirement',
        description: null,
        required: false,
        order: 2,
        active: false,
      },
    ],
  };
  const availableBranch = branchRecord(serviceId);
  const serviceFindFirst = mock.fn(async () => detail);
  const branchFindMany = mock.fn(async () => [
    availableBranch,
    branchRecord(serviceId, { status: 'INACTIVE' }),
    branchRecord(serviceId, { institutionId: randomUUID() }),
    branchRecord(randomUUID()),
  ]);
  const service = new ServicesService({
    service: { findFirst: serviceFindFirst },
    branch: { findMany: branchFindMany },
  });

  const result = await service.findById(serviceId);

  assert.deepEqual(result.data.requirements, [
    {
      id: requirementId,
      name: 'Identity document',
      description: null,
      required: true,
      order: 1,
    },
  ]);
  assert.deepEqual(result.data.branches, [
    {
      id: availableBranch.id,
      code: 'CENTRAL',
      name: 'Central',
      municipality: 'Santiago',
      region: 'Metropolitana',
    },
  ]);
  const serviceQuery = serviceFindFirst.mock.calls[0].arguments[0];
  assert.deepEqual(serviceQuery.select.requirements.where, { active: true });
  assert.deepEqual(serviceQuery.select.requirements.orderBy, [
    { order: 'asc' },
    { id: 'asc' },
  ]);
  const branchQuery = branchFindMany.mock.calls[0].arguments[0];
  assert.equal(branchQuery.where.institutionId, institutionId);
  assert.deepEqual(branchQuery.where.serviceAssignments, {
    some: { serviceId, active: true },
  });
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes('active'), false);
  assert.equal(serialized.includes('createdAt'), false);
});
