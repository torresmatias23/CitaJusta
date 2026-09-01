import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mock, test } from 'node:test';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { AccessTokenGuard } from '../dist/auth/guards/access-token.guard.js';
import { ProfessionalRelationsController } from '../dist/professionals/professional-relations.controller.js';
import { ProfessionalsController } from '../dist/professionals/professionals.controller.js';
import { ProfessionalsService } from '../dist/professionals/professionals.service.js';

function hasStatus(status) {
  return (error) =>
    typeof error?.getStatus === 'function' && error.getStatus() === status;
}

const institutionA = randomUUID();
const institutionB = randomUUID();

function institutionRecord(id = institutionA, overrides = {}) {
  return {
    id,
    name: id === institutionA ? 'Institution A' : 'Institution B',
    status: 'ACTIVE',
    deletedAt: null,
    ...overrides,
  };
}

function professionalRecord(overrides = {}) {
  const professionalInstitutionId =
    overrides.institutionId ?? institutionA;

  return {
    id: randomUUID(),
    institutionId: professionalInstitutionId,
    titleOrFunction: 'General Practitioner',
    description: 'Public profile',
    status: 'ACTIVE',
    deletedAt: null,
    institution: institutionRecord(professionalInstitutionId),
    user: {
      firstNames: 'Ana María',
      lastNames: 'Pérez Soto',
      email: 'must-not-leak@example.com',
      passwordHash: 'must-not-leak',
      roles: [{ code: 'must-not-leak' }],
    },
    internalCode: 'must-not-leak',
    createdAt: new Date(),
    ...overrides,
  };
}

function branchRecord(overrides = {}) {
  const branchInstitutionId = overrides.institutionId ?? institutionA;

  return {
    id: randomUUID(),
    institutionId: branchInstitutionId,
    status: 'ACTIVE',
    deletedAt: null,
    institution: institutionRecord(branchInstitutionId),
    ...overrides,
  };
}

function serviceRecord(overrides = {}) {
  const serviceInstitutionId = overrides.institutionId ?? institutionA;

  return {
    id: randomUUID(),
    institutionId: serviceInstitutionId,
    active: true,
    deletedAt: null,
    institution: institutionRecord(serviceInstitutionId),
    ...overrides,
  };
}

function professionalServiceRecord(professionalId, overrides = {}) {
  const serviceInstitutionId = overrides.institutionId ?? institutionA;

  return {
    id: randomUUID(),
    institutionId: serviceInstitutionId,
    code: 'GENERAL',
    name: 'General Service',
    description: 'Service description',
    durationMinutes: 30,
    active: true,
    deletedAt: null,
    institution: institutionRecord(serviceInstitutionId),
    professionalAssignments: [
      {
        professionalId,
        customDurationMinutes: 45,
        active: true,
      },
    ],
    ...overrides,
  };
}

function professionalBranchRecord(professionalId, overrides = {}) {
  const branchInstitutionId = overrides.institutionId ?? institutionA;

  return {
    id: randomUUID(),
    institutionId: branchInstitutionId,
    code: 'CENTRAL',
    name: 'Central',
    municipality: 'Santiago',
    region: 'Metropolitana',
    status: 'ACTIVE',
    deletedAt: null,
    institution: institutionRecord(branchInstitutionId),
    professionalAssignments: [{ professionalId, active: true }],
    ...overrides,
  };
}

function serviceBranchRecord(overrides = {}) {
  return {
    active: true,
    branch: branchRecord(),
    service: serviceRecord(),
    ...overrides,
  };
}

test('professional catalog controllers require only AccessTokenGuard', () => {
  for (const controller of [
    ProfessionalsController,
    ProfessionalRelationsController,
  ]) {
    assert.deepEqual(Reflect.getMetadata(GUARDS_METADATA, controller), [
      AccessTokenGuard,
    ]);
  }
});

test('professional catalog params reject invalid UUIDs before delegation', () => {
  const findById = mock.fn();
  const findByBranch = mock.fn();
  const findByService = mock.fn();
  const findByBranchAndService = mock.fn();
  const professionalsController = new ProfessionalsController({ findById });
  const relationsController = new ProfessionalRelationsController({
    findByBranch,
    findByService,
    findByBranchAndService,
  });
  const validId = randomUUID();

  assert.throws(
    () => professionalsController.findById({ professionalId: 'invalid' }),
    hasStatus(400),
  );
  assert.throws(
    () => relationsController.findByBranch({ branchId: 'invalid' }),
    hasStatus(400),
  );
  assert.throws(
    () => relationsController.findByService({ serviceId: 'invalid' }),
    hasStatus(400),
  );
  assert.throws(
    () =>
      relationsController.findByBranchAndService({
        branchId: 'invalid',
        serviceId: validId,
      }),
    hasStatus(400),
  );
  assert.throws(
    () =>
      relationsController.findByBranchAndService({
        branchId: validId,
        serviceId: 'invalid',
      }),
    hasStatus(400),
  );
  assert.equal(findById.mock.callCount(), 0);
  assert.equal(findByBranch.mock.callCount(), 0);
  assert.equal(findByService.mock.callCount(), 0);
  assert.equal(findByBranchAndService.mock.callCount(), 0);
});

