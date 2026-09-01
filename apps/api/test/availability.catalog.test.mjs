import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mock, test } from 'node:test';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { AvailabilityController } from '../dist/availability/availability.controller.js';
import { AgendaAvailabilityService } from '../dist/availability/availability.service.js';
import { AccessTokenGuard } from '../dist/auth/guards/access-token.guard.js';

function hasStatus(status) {
  return (error) =>
    typeof error?.getStatus === 'function' && error.getStatus() === status;
}

const institutionA = randomUUID();
const institutionB = randomUUID();

function institutionRecord(id = institutionA, overrides = {}) {
  return {
    id,
    status: 'ACTIVE',
    deletedAt: null,
    ...overrides,
  };
}

function branchRecord(branchId, overrides = {}) {
  const institutionId = overrides.institutionId ?? institutionA;

  return {
    id: branchId,
    institutionId,
    status: 'ACTIVE',
    deletedAt: null,
    institution: institutionRecord(institutionId),
    ...overrides,
  };
}

function serviceRecord(serviceId, overrides = {}) {
  const institutionId = overrides.institutionId ?? institutionA;

  return {
    id: serviceId,
    institutionId,
    active: true,
    deletedAt: null,
    institution: institutionRecord(institutionId),
    ...overrides,
  };
}

function serviceBranchRecord(branchId, serviceId, overrides = {}) {
  return {
    active: true,
    branch: branchRecord(branchId),
    service: serviceRecord(serviceId),
    ...overrides,
  };
}

function professionalRecord(context, overrides = {}) {
  const institutionId = overrides.institutionId ?? institutionA;

  return {
    id: overrides.id ?? randomUUID(),
    institutionId,
    titleOrFunction: 'General Practitioner',
    status: 'ACTIVE',
    deletedAt: null,
    institution: institutionRecord(institutionId),
    user: {
      firstNames: 'Ana María',
      lastNames: 'Pérez Soto',
      email: 'must-not-leak@example.com',
      passwordHash: 'must-not-leak',
      roles: [{ code: 'must-not-leak' }],
    },
    branchAssignments: [
      { branchId: context.branchId, active: true },
    ],
    serviceAssignments: [
      { serviceId: context.serviceId, active: true },
    ],
    internalCode: 'must-not-leak',
    ...overrides,
  };
}

function slotRecord(context, startsAt, overrides = {}) {
  const professional =
    overrides.availability?.professional ?? professionalRecord(context);
  const availability = {
    active: true,
    branchId: context.branchId,
    serviceId: context.serviceId,
    professionalId: professional.id,
    attentionPointId: null,
    attentionPoint: null,
    professional,
    ...overrides.availability,
  };
  const { availability: _availability, ...slotOverrides } = overrides;

  return {
    id: randomUUID(),
    startsAt,
    endsAt: new Date(startsAt.getTime() + 30 * 60 * 1000),
    status: 'AVAILABLE',
    blockedUntilAt: null,
    availability,
    lockVersion: 7,
    versionLock: 8,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...slotOverrides,
  };
}

function futureRange() {
  const from = new Date(Date.now() + 60 * 60 * 1000);

  return {
    from,
    to: new Date(from.getTime() + 4 * 60 * 60 * 1000),
  };
}

test('availability controller requires only AccessTokenGuard', () => {
  assert.deepEqual(
    Reflect.getMetadata(GUARDS_METADATA, AvailabilityController),
    [AccessTokenGuard],
  );
});

test('availability range accepts timezone timestamps and delegates with Date values', async () => {
  const branchId = randomUUID();
  const serviceId = randomUUID();
  const expected = { data: [] };
  const findAvailableSlots = mock.fn(async () => expected);
  const controller = new AvailabilityController({ findAvailableSlots });

  const result = await controller.findAvailableSlots(
    { branchId, serviceId },
    {
      from: '2026-09-01T00:00:00.000+03:00',
      to: '2026-09-01T01:00:00.000+03:00',
    },
  );

  assert.deepEqual(result, expected);
  const [actualBranchId, actualServiceId, range] =
    findAvailableSlots.mock.calls[0].arguments;
  assert.equal(actualBranchId, branchId);
  assert.equal(actualServiceId, serviceId);
  assert.equal(range.from.toISOString(), '2026-08-31T21:00:00.000Z');
  assert.equal(range.to.toISOString(), '2026-08-31T22:00:00.000Z');
});

