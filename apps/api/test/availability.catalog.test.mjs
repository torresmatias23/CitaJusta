import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mock, test } from 'node:test';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { AvailabilityController } from '../dist/availability/availability.controller.js';
import { AgendaAvailabilityService } from '../dist/availability/availability.service.js';
import { AccessTokenGuard } from '../dist/auth/guards/access-token.guard.js';
import { parseAvailabilityRange } from '../dist/availability/schemas/availability-query.schemas.js';
import { availabilityQueryLimits } from '../dist/availability/availability-query.limits.js';

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
  assert.equal(query.take, 5001);
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
  assert.equal(slotQuery.take, 5001);
});

for (const days of [7, 14, 30, 31]) {
  test(`RNF-024 accepts a real ${days}-day interval in both public controllers`, () => {
    const from = new Date('2040-01-01T00:00:00.000Z');
    const to = new Date(from.getTime() + days * 86_400_000);
    const range = { from: from.toISOString(), to: to.toISOString() };
    const parsed = parseAvailabilityRange(range);
    assert.equal(parsed.to - parsed.from, days * 86_400_000);
    const general = mock.fn(), professional = mock.fn();
    const controller = new AvailabilityController({ findAvailableSlots: general, findAvailableSlotsByProfessional: professional });
    const params = { branchId: randomUUID(), serviceId: randomUUID(), professionalId: randomUUID() };
    controller.findAvailableSlots(params, range); controller.findAvailableSlotsByProfessional(params, range);
    assert.deepEqual(general.mock.calls[0].arguments[2], parsed);
    assert.deepEqual(professional.mock.calls[0].arguments[3], parsed);
  });
}

test('RNF-024 offsets use actual instants, including DST and the exact 31-day boundary', () => {
  for (const range of [
    { from: '2040-01-01T00:00:00-03:00', to: '2040-02-01T00:00:00-03:00' },
    { from: '2026-03-08T00:00:00-05:00', to: '2026-03-09T00:00:00-04:00' }, // 23-hour day
    { from: '2026-11-01T00:00:00-04:00', to: '2026-11-02T00:00:00-05:00' }, // 25-hour day
    { from: '2026-03-01T12:00:00-05:00', to: '2026-04-01T12:00:00-04:00' }, // 31 days minus one hour
    { from: '2026-10-02T12:00:00-04:00', to: '2026-11-01T12:00:00-05:00' }, // 30 days plus one hour
  ]) assert.doesNotThrow(() => parseAvailabilityRange(range));
  assert.throws(() => parseAvailabilityRange({
    from: '2026-10-02T12:00:00-04:00', to: '2026-11-02T12:00:00-05:00', // 31 days plus one hour
  }), hasStatus(400));
  // The labels look 31 days apart, but different offsets add 15 minutes.
  assert.throws(() => parseAvailabilityRange({ from: '2040-01-01T00:00:00+03:00', to: '2040-02-01T00:00:00+02:45' }), hasStatus(400));
});

test('RNF-024 rejects excess by one millisecond, invalid dates, offsets and inverted instants before delegation', () => {
  const general = mock.fn(), professional = mock.fn();
  const controller = new AvailabilityController({ findAvailableSlots: general, findAvailableSlotsByProfessional: professional });
  const params = { branchId: randomUUID(), serviceId: randomUUID(), professionalId: randomUUID() };
  const invalid = [
    { from: '2040-01-01T00:00:00.000Z', to: '2040-02-01T00:00:00.001Z' },
    { from: '2040-01-01T00:00:00Z', to: '2040-02-02T00:00:00Z' },
    { from: '2026-02-29T00:00:00Z', to: '2026-03-01T00:00:00Z' },
    { from: '2026-02-30T00:00:00Z', to: '2026-03-01T00:00:00Z' },
    { from: '2026-01-01T00:00:00+99:99', to: '2026-01-02T00:00:00Z' },
    { from: '2026-01-01T00:00:00', to: '2026-01-02T00:00:00Z' },
    { from: '2026-01-01T10:00:00-03:00', to: '2026-01-01T11:00:00+03:00' },
    { from: '2026-01-02T00:00:00Z', to: '2026-01-01T00:00:00Z' },
    { from: '2026-01-01T00:00:00Z', to: '2026-01-01T00:00:00Z' },
  ];
  for (const range of invalid) {
    assert.throws(() => controller.findAvailableSlots(params, range), hasStatus(400));
    assert.throws(() => controller.findAvailableSlotsByProfessional(params, range), hasStatus(400));
  }
  assert.equal(general.mock.callCount(), 0); assert.equal(professional.mock.callCount(), 0);
});