test('professional listing exposes only available records safely', async () => {
  const available = professionalRecord();
  const findMany = mock.fn(async () => [
    available,
    professionalRecord({ status: 'INACTIVE' }),
    professionalRecord({ status: 'SUSPENDED' }),
    professionalRecord({ deletedAt: new Date() }),
    professionalRecord({
      institution: institutionRecord(institutionA, { status: 'INACTIVE' }),
    }),
    professionalRecord({
      institutionId: institutionB,
      institution: institutionRecord(institutionA),
    }),
  ]);
  const service = new ProfessionalsService({
    professional: { findMany },
  });

  const result = await service.findAll();

  assert.deepEqual(result, {
    data: [
      {
        id: available.id,
        firstNames: 'Ana María',
        lastNames: 'Pérez Soto',
        titleOrFunction: 'General Practitioner',
        description: 'Public profile',
        institution: {
          id: institutionA,
          name: 'Institution A',
        },
      },
    ],
  });
  const query = findMany.mock.calls[0].arguments[0];
  assert.deepEqual(query.where, {
    status: 'ACTIVE',
    deletedAt: null,
    institution: { status: 'ACTIVE', deletedAt: null },
  });
  assert.deepEqual(query.orderBy, [
    { user: { lastNames: 'asc' } },
    { user: { firstNames: 'asc' } },
    { id: 'asc' },
  ]);
  assert.deepEqual(query.select.user, {
    select: { firstNames: true, lastNames: true },
  });
  assert.equal(query.select.internalCode, undefined);
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes('internalCode'), false);
  assert.equal(serialized.includes('email'), false);
  assert.equal(serialized.includes('passwordHash'), false);
  assert.equal(serialized.includes('createdAt'), false);
});

test('missing or unavailable professional detail returns 404', async () => {
  for (const professional of [
    null,
    professionalRecord({ status: 'INACTIVE' }),
    professionalRecord({ deletedAt: new Date() }),
    professionalRecord({
      institution: institutionRecord(institutionA, { status: 'SUSPENDED' }),
    }),
  ]) {
    const serviceFindMany = mock.fn();
    const branchFindMany = mock.fn();
    const service = new ProfessionalsService({
      professional: { findFirst: mock.fn(async () => professional) },
      service: { findMany: serviceFindMany },
      branch: { findMany: branchFindMany },
    });

    await assert.rejects(service.findById(randomUUID()), hasStatus(404));
    assert.equal(serviceFindMany.mock.callCount(), 0);
    assert.equal(branchFindMany.mock.callCount(), 0);
  }
});

