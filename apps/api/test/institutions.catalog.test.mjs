import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mock, test } from 'node:test';
import { InstitutionsController } from '../dist/institutions/institutions.controller.js';
import { InstitutionsService } from '../dist/institutions/institutions.service.js';

function hasStatus(status) {
  return (error) =>
    typeof error?.getStatus === 'function' && error.getStatus() === status;
}

function branchRecord(institutionId, overrides = {}) {
  return {
    id: randomUUID(),
    institutionId,
    code: 'CENTRAL',
    name: 'Central',
    addressLine1: 'Main street 1',
    addressLine2: null,
    municipality: 'Santiago',
    region: 'Metropolitana',
    country: 'Chile',
    phone: null,
    email: null,
    status: 'ACTIVE',
    deletedAt: null,
    createdAt: new Date(),
    ...overrides,
  };
}

test('authenticated catalog listing exposes only available institutions safely', async () => {
  const activeId = randomUUID();
  const findMany = mock.fn(async () => [
    {
      id: activeId,
      name: 'Available Institution',
      timeZone: 'America/Santiago',
      status: 'ACTIVE',
      deletedAt: null,
      taxIdentifier: 'must-not-leak',
      roleAssignments: [{ id: 'must-not-leak' }],
    },
    {
      id: randomUUID(),
      name: 'Inactive Institution',
      timeZone: 'America/Santiago',
      status: 'INACTIVE',
      deletedAt: null,
    },
  ]);
  const controller = new InstitutionsController(
    new InstitutionsService({ institution: { findMany } }),
  );

  const result = await controller.findAll();

  assert.deepEqual(result, {
    data: [
      {
        id: activeId,
        name: 'Available Institution',
        timeZone: 'America/Santiago',
      },
    ],
  });
  const query = findMany.mock.calls[0].arguments[0];
  assert.deepEqual(query.where, { status: 'ACTIVE', deletedAt: null });
  assert.deepEqual(query.orderBy, [{ name: 'asc' }, { id: 'asc' }]);
  assert.equal(query.select.taxIdentifier, undefined);
  assert.equal(query.select.roleAssignments, undefined);
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes('taxIdentifier'), false);
  assert.equal(serialized.includes('roleAssignments'), false);
  assert.equal(serialized.includes('deletedAt'), false);
});

test('institution params reject an invalid UUID before calling the service', () => {
  const findById = mock.fn();
  const controller = new InstitutionsController({ findById });

  assert.throws(
    () => controller.findById({ institutionId: 'not-a-uuid' }),
    hasStatus(400),
  );
  assert.equal(findById.mock.callCount(), 0);
});

test('unavailable or missing institution detail returns 404', async () => {
  for (const institution of [
    null,
    {
      id: randomUUID(),
      name: 'Inactive',
      legalName: null,
      contactEmail: null,
      phone: null,
      timeZone: 'America/Santiago',
      status: 'INACTIVE',
      deletedAt: null,
    },
  ]) {
    const findFirst = mock.fn(async () => institution);
    const service = new InstitutionsService({
      institution: { findFirst },
    });

    await assert.rejects(
      service.findById(randomUUID()),
      hasStatus(404),
    );
    assert.deepEqual(findFirst.mock.calls[0].arguments[0].where, {
      id: findFirst.mock.calls[0].arguments[0].where.id,
      status: 'ACTIVE',
      deletedAt: null,
    });
  }
});

test('institution detail exposes only its controlled public profile', async () => {
  const institutionId = randomUUID();
  const findFirst = mock.fn(async () => ({
    id: institutionId,
    name: 'Available Institution',
    legalName: 'Available Institution Ltd.',
    contactEmail: 'contact@example.com',
    phone: '+56 2 0000 0000',
    timeZone: 'America/Santiago',
    status: 'ACTIVE',
    deletedAt: null,
    taxIdentifier: 'must-not-leak',
    createdAt: new Date(),
  }));
  const service = new InstitutionsService({
    institution: { findFirst },
  });

  const result = await service.findById(institutionId);

  assert.deepEqual(result, {
    data: {
      id: institutionId,
      name: 'Available Institution',
      legalName: 'Available Institution Ltd.',
      contactEmail: 'contact@example.com',
      phone: '+56 2 0000 0000',
      timeZone: 'America/Santiago',
    },
  });
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes('taxIdentifier'), false);
  assert.equal(serialized.includes('createdAt'), false);
  assert.equal(serialized.includes('status'), false);
});

test('branch listing keeps only available branches of the requested institution', async () => {
  const institutionId = randomUUID();
  const expectedBranch = branchRecord(institutionId);
  const findFirst = mock.fn(async () => ({
    status: 'ACTIVE',
    deletedAt: null,
    branches: [
      expectedBranch,
      branchRecord(institutionId, { status: 'INACTIVE' }),
      branchRecord(randomUUID()),
    ],
  }));
  const service = new InstitutionsService({
    institution: { findFirst },
  });

  const result = await service.findBranches(institutionId);

  assert.deepEqual(result, {
    data: [
      {
        id: expectedBranch.id,
        institutionId,
        code: 'CENTRAL',
        name: 'Central',
        addressLine1: 'Main street 1',
        addressLine2: null,
        municipality: 'Santiago',
        region: 'Metropolitana',
        country: 'Chile',
        phone: null,
        email: null,
      },
    ],
  });
  const query = findFirst.mock.calls[0].arguments[0];
  assert.deepEqual(query.where, {
    id: institutionId,
    status: 'ACTIVE',
    deletedAt: null,
  });
  assert.deepEqual(query.select.branches.where, {
    status: 'ACTIVE',
    deletedAt: null,
  });
  assert.equal(JSON.stringify(result).includes('createdAt'), false);
});

test('branches are unavailable when their parent institution is unavailable', async () => {
  for (const institution of [
    null,
    { status: 'SUSPENDED', deletedAt: null, branches: [] },
  ]) {
    const service = new InstitutionsService({
      institution: { findFirst: mock.fn(async () => institution) },
    });

    await assert.rejects(
      service.findBranches(randomUUID()),
      hasStatus(404),
    );
  }
});