test('availability params and ranges reject invalid input before delegation', () => {
  const branchId = randomUUID();
  const serviceId = randomUUID();
  const professionalId = randomUUID();
  const findAvailableSlots = mock.fn();
  const findAvailableSlotsByProfessional = mock.fn();
  const controller = new AvailabilityController({
    findAvailableSlots,
    findAvailableSlotsByProfessional,
  });
  const validRange = {
    from: '2026-09-01T00:00:00.000Z',
    to: '2026-09-02T00:00:00.000Z',
  };

  const invalidCalls = [
    () =>
      controller.findAvailableSlots(
        { branchId: 'invalid', serviceId },
        validRange,
      ),
    () =>
      controller.findAvailableSlots(
        { branchId, serviceId: 'invalid' },
        validRange,
      ),
    () =>
      controller.findAvailableSlotsByProfessional(
        { branchId, serviceId, professionalId: 'invalid' },
        validRange,
      ),
    () =>
      controller.findAvailableSlots(
        { branchId, serviceId },
        { to: validRange.to },
      ),
    () =>
      controller.findAvailableSlots(
        { branchId, serviceId },
        { from: validRange.from },
      ),
    () =>
      controller.findAvailableSlots(
        { branchId, serviceId },
        { from: 'invalid', to: validRange.to },
      ),
    () =>
      controller.findAvailableSlots(
        { branchId, serviceId },
        { from: validRange.from, to: 'invalid' },
      ),
    () =>
      controller.findAvailableSlots(
        { branchId, serviceId },
        {
          from: '2026-09-01T00:00:00.000',
          to: validRange.to,
        },
      ),
    () =>
      controller.findAvailableSlots(
        { branchId, serviceId },
        { from: validRange.from, to: validRange.from },
      ),
    () =>
      controller.findAvailableSlots(
        { branchId, serviceId },
        { from: validRange.to, to: validRange.from },
      ),
  ];

  for (const invalidCall of invalidCalls) {
    assert.throws(invalidCall, hasStatus(400));
  }

  assert.equal(findAvailableSlots.mock.callCount(), 0);
  assert.equal(findAvailableSlotsByProfessional.mock.callCount(), 0);
});

test('aggregate availability rejects unavailable or incoherent context', async () => {
  const branchId = randomUUID();
  const serviceId = randomUUID();
  const range = futureRange();
  const invalidContexts = [
    null,
    serviceBranchRecord(branchId, serviceId, { active: false }),
    serviceBranchRecord(branchId, serviceId, {
      branch: branchRecord(branchId, { status: 'INACTIVE' }),
    }),
    serviceBranchRecord(branchId, serviceId, {
      branch: branchRecord(branchId, { deletedAt: new Date() }),
    }),
    serviceBranchRecord(branchId, serviceId, {
      branch: branchRecord(branchId, {
        institution: institutionRecord(institutionA, {
          status: 'SUSPENDED',
        }),
      }),
    }),
    serviceBranchRecord(branchId, serviceId, {
      service: serviceRecord(serviceId, { active: false }),
    }),
    serviceBranchRecord(branchId, serviceId, {
      service: serviceRecord(serviceId, { deletedAt: new Date() }),
    }),
    serviceBranchRecord(branchId, serviceId, {
      service: serviceRecord(serviceId, {
        institution: institutionRecord(institutionA, {
          status: 'INACTIVE',
        }),
      }),
    }),
    serviceBranchRecord(branchId, serviceId, {
      branch: branchRecord(randomUUID()),
    }),
    serviceBranchRecord(branchId, serviceId, {
      service: serviceRecord(randomUUID()),
    }),
    serviceBranchRecord(branchId, serviceId, {
      service: serviceRecord(serviceId, {
        institutionId: institutionB,
        institution: institutionRecord(institutionB),
      }),
    }),
  ];

  for (const contextRecord of invalidContexts) {
    const agendaSlotFindMany = mock.fn();
    const service = new AgendaAvailabilityService({
      serviceBranch: {
        findFirst: mock.fn(async () => contextRecord),
      },
      agendaSlot: { findMany: agendaSlotFindMany },
    });

    await assert.rejects(
      service.findAvailableSlots(branchId, serviceId, range),
      hasStatus(404),
    );
    assert.equal(agendaSlotFindMany.mock.callCount(), 0);
  }
});