test('professional detail maps only active and coherent relations', async () => {
  const professionalId = randomUUID();
  const professional = professionalRecord({ id: professionalId });
  const availableService = professionalServiceRecord(professionalId);
  const availableBranch = professionalBranchRecord(professionalId);
  const serviceFindMany = mock.fn(async () => [
    availableService,
    professionalServiceRecord(professionalId, {
      professionalAssignments: [
        {
          professionalId,
          customDurationMinutes: null,
          active: false,
        },
      ],
    }),
    professionalServiceRecord(randomUUID()),
    professionalServiceRecord(professionalId, {
      institutionId: institutionB,
      institution: institutionRecord(institutionB),
    }),
    professionalServiceRecord(professionalId, { active: false }),
  ]);
  const branchFindMany = mock.fn(async () => [
    availableBranch,
    professionalBranchRecord(professionalId, {
      professionalAssignments: [
        { professionalId, active: false },
      ],
    }),
    professionalBranchRecord(randomUUID()),
    professionalBranchRecord(professionalId, {
      institutionId: institutionB,
      institution: institutionRecord(institutionB),
    }),
    professionalBranchRecord(professionalId, { status: 'INACTIVE' }),
  ]);
  const service = new ProfessionalsService({
    professional: { findFirst: mock.fn(async () => professional) },
    service: { findMany: serviceFindMany },
    branch: { findMany: branchFindMany },
  });

  const result = await service.findById(professionalId);

  assert.deepEqual(result.data.services, [
    {
      id: availableService.id,
      code: 'GENERAL',
      name: 'General Service',
      description: 'Service description',
      durationMinutes: 30,
      customDurationMinutes: 45,
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
  const serviceQuery = serviceFindMany.mock.calls[0].arguments[0];
  assert.equal(serviceQuery.where.institutionId, institutionA);
  assert.deepEqual(serviceQuery.where.professionalAssignments, {
    some: { professionalId, active: true },
  });
  const branchQuery = branchFindMany.mock.calls[0].arguments[0];
  assert.equal(branchQuery.where.institutionId, institutionA);
  assert.deepEqual(branchQuery.where.professionalAssignments, {
    some: { professionalId, active: true },
  });
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes('internalCode'), false);
  assert.equal(serialized.includes('professionalAssignments'), false);
  assert.equal(serialized.includes('deletedAt'), false);
});

test('branch professionals require the exact active branch assignment', async () => {
  const branchId = randomUUID();
  const branch = branchRecord({ id: branchId });
  const available = {
    ...professionalRecord(),
    branchAssignments: [{ branchId, active: true }],
  };
  const professionalFindMany = mock.fn(async () => [
    available,
    {
      ...professionalRecord(),
      branchAssignments: [{ branchId, active: false }],
    },
    {
      ...professionalRecord(),
      branchAssignments: [{ branchId: randomUUID(), active: true }],
    },
    {
      ...professionalRecord({ status: 'INACTIVE' }),
      branchAssignments: [{ branchId, active: true }],
    },
    {
      ...professionalRecord({
        institutionId: institutionB,
        institution: institutionRecord(institutionB),
      }),
      branchAssignments: [{ branchId, active: true }],
    },
  ]);
  const service = new ProfessionalsService({
    branch: { findFirst: mock.fn(async () => branch) },
    professional: { findMany: professionalFindMany },
  });

  const result = await service.findByBranch(branchId);

  assert.deepEqual(result.data.map(({ id }) => id), [available.id]);
  const query = professionalFindMany.mock.calls[0].arguments[0];
  assert.equal(query.where.institutionId, institutionA);
  assert.deepEqual(query.where.branchAssignments, {
    some: { branchId, active: true },
  });
  assert.deepEqual(query.select.branchAssignments.where, {
    branchId,
    active: true,
  });
});

test('unavailable branch returns 404 before querying professionals', async () => {
  for (const branch of [
    null,
    branchRecord({ status: 'INACTIVE' }),
    branchRecord({ deletedAt: new Date() }),
    branchRecord({
      institution: institutionRecord(institutionA, { status: 'INACTIVE' }),
    }),
    branchRecord({ institution: institutionRecord(institutionB) }),
  ]) {
    const professionalFindMany = mock.fn();
    const service = new ProfessionalsService({
      branch: { findFirst: mock.fn(async () => branch) },
      professional: { findMany: professionalFindMany },
    });

    await assert.rejects(
      service.findByBranch(randomUUID()),
      hasStatus(404),
    );
    assert.equal(professionalFindMany.mock.callCount(), 0);
  }
});

test('service professionals require the exact active service assignment', async () => {
  const serviceId = randomUUID();
  const availableService = serviceRecord({ id: serviceId });
  const available = {
    ...professionalRecord(),
    serviceAssignments: [{ serviceId, active: true }],
  };
  const professionalFindMany = mock.fn(async () => [
    available,
    {
      ...professionalRecord(),
      serviceAssignments: [{ serviceId, active: false }],
    },
    {
      ...professionalRecord(),
      serviceAssignments: [{ serviceId: randomUUID(), active: true }],
    },
    {
      ...professionalRecord({ deletedAt: new Date() }),
      serviceAssignments: [{ serviceId, active: true }],
    },
    {
      ...professionalRecord({
        institutionId: institutionB,
        institution: institutionRecord(institutionB),
      }),
      serviceAssignments: [{ serviceId, active: true }],
    },
  ]);
  const service = new ProfessionalsService({
    service: { findFirst: mock.fn(async () => availableService) },
    professional: { findMany: professionalFindMany },
  });

  const result = await service.findByService(serviceId);

  assert.deepEqual(result.data.map(({ id }) => id), [available.id]);
  const query = professionalFindMany.mock.calls[0].arguments[0];
  assert.equal(query.where.institutionId, institutionA);
  assert.deepEqual(query.where.serviceAssignments, {
    some: { serviceId, active: true },
  });
  assert.deepEqual(query.select.serviceAssignments.where, {
    serviceId,
    active: true,
  });
});

test('unavailable service returns 404 before querying professionals', async () => {
  for (const serviceRecordValue of [
    null,
    serviceRecord({ active: false }),
    serviceRecord({ deletedAt: new Date() }),
    serviceRecord({
      institution: institutionRecord(institutionA, { status: 'SUSPENDED' }),
    }),
    serviceRecord({ institution: institutionRecord(institutionB) }),
  ]) {
    const professionalFindMany = mock.fn();
    const service = new ProfessionalsService({
      service: { findFirst: mock.fn(async () => serviceRecordValue) },
      professional: { findMany: professionalFindMany },
    });

    await assert.rejects(
      service.findByService(randomUUID()),
      hasStatus(404),
    );
    assert.equal(professionalFindMany.mock.callCount(), 0);
  }
});

test('combined catalog rejects unavailable or incoherent branch-service links', async () => {
  const branchId = randomUUID();
  const serviceId = randomUUID();
  const incompatibleRecords = [
    null,
    serviceBranchRecord({ active: false }),
    serviceBranchRecord({
      branch: branchRecord({ id: branchId, status: 'INACTIVE' }),
      service: serviceRecord({ id: serviceId }),
    }),
    serviceBranchRecord({
      branch: branchRecord({ id: branchId }),
      service: serviceRecord({ id: serviceId, active: false }),
    }),
    serviceBranchRecord({
      branch: branchRecord({ id: branchId }),
      service: serviceRecord({
        id: serviceId,
        institutionId: institutionB,
        institution: institutionRecord(institutionB),
      }),
    }),
    serviceBranchRecord({
      branch: branchRecord({ id: randomUUID() }),
      service: serviceRecord({ id: serviceId }),
    }),
    serviceBranchRecord({
      branch: branchRecord({ id: branchId }),
      service: serviceRecord({ id: randomUUID() }),
    }),
  ];

  for (const availability of incompatibleRecords) {
    const professionalFindMany = mock.fn();
    const serviceBranchFindFirst = mock.fn(async () => availability);
    const service = new ProfessionalsService({
      serviceBranch: { findFirst: serviceBranchFindFirst },
      professional: { findMany: professionalFindMany },
    });

    await assert.rejects(
      service.findByBranchAndService(branchId, serviceId),
      hasStatus(404),
    );
    assert.equal(professionalFindMany.mock.callCount(), 0);
    assert.deepEqual(serviceBranchFindFirst.mock.calls[0].arguments[0].where, {
      branchId,
      serviceId,
      active: true,
      branch: {
        status: 'ACTIVE',
        deletedAt: null,
        institution: { status: 'ACTIVE', deletedAt: null },
      },
      service: {
        active: true,
        deletedAt: null,
        institution: { status: 'ACTIVE', deletedAt: null },
      },
    });
  }
});

test('combined catalog returns the strict branch and service intersection', async () => {
  const branchId = randomUUID();
  const serviceId = randomUUID();
  const availability = serviceBranchRecord({
    branch: branchRecord({ id: branchId }),
    service: serviceRecord({ id: serviceId }),
  });
  const compatible = {
    ...professionalRecord(),
    branchAssignments: [{ branchId, active: true }],
    serviceAssignments: [{ serviceId, active: true }],
  };
  const professionalFindMany = mock.fn(async () => [
    compatible,
    {
      ...professionalRecord(),
      branchAssignments: [],
      serviceAssignments: [{ serviceId, active: true }],
    },
    {
      ...professionalRecord(),
      branchAssignments: [{ branchId, active: true }],
      serviceAssignments: [],
    },
    {
      ...professionalRecord(),
      branchAssignments: [{ branchId, active: false }],
      serviceAssignments: [{ serviceId, active: true }],
    },
    {
      ...professionalRecord(),
      branchAssignments: [{ branchId, active: true }],
      serviceAssignments: [{ serviceId, active: false }],
    },
    {
      ...professionalRecord({ status: 'INACTIVE' }),
      branchAssignments: [{ branchId, active: true }],
      serviceAssignments: [{ serviceId, active: true }],
    },
    {
      ...professionalRecord({
        institutionId: institutionB,
        institution: institutionRecord(institutionB),
      }),
      branchAssignments: [{ branchId, active: true }],
      serviceAssignments: [{ serviceId, active: true }],
    },
  ]);
  const service = new ProfessionalsService({
    serviceBranch: { findFirst: mock.fn(async () => availability) },
    professional: { findMany: professionalFindMany },
  });

  const result = await service.findByBranchAndService(branchId, serviceId);

  assert.deepEqual(result.data.map(({ id }) => id), [compatible.id]);
  const query = professionalFindMany.mock.calls[0].arguments[0];
  assert.equal(query.where.institutionId, institutionA);
  assert.deepEqual(query.where.branchAssignments, {
    some: { branchId, active: true },
  });
  assert.deepEqual(query.where.serviceAssignments, {
    some: { serviceId, active: true },
  });
  assert.deepEqual(query.select.branchAssignments.where, {
    branchId,
    active: true,
  });
  assert.deepEqual(query.select.serviceAssignments.where, {
    serviceId,
    active: true,
  });
});