test('RNF-024 direct service calls validate the range before any context or slot database query', async () => {
  const called = mock.fn();
  const service = new AgendaAvailabilityService({ serviceBranch: { findFirst: called }, professional: { findFirst: called }, agendaSlot: { findMany: called } });
  for (const range of [
    { from: new Date(0), to: new Date(availabilityQueryLimits.maxRangeMs + 1) },
    { from: new Date('invalid'), to: new Date() },
    { from: new Date(), to: new Date(0) },
    { from: new Date(0), to: new Date(0) },
  ]) {
    await assert.rejects(service.findAvailableSlots(randomUUID(), randomUUID(), range), hasStatus(400));
    await assert.rejects(service.findAvailableSlotsByProfessional(randomUUID(), randomUUID(), randomUUID(), range), hasStatus(400));
  }
  assert.equal(called.mock.callCount(), 0);
});

function limitedAvailabilityFixture(count, configure = rows => rows) {
  const context = { branchId: randomUUID(), serviceId: randomUUID() }, range = futureRange();
  const professional = professionalRecord(context), base = slotRecord(context, range.from, { availability: { professionalId: professional.id, professional } });
  const rows = configure(Array.from({ length: count }, (_, index) => ({ ...base, id: randomUUID(), startsAt: new Date(range.from.getTime() + index) })));
  const before = structuredClone(rows);
  const findMany = mock.fn(async query => {
    assert.equal(query.take, 5001);
    assert.deepEqual(query.orderBy, [{ startsAt: 'asc' }, { id: 'asc' }]);
    assert.equal(query.where.availability.branch.institutionId, institutionA);
    assert.equal(query.where.availability.branchId, context.branchId);
    assert.equal(query.where.availability.serviceId, context.serviceId);
    assert.equal(query.where.availability.professional.institutionId, institutionA);
    return rows.slice(0, query.take);
  });
  // Deliberately expose only read operations. A write or transaction call would fail.
  const service = new AgendaAvailabilityService({
    serviceBranch: { findFirst: async () => serviceBranchRecord(context.branchId, context.serviceId) },
    professional: { findFirst: async () => professional }, agendaSlot: { findMany },
  });
  return { rows, before, findMany, run: byProfessional => byProfessional
    ? service.findAvailableSlotsByProfessional(context.branchId, context.serviceId, professional.id, range)
    : service.findAvailableSlots(context.branchId, context.serviceId, range) };
}

for (const byProfessional of [false, true]) {
  const kind = byProfessional ? 'professional' : 'general';
  test(`RNF-024 ${kind}: exactly 5000 candidates retain the complete controlled DTO without writes`, async () => {
    const f = limitedAvailabilityFixture(5000), result = await f.run(byProfessional);
    assert.equal(result.data.length, 5000); assert.deepEqual(result.data.map(r => r.id), f.rows.map(r => r.id));
    assert.deepEqual(Object.keys(result), ['data']); assert.deepEqual(Object.keys(result.data[0]), ['id', 'startsAt', 'endsAt', 'professional']);
    assert.equal(JSON.stringify(result).includes('lockVersion'), false); assert.deepEqual(f.rows, f.before);
    assert.equal(f.findMany.mock.callCount(), 1);
  });
  test(`RNF-024 ${kind}: 5001 candidates fail as 400 instead of returning a truncated success`, async () => {
    const f = limitedAvailabilityFixture(5002);
    await assert.rejects(f.run(byProfessional), error => error.getStatus() === 400 && !('data' in error.getResponse()));
    assert.equal(f.findMany.mock.callCount(), 1); assert.deepEqual(f.rows, f.before);
  });
  test(`RNF-024 ${kind}: post-filter discards do not hide a valid last candidate within the budget`, async () => {
    const f = limitedAvailabilityFixture(5000, rows => rows.map((row, i) => i === 4999 ? row : { ...row, endsAt: row.startsAt }));
    const result = await f.run(byProfessional);
    assert.deepEqual(result.data.map(r => r.id), [f.rows[4999].id]); assert.deepEqual(f.rows, f.before);
  });
  test(`RNF-024 ${kind}: post-filtering cannot turn a candidate overflow into misleading partial results`, async () => {
    const f = limitedAvailabilityFixture(5001, rows => rows.map((row, i) => i < 5000 ? { ...row, status: 'BLOCKED' } : row));
    await assert.rejects(f.run(byProfessional), hasStatus(400)); assert.deepEqual(f.rows, f.before);
  });
}