test('aggregate availability returns only reservable materialized slots safely', async () => {
  const branchId = randomUUID();
  const serviceId = randomUUID();
  const context = { branchId, serviceId };
  const range = futureRange();
  const firstStart = new Date(range.from.getTime() + 30 * 60 * 1000);
  const secondStart = new Date(range.from.getTime() + 60 * 60 * 1000);
  const first = slotRecord(context, firstStart);
  const second = slotRecord(context, secondStart);
  const attentionPointId = randomUUID();
  const agendaSlotFindMany = mock.fn(async () => [
    first,
    second,
    slotRecord(context, secondStart, { status: 'RESERVED' }),
    slotRecord(context, secondStart, { status: 'BLOCKED' }),
    slotRecord(context, secondStart, { status: 'RELEASED' }),
    slotRecord(context, secondStart, { status: 'EXPIRED' }),
    slotRecord(context, new Date(range.from.getTime() - 1)),
    slotRecord(context, range.to),
    slotRecord(context, secondStart, {
      blockedUntilAt: new Date(Date.now() + 60 * 60 * 1000),
    }),
    slotRecord(context, secondStart, {
      availability: { active: false },
    }),
    slotRecord(context, secondStart, {
      availability: { branchId: randomUUID() },
    }),
    slotRecord(context, secondStart, {
      availability: { serviceId: randomUUID() },
    }),
    slotRecord(context, secondStart, {
      availability: {
        professional: professionalRecord(context, {
          status: 'INACTIVE',
        }),
      },
    }),
    slotRecord(context, secondStart, {
      availability: {
        professional: professionalRecord(context, {
          branchAssignments: [{ branchId, active: false }],
        }),
      },
    }),
    slotRecord(context, secondStart, {
      availability: {
        professional: professionalRecord(context, {
          serviceAssignments: [{ serviceId, active: false }],
        }),
      },
    }),
    slotRecord(context, secondStart, {
      availability: {
        professional: professionalRecord(context, {
          institutionId: institutionB,
          institution: institutionRecord(institutionB),
        }),
      },
    }),
    slotRecord(context, secondStart, {
      availability: {
        attentionPointId,
        attentionPoint: {
          id: attentionPointId,
          branchId,
          active: false,
        },
      },
    }),
    slotRecord(context, secondStart, {
      endsAt: new Date(secondStart.getTime() - 1),
    }),
  ]);
  const professionalScheduleFindMany = mock.fn();
  const availabilityFindMany = mock.fn();
  const scheduleBlockFindMany = mock.fn();
  const holidayFindMany = mock.fn();
  const service = new AgendaAvailabilityService({
    serviceBranch: {
      findFirst: mock.fn(async () =>
        serviceBranchRecord(branchId, serviceId),
      ),
    },
    agendaSlot: { findMany: agendaSlotFindMany },
    professionalSchedule: { findMany: professionalScheduleFindMany },
    availability: { findMany: availabilityFindMany },
    scheduleBlock: { findMany: scheduleBlockFindMany },
    holiday: { findMany: holidayFindMany },
  });

  const result = await service.findAvailableSlots(
    branchId,
    serviceId,
    range,
  );

  assert.deepEqual(result.data, [
    {
      id: first.id,
      startsAt: first.startsAt.toISOString(),
      endsAt: first.endsAt.toISOString(),
      professional: {
        id: first.availability.professional.id,
        firstNames: 'Ana María',
        lastNames: 'Pérez Soto',
        titleOrFunction: 'General Practitioner',
      },
    },
    {
      id: second.id,
      startsAt: second.startsAt.toISOString(),
      endsAt: second.endsAt.toISOString(),
      professional: {
        id: second.availability.professional.id,
        firstNames: 'Ana María',
        lastNames: 'Pérez Soto',
        titleOrFunction: 'General Practitioner',
      },
    },
  ]);
  const query = agendaSlotFindMany.mock.calls[0].arguments[0];
  assert.equal(query.where.status, 'AVAILABLE');
  assert.deepEqual(query.where.startsAt, {
    gte: range.from,
    lt: range.to,
  });
  assert.equal(query.where.availability.active, true);
  assert.equal(query.where.availability.branchId, branchId);
  assert.equal(query.where.availability.serviceId, serviceId);
  assert.deepEqual(query.where.availability.service.branchAssignments, {
    some: { branchId, active: true },
  });
  assert.deepEqual(query.where.availability.professional.branchAssignments, {
    some: { branchId, active: true },
  });
  assert.deepEqual(query.where.availability.professional.serviceAssignments, {
    some: { serviceId, active: true },
  });
  assert.deepEqual(query.orderBy, [
    { startsAt: 'asc' },
    { id: 'asc' },
  ]);
  assert.equal(query.select.lockVersion, undefined);
  assert.equal(query.select.versionLock, undefined);
  assert.equal(query.select.createdAt, undefined);
  assert.equal(professionalScheduleFindMany.mock.callCount(), 0);
  assert.equal(availabilityFindMany.mock.callCount(), 0);
  assert.equal(scheduleBlockFindMany.mock.callCount(), 0);
  assert.equal(holidayFindMany.mock.callCount(), 0);
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes('lockVersion'), false);
  assert.equal(serialized.includes('versionLock'), false);
  assert.equal(serialized.includes('blockedUntilAt'), false);
  assert.equal(serialized.includes('status'), false);
  assert.equal(serialized.includes('passwordHash'), false);
  assert.equal(serialized.includes('email'), false);
  assert.equal(serialized.includes('roles'), false);
});

test('a partially past range starts querying at the current time', async () => {
  const branchId = randomUUID();
  const serviceId = randomUUID();
  const context = { branchId, serviceId };
  const callStartedAt = new Date();
  const range = {
    from: new Date(callStartedAt.getTime() - 60 * 60 * 1000),
    to: new Date(callStartedAt.getTime() + 2 * 60 * 60 * 1000),
  };
  const pastSlot = slotRecord(
    context,
    new Date(callStartedAt.getTime() - 30 * 60 * 1000),
  );
  const futureSlot = slotRecord(
    context,
    new Date(callStartedAt.getTime() + 60 * 60 * 1000),
  );
  const agendaSlotFindMany = mock.fn(async () => [pastSlot, futureSlot]);
  const service = new AgendaAvailabilityService({
    serviceBranch: {
      findFirst: mock.fn(async () =>
        serviceBranchRecord(branchId, serviceId),
      ),
    },
    agendaSlot: { findMany: agendaSlotFindMany },
  });

  const result = await service.findAvailableSlots(
    branchId,
    serviceId,
    range,
  );
  const callFinishedAt = new Date();
  const effectiveFrom =
    agendaSlotFindMany.mock.calls[0].arguments[0].where.startsAt.gte;

  assert.ok(effectiveFrom >= callStartedAt);
  assert.ok(effectiveFrom <= callFinishedAt);
  assert.deepEqual(result.data.map(({ id }) => id), [futureSlot.id]);
});

test('a completely past range returns an empty result without querying slots', async () => {
  const branchId = randomUUID();
  const serviceId = randomUUID();
  const agendaSlotFindMany = mock.fn();
  const service = new AgendaAvailabilityService({
    serviceBranch: {
      findFirst: mock.fn(async () =>
        serviceBranchRecord(branchId, serviceId),
      ),
    },
    agendaSlot: { findMany: agendaSlotFindMany },
  });
  const to = new Date(Date.now() - 60 * 60 * 1000);
  const range = {
    from: new Date(to.getTime() - 60 * 60 * 1000),
    to,
  };

  assert.deepEqual(
    await service.findAvailableSlots(branchId, serviceId, range),
    { data: [] },
  );
  assert.equal(agendaSlotFindMany.mock.callCount(), 0);
});

test('professional availability rejects unavailable or incompatible professionals', async () => {
  const branchId = randomUUID();
  const serviceId = randomUUID();
  const professionalId = randomUUID();
  const context = { branchId, serviceId };
  const range = futureRange();
  const invalidProfessionals = [
    null,
    professionalRecord(context, { id: professionalId, status: 'INACTIVE' }),
    professionalRecord(context, {
      id: professionalId,
      deletedAt: new Date(),
    }),
    professionalRecord(context, {
      id: professionalId,
      institutionId: institutionB,
      institution: institutionRecord(institutionB),
    }),
    professionalRecord(context, {
      id: professionalId,
      institution: institutionRecord(institutionA, {
        status: 'SUSPENDED',
      }),
    }),
    professionalRecord(context, {
      id: professionalId,
      branchAssignments: [{ branchId, active: false }],
    }),
    professionalRecord(context, {
      id: professionalId,
      branchAssignments: [{ branchId: randomUUID(), active: true }],
    }),
    professionalRecord(context, {
      id: professionalId,
      serviceAssignments: [{ serviceId, active: false }],
    }),
    professionalRecord(context, {
      id: professionalId,
      serviceAssignments: [{ serviceId: randomUUID(), active: true }],
    }),
  ];

  for (const professional of invalidProfessionals) {
    const agendaSlotFindMany = mock.fn();
    const service = new AgendaAvailabilityService({
      serviceBranch: {
        findFirst: mock.fn(async () =>
          serviceBranchRecord(branchId, serviceId),
        ),
      },
      professional: { findFirst: mock.fn(async () => professional) },
      agendaSlot: { findMany: agendaSlotFindMany },
    });

    await assert.rejects(
      service.findAvailableSlotsByProfessional(
        branchId,
        serviceId,
        professionalId,
        range,
      ),
      hasStatus(404),
    );
    assert.equal(agendaSlotFindMany.mock.callCount(), 0);
  }
});

test('professional availability scopes the query and response to the requested professional', async () => {
  const branchId = randomUUID();
  const serviceId = randomUUID();
  const professionalId = randomUUID();
  const context = { branchId, serviceId };
  const range = futureRange();
  const requestedProfessional = professionalRecord(context, {
    id: professionalId,
  });
  const requestedSlot = slotRecord(
    context,
    new Date(range.from.getTime() + 60 * 60 * 1000),
    {
      availability: {
        professionalId,
        professional: requestedProfessional,
      },
    },
  );
  const otherSlot = slotRecord(
    context,
    new Date(range.from.getTime() + 2 * 60 * 60 * 1000),
  );
  const professionalFindFirst = mock.fn(async () => requestedProfessional);
  const agendaSlotFindMany = mock.fn(async () => [requestedSlot, otherSlot]);
  const service = new AgendaAvailabilityService({
    serviceBranch: {
      findFirst: mock.fn(async () =>
        serviceBranchRecord(branchId, serviceId),
      ),
    },
    professional: { findFirst: professionalFindFirst },
    agendaSlot: { findMany: agendaSlotFindMany },
  });

  const result = await service.findAvailableSlotsByProfessional(
    branchId,
    serviceId,
    professionalId,
    range,
  );

  assert.deepEqual(result.data.map(({ id }) => id), [requestedSlot.id]);
  const professionalQuery =
    professionalFindFirst.mock.calls[0].arguments[0];
  assert.equal(professionalQuery.where.id, professionalId);
  assert.equal(professionalQuery.where.institutionId, institutionA);
  assert.deepEqual(professionalQuery.where.branchAssignments, {
    some: { branchId, active: true },
  });
  assert.deepEqual(professionalQuery.where.serviceAssignments, {
    some: { serviceId, active: true },
  });
  const slotQuery = agendaSlotFindMany.mock.calls[0].arguments[0];
  assert.equal(slotQuery.where.availability.professionalId, professionalId);
  assert.equal(
    slotQuery.where.availability.professional.id,
    professionalId,
  );
});
