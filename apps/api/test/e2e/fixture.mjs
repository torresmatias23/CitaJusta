import { randomUUID } from 'node:crypto';
import * as argon2 from 'argon2';

export const FIXTURE_PREFIX = 'E2E_CHECKPOINT';
export const FIXTURE_EMAIL_PREFIX = 'e2e_checkpoint+';

export const ids = Object.freeze({
  institutionA: 'e2e00000-0000-4000-8000-000000000001',
  institutionB: 'e2e00000-0000-4000-8000-000000000002',
  institutionInactive: 'e2e00000-0000-4000-8000-000000000003',
  branchA1: 'e2e00000-0000-4000-8000-000000000011',
  branchA2: 'e2e00000-0000-4000-8000-000000000012',
  branchB1: 'e2e00000-0000-4000-8000-000000000013',
  branchInactive: 'e2e00000-0000-4000-8000-000000000014',
  categoryActive: 'e2e00000-0000-4000-8000-000000000021',
  categoryInactive: 'e2e00000-0000-4000-8000-000000000022',
  serviceA: 'e2e00000-0000-4000-8000-000000000031',
  serviceA2: 'e2e00000-0000-4000-8000-000000000032',
  serviceB: 'e2e00000-0000-4000-8000-000000000033',
  serviceInactive: 'e2e00000-0000-4000-8000-000000000034',
  requirementActive: 'e2e00000-0000-4000-8000-000000000041',
  requirementInactive: 'e2e00000-0000-4000-8000-000000000042',
  professionalA2User: 'e2e00000-0000-4000-8000-000000000051',
  professionalA3User: 'e2e00000-0000-4000-8000-000000000052',
  professionalBUser: 'e2e00000-0000-4000-8000-000000000053',
  professionalInactiveUser: 'e2e00000-0000-4000-8000-000000000054',
  professionalA: 'e2e00000-0000-4000-8000-000000000061',
  professionalA2: 'e2e00000-0000-4000-8000-000000000062',
  professionalA3: 'e2e00000-0000-4000-8000-000000000063',
  professionalB: 'e2e00000-0000-4000-8000-000000000064',
  professionalInactive: 'e2e00000-0000-4000-8000-000000000065',
  attentionPointActive: 'e2e00000-0000-4000-8000-000000000071',
  attentionPointInactive: 'e2e00000-0000-4000-8000-000000000072',
  availabilityMain: 'e2e00000-0000-4000-8000-000000000081',
  availabilityPast: 'e2e00000-0000-4000-8000-000000000082',
  availabilityOtherContext: 'e2e00000-0000-4000-8000-000000000083',
  availabilityCrossTenant: 'e2e00000-0000-4000-8000-000000000084',
  availabilityInactivePoint: 'e2e00000-0000-4000-8000-000000000085',
  slotAvailable: 'e2e00000-0000-4000-8000-000000000091',
  slotReserved: 'e2e00000-0000-4000-8000-000000000092',
  slotBlocked: 'e2e00000-0000-4000-8000-000000000093',
  slotBlockedUntil: 'e2e00000-0000-4000-8000-000000000094',
  slotPast: 'e2e00000-0000-4000-8000-000000000095',
  slotOtherContext: 'e2e00000-0000-4000-8000-000000000096',
  slotCrossTenant: 'e2e00000-0000-4000-8000-000000000097',
  slotInactivePoint: 'e2e00000-0000-4000-8000-000000000098',
  permissionGlobal: 'e2e00000-0000-4000-8000-0000000000a1',
  permissionInstitution: 'e2e00000-0000-4000-8000-0000000000a2',
  permissionBranch: 'e2e00000-0000-4000-8000-0000000000a3',
  roleGlobal: 'e2e00000-0000-4000-8000-0000000000b1',
  roleInstitution: 'e2e00000-0000-4000-8000-0000000000b2',
  roleBranch: 'e2e00000-0000-4000-8000-0000000000b3',
  userRoleGlobal: 'e2e00000-0000-4000-8000-0000000000c1',
  userRoleInstitution: 'e2e00000-0000-4000-8000-0000000000c2',
  userRoleBranch: 'e2e00000-0000-4000-8000-0000000000c3',
  missing: 'e2e00000-0000-4000-8000-00000000ffff',
});

export const rbac = Object.freeze({
  roles: {
    global: 'E2E_CHECKPOINT_GLOBAL',
    institution: 'E2E_CHECKPOINT_INSTITUTION',
    branch: 'E2E_CHECKPOINT_BRANCH',
  },
  permissions: {
    global: 'e2e.checkpoint.global',
    institution: 'e2e.checkpoint.institution',
    branch: 'e2e.checkpoint.branch',
  },
});

const institutionIds = [
  ids.institutionA,
  ids.institutionB,
  ids.institutionInactive,
];
const branchIds = [
  ids.branchA1,
  ids.branchA2,
  ids.branchB1,
  ids.branchInactive,
];
const categoryIds = [ids.categoryActive, ids.categoryInactive];
const serviceIds = [
  ids.serviceA,
  ids.serviceA2,
  ids.serviceB,
  ids.serviceInactive,
];
const requirementIds = [ids.requirementActive, ids.requirementInactive];
const auxiliaryUserIds = [
  ids.professionalA2User,
  ids.professionalA3User,
  ids.professionalBUser,
  ids.professionalInactiveUser,
];
export const professionalIds = [
  ids.professionalA,
  ids.professionalA2,
  ids.professionalA3,
  ids.professionalB,
  ids.professionalInactive,
];
const attentionPointIds = [
  ids.attentionPointActive,
  ids.attentionPointInactive,
];
const availabilityIds = [
  ids.availabilityMain,
  ids.availabilityPast,
  ids.availabilityOtherContext,
  ids.availabilityCrossTenant,
  ids.availabilityInactivePoint,
];
export const slotIds = [
  ids.slotAvailable,
  ids.slotReserved,
  ids.slotBlocked,
  ids.slotBlockedUntil,
  ids.slotPast,
  ids.slotOtherContext,
  ids.slotCrossTenant,
  ids.slotInactivePoint,
];
const permissionIds = [
  ids.permissionGlobal,
  ids.permissionInstitution,
  ids.permissionBranch,
];
const roleIds = [ids.roleGlobal, ids.roleInstitution, ids.roleBranch];
const userRoleIds = [
  ids.userRoleGlobal,
  ids.userRoleInstitution,
  ids.userRoleBranch,
];

function isFixtureMarker(value) {
  return typeof value === 'string' && value.startsWith(FIXTURE_PREFIX);
}

function isFixtureEmail(value) {
  return typeof value === 'string' && value.startsWith(FIXTURE_EMAIL_PREFIX);
}

async function assertFixtureOwnership(prisma) {
  let ownershipRows;

  try {
    ownershipRows = await Promise.all([
      prisma.institution.findMany({
        where: { id: { in: institutionIds } },
        select: { name: true },
      }),
      prisma.branch.findMany({
        where: { id: { in: branchIds } },
        select: { code: true },
      }),
      prisma.serviceCategory.findMany({
        where: { id: { in: categoryIds } },
        select: { name: true },
      }),
      prisma.service.findMany({
        where: { id: { in: serviceIds } },
        select: { code: true },
      }),
      prisma.serviceRequirement.findMany({
        where: { id: { in: requirementIds } },
        select: { name: true },
      }),
      prisma.user.findMany({
        where: { id: { in: auxiliaryUserIds } },
        select: { email: true },
      }),
      prisma.professional.findMany({
        where: { id: { in: professionalIds } },
        select: { internalCode: true },
      }),
      prisma.attentionPoint.findMany({
        where: { id: { in: attentionPointIds } },
        select: { code: true },
      }),
      prisma.role.findMany({
        where: { id: { in: roleIds } },
        select: { code: true },
      }),
      prisma.permission.findMany({
        where: { id: { in: permissionIds } },
        select: { code: true },
      }),
      prisma.availability.findMany({
        where: { id: { in: availabilityIds } },
        select: { id: true, professionalId: true },
      }),
      prisma.agendaSlot.findMany({
        where: { id: { in: slotIds } },
        select: { id: true, availabilityId: true },
      }),
    ]);
  } catch (error) {
    const prismaCode = error?.code ?? 'unknown';
    const databaseCode =
      error?.meta?.driverAdapterError?.cause?.originalCode ?? 'unknown';

    throw new Error(
      `E2E fixture preflight query failed (Prisma ${prismaCode}, PostgreSQL ${databaseCode})`,
    );
  }

  const [
    institutions,
    branches,
    categories,
    services,
    requirements,
    users,
    professionals,
    attentionPoints,
    roles,
    permissions,
    availabilities,
    slots,
  ] = ownershipRows;

  const markerRows = [
    ...institutions.map((row) => row.name),
    ...branches.map((row) => row.code),
    ...categories.map((row) => row.name),
    ...services.map((row) => row.code),
    ...requirements.map((row) => row.name),
    ...professionals.map((row) => row.internalCode),
    ...attentionPoints.map((row) => row.code),
    ...roles.map((row) => row.code),
  ];
  const hasForeignMarker = markerRows.some((value) => !isFixtureMarker(value));
  const hasForeignUser = users.some((row) => !isFixtureEmail(row.email));
  const hasForeignPermission = permissions.some(
    (row) => !row.code.startsWith('e2e.checkpoint.'),
  );
  const expectedAvailabilityOwners = new Map([
    [ids.availabilityMain, ids.professionalA],
    [ids.availabilityPast, ids.professionalA],
    [ids.availabilityOtherContext, ids.professionalA2],
    [ids.availabilityCrossTenant, ids.professionalB],
    [ids.availabilityInactivePoint, ids.professionalA],
  ]);
  const hasForeignAvailability = availabilities.some(
    (row) => expectedAvailabilityOwners.get(row.id) !== row.professionalId,
  );
  const expectedSlotOwners = new Map([
    [ids.slotAvailable, ids.availabilityMain],
    [ids.slotReserved, ids.availabilityMain],
    [ids.slotBlocked, ids.availabilityMain],
    [ids.slotBlockedUntil, ids.availabilityMain],
    [ids.slotPast, ids.availabilityPast],
    [ids.slotOtherContext, ids.availabilityOtherContext],
    [ids.slotCrossTenant, ids.availabilityCrossTenant],
    [ids.slotInactivePoint, ids.availabilityInactivePoint],
  ]);
  const hasForeignSlot = slots.some(
    (row) => expectedSlotOwners.get(row.id) !== row.availabilityId,
  );

  if (
    hasForeignMarker ||
    hasForeignUser ||
    hasForeignPermission ||
    hasForeignAvailability ||
    hasForeignSlot
  ) {
    throw new Error(
      'E2E safety check failed: a deterministic fixture id belongs to non-checkpoint data',
    );
  }
}

async function findFixtureUserIds(prisma) {
  const users = await prisma.user.findMany({
    where: {
      OR: [
        { id: { in: auxiliaryUserIds } },
        { email: { startsWith: FIXTURE_EMAIL_PREFIX } },
      ],
    },
    select: { id: true },
  });

  return users.map((user) => user.id);
}

export async function cleanupCheckpointFixtures(prisma) {
  await assertFixtureOwnership(prisma);

  const fixtureUserIds = await findFixtureUserIds(prisma);
  const relatedProfessionals = await prisma.professional.findMany({
    where: {
      OR: [
        { id: { in: professionalIds } },
        ...(fixtureUserIds.length > 0
          ? [{ userId: { in: fixtureUserIds } }]
          : []),
      ],
    },
    select: { id: true },
  });
  const relatedProfessionalIds = relatedProfessionals.map(({ id }) => id);
  const relatedAvailabilities = await prisma.availability.findMany({
    where: {
      OR: [
        { id: { in: availabilityIds } },
        ...(relatedProfessionalIds.length > 0
          ? [{ professionalId: { in: relatedProfessionalIds } }]
          : []),
      ],
    },
    select: { id: true },
  });
  const relatedAvailabilityIds = relatedAvailabilities.map(({ id }) => id);

  await prisma.$transaction([
    prisma.authSession.deleteMany({
      where: { userId: { in: fixtureUserIds } },
    }),
    prisma.userRole.deleteMany({
      where: {
        OR: [
          { id: { in: userRoleIds } },
          { roleId: { in: roleIds } },
          ...(fixtureUserIds.length > 0
            ? [{ userId: { in: fixtureUserIds } }]
            : []),
        ],
      },
    }),
    prisma.rolePermission.deleteMany({
      where: {
        OR: [
          { roleId: { in: roleIds } },
          { permissionId: { in: permissionIds } },
        ],
      },
    }),
    prisma.agendaSlot.deleteMany({
      where: {
        OR: [
          { id: { in: slotIds } },
          { availabilityId: { in: relatedAvailabilityIds } },
        ],
      },
    }),
    prisma.availability.deleteMany({
      where: { id: { in: relatedAvailabilityIds } },
    }),
    prisma.professionalService.deleteMany({
      where: { professionalId: { in: relatedProfessionalIds } },
    }),
    prisma.professionalBranch.deleteMany({
      where: { professionalId: { in: relatedProfessionalIds } },
    }),
    prisma.professional.deleteMany({
      where: { id: { in: relatedProfessionalIds } },
    }),
    prisma.attentionPoint.deleteMany({
      where: { id: { in: attentionPointIds } },
    }),
    prisma.serviceRequirement.deleteMany({
      where: { id: { in: requirementIds } },
    }),
    prisma.serviceBranch.deleteMany({
      where: { serviceId: { in: serviceIds } },
    }),
    prisma.service.deleteMany({ where: { id: { in: serviceIds } } }),
    prisma.serviceCategory.deleteMany({
      where: { id: { in: categoryIds } },
    }),
    prisma.branch.deleteMany({ where: { id: { in: branchIds } } }),
    prisma.institution.deleteMany({
      where: { id: { in: institutionIds } },
    }),
    prisma.role.deleteMany({ where: { id: { in: roleIds } } }),
    prisma.permission.deleteMany({
      where: { id: { in: permissionIds } },
    }),
    prisma.user.deleteMany({ where: { id: { in: fixtureUserIds } } }),
  ]);
}

function utcDay(offsetDays) {
  const value = new Date();
  value.setUTCDate(value.getUTCDate() + offsetDays);
  value.setUTCHours(0, 0, 0, 0);
  return value;
}

function utcDateTime(day, hour, minute = 0) {
  const value = new Date(day);
  value.setUTCHours(hour, minute, 0, 0);
  return value;
}

function databaseTime(hour, minute = 0) {
  return new Date(Date.UTC(1970, 0, 1, hour, minute, 0, 0));
}

export async function createCheckpointFixtures(prisma, registeredUserId) {
  const auxiliaryPasswordHash = await argon2.hash(randomUUID(), {
    type: argon2.argon2id,
    memoryCost: 19_456,
    timeCost: 2,
    parallelism: 1,
  });
  const futureDay = utcDay(2);
  const pastDay = utcDay(-1);
  const starts = {
    available: utcDateTime(futureDay, 12),
    reserved: utcDateTime(futureDay, 13),
    blocked: utcDateTime(futureDay, 14),
    blockedUntil: utcDateTime(futureDay, 15),
    otherContext: utcDateTime(futureDay, 12, 15),
    crossTenant: utcDateTime(futureDay, 12, 30),
    inactivePoint: utcDateTime(futureDay, 18),
    past: utcDateTime(pastDay, 12),
  };
  const ends = Object.fromEntries(
    Object.entries(starts).map(([key, value]) => [
      key,
      new Date(value.getTime() + 30 * 60_000),
    ]),
  );

  await prisma.$transaction([
    prisma.permission.createMany({
      data: [
        {
          id: ids.permissionGlobal,
          code: rbac.permissions.global,
          module: 'e2e_checkpoint',
          action: 'global',
        },
        {
          id: ids.permissionInstitution,
          code: rbac.permissions.institution,
          module: 'e2e_checkpoint',
          action: 'institution',
        },
        {
          id: ids.permissionBranch,
          code: rbac.permissions.branch,
          module: 'e2e_checkpoint',
          action: 'branch',
        },
      ],
    }),
    prisma.role.createMany({
      data: [
        {
          id: ids.roleGlobal,
          code: rbac.roles.global,
          name: `${FIXTURE_PREFIX} Global`,
          scope: 'GLOBAL',
        },
        {
          id: ids.roleInstitution,
          code: rbac.roles.institution,
          name: `${FIXTURE_PREFIX} Institution`,
          scope: 'INSTITUTION',
        },
        {
          id: ids.roleBranch,
          code: rbac.roles.branch,
          name: `${FIXTURE_PREFIX} Branch`,
          scope: 'BRANCH',
        },
      ],
    }),
    prisma.institution.createMany({
      data: [
        {
          id: ids.institutionA,
          name: `${FIXTURE_PREFIX} Institution A`,
          status: 'ACTIVE',
        },
        {
          id: ids.institutionB,
          name: `${FIXTURE_PREFIX} Institution B`,
          status: 'ACTIVE',
        },
        {
          id: ids.institutionInactive,
          name: `${FIXTURE_PREFIX} Institution C`,
          status: 'INACTIVE',
        },
      ],
    }),
    prisma.branch.createMany({
      data: [
        {
          id: ids.branchA1,
          institutionId: ids.institutionA,
          code: `${FIXTURE_PREFIX}_A1`,
          name: `${FIXTURE_PREFIX} Branch A1`,
          status: 'ACTIVE',
        },
        {
          id: ids.branchA2,
          institutionId: ids.institutionA,
          code: `${FIXTURE_PREFIX}_A2`,
          name: `${FIXTURE_PREFIX} Branch A2`,
          status: 'ACTIVE',
        },
        {
          id: ids.branchB1,
          institutionId: ids.institutionB,
          code: `${FIXTURE_PREFIX}_B1`,
          name: `${FIXTURE_PREFIX} Branch B1`,
          status: 'ACTIVE',
        },
        {
          id: ids.branchInactive,
          institutionId: ids.institutionA,
          code: `${FIXTURE_PREFIX}_INACTIVE`,
          name: `${FIXTURE_PREFIX} Branch inactive`,
          status: 'INACTIVE',
        },
      ],
    }),
    prisma.serviceCategory.createMany({
      data: [
        {
          id: ids.categoryActive,
          institutionId: ids.institutionA,
          name: `${FIXTURE_PREFIX} Category active`,
          active: true,
        },
        {
          id: ids.categoryInactive,
          institutionId: ids.institutionA,
          name: `${FIXTURE_PREFIX} Category inactive`,
          active: false,
        },
      ],
    }),
    prisma.service.createMany({
      data: [
        {
          id: ids.serviceA,
          institutionId: ids.institutionA,
          categoryId: ids.categoryActive,
          code: `${FIXTURE_PREFIX}_SERVICE_A`,
          name: `${FIXTURE_PREFIX} Service A`,
          durationMinutes: 30,
          active: true,
        },
        {
          id: ids.serviceA2,
          institutionId: ids.institutionA,
          categoryId: ids.categoryInactive,
          code: `${FIXTURE_PREFIX}_SERVICE_A2`,
          name: `${FIXTURE_PREFIX} Service A2`,
          durationMinutes: 30,
          active: true,
        },
        {
          id: ids.serviceB,
          institutionId: ids.institutionB,
          code: `${FIXTURE_PREFIX}_SERVICE_B`,
          name: `${FIXTURE_PREFIX} Service B`,
          durationMinutes: 45,
          active: true,
        },
        {
          id: ids.serviceInactive,
          institutionId: ids.institutionA,
          categoryId: ids.categoryActive,
          code: `${FIXTURE_PREFIX}_SERVICE_INACTIVE`,
          name: `${FIXTURE_PREFIX} Service inactive`,
          durationMinutes: 30,
          active: false,
        },
      ],
    }),
    prisma.serviceBranch.createMany({
      data: [
        { serviceId: ids.serviceA, branchId: ids.branchA1, active: true },
        { serviceId: ids.serviceA2, branchId: ids.branchA1, active: false },
        { serviceId: ids.serviceA2, branchId: ids.branchA2, active: true },
        { serviceId: ids.serviceB, branchId: ids.branchB1, active: true },
        {
          serviceId: ids.serviceInactive,
          branchId: ids.branchA1,
          active: true,
        },
      ],
    }),
    prisma.serviceRequirement.createMany({
      data: [
        {
          id: ids.requirementActive,
          serviceId: ids.serviceA,
          name: `${FIXTURE_PREFIX} Active requirement`,
          required: true,
          order: 1,
          active: true,
        },
        {
          id: ids.requirementInactive,
          serviceId: ids.serviceA,
          name: `${FIXTURE_PREFIX} Inactive requirement`,
          order: 2,
          active: false,
        },
      ],
    }),
    prisma.user.createMany({
      data: [
        {
          id: ids.professionalA2User,
          email: `${FIXTURE_EMAIL_PREFIX}professional-a2@example.com`,
          passwordHash: auxiliaryPasswordHash,
          firstNames: 'Checkpoint Ana',
          lastNames: 'Professional A2',
          status: 'ACTIVE',
        },
        {
          id: ids.professionalA3User,
          email: `${FIXTURE_EMAIL_PREFIX}professional-a3@example.com`,
          passwordHash: auxiliaryPasswordHash,
          firstNames: 'Checkpoint Alicia',
          lastNames: 'Professional A3',
          status: 'ACTIVE',
        },
        {
          id: ids.professionalBUser,
          email: `${FIXTURE_EMAIL_PREFIX}professional-b@example.com`,
          passwordHash: auxiliaryPasswordHash,
          firstNames: 'Checkpoint Bruno',
          lastNames: 'Professional B',
          status: 'ACTIVE',
        },
        {
          id: ids.professionalInactiveUser,
          email: `${FIXTURE_EMAIL_PREFIX}professional-inactive@example.com`,
          passwordHash: auxiliaryPasswordHash,
          firstNames: 'Checkpoint Inactive',
          lastNames: 'Professional inactive',
          status: 'ACTIVE',
        },
      ],
    }),
    prisma.rolePermission.createMany({
      data: [
        { roleId: ids.roleGlobal, permissionId: ids.permissionGlobal },
        {
          roleId: ids.roleInstitution,
          permissionId: ids.permissionInstitution,
        },
        { roleId: ids.roleBranch, permissionId: ids.permissionBranch },
      ],
    }),
    prisma.userRole.createMany({
      data: [
        {
          id: ids.userRoleGlobal,
          userId: registeredUserId,
          roleId: ids.roleGlobal,
        },
        {
          id: ids.userRoleInstitution,
          userId: registeredUserId,
          roleId: ids.roleInstitution,
          institutionId: ids.institutionA,
        },
        {
          id: ids.userRoleBranch,
          userId: registeredUserId,
          roleId: ids.roleBranch,
          branchId: ids.branchA1,
        },
      ],
    }),
    prisma.professional.createMany({
      data: [
        {
          id: ids.professionalA,
          institutionId: ids.institutionA,
          userId: registeredUserId,
          internalCode: `${FIXTURE_PREFIX}_PROFESSIONAL_A`,
          titleOrFunction: 'E2E professional',
          status: 'ACTIVE',
        },
        {
          id: ids.professionalA2,
          institutionId: ids.institutionA,
          userId: ids.professionalA2User,
          internalCode: `${FIXTURE_PREFIX}_PROFESSIONAL_A2`,
          status: 'ACTIVE',
        },
        {
          id: ids.professionalA3,
          institutionId: ids.institutionA,
          userId: ids.professionalA3User,
          internalCode: `${FIXTURE_PREFIX}_PROFESSIONAL_A3`,
          status: 'ACTIVE',
        },
        {
          id: ids.professionalB,
          institutionId: ids.institutionB,
          userId: ids.professionalBUser,
          internalCode: `${FIXTURE_PREFIX}_PROFESSIONAL_B`,
          status: 'ACTIVE',
        },
        {
          id: ids.professionalInactive,
          institutionId: ids.institutionA,
          userId: ids.professionalInactiveUser,
          internalCode: `${FIXTURE_PREFIX}_PROFESSIONAL_INACTIVE`,
          status: 'INACTIVE',
        },
      ],
    }),
    prisma.professionalBranch.createMany({
      data: [
        { professionalId: ids.professionalA, branchId: ids.branchA1 },
        {
          professionalId: ids.professionalA,
          branchId: ids.branchA2,
          active: false,
        },
        {
          professionalId: ids.professionalA2,
          branchId: ids.branchA1,
          active: false,
        },
        { professionalId: ids.professionalA2, branchId: ids.branchA2 },
        { professionalId: ids.professionalA3, branchId: ids.branchA1 },
        { professionalId: ids.professionalB, branchId: ids.branchB1 },
        {
          professionalId: ids.professionalInactive,
          branchId: ids.branchA1,
        },
      ],
    }),
    prisma.professionalService.createMany({
      data: [
        { professionalId: ids.professionalA, serviceId: ids.serviceA },
        {
          professionalId: ids.professionalA,
          serviceId: ids.serviceA2,
          active: false,
        },
        { professionalId: ids.professionalA2, serviceId: ids.serviceA },
        { professionalId: ids.professionalA2, serviceId: ids.serviceA2 },
        { professionalId: ids.professionalA3, serviceId: ids.serviceA2 },
        { professionalId: ids.professionalB, serviceId: ids.serviceB },
        {
          professionalId: ids.professionalInactive,
          serviceId: ids.serviceA,
        },
      ],
    }),
    prisma.attentionPoint.createMany({
      data: [
        {
          id: ids.attentionPointActive,
          branchId: ids.branchA1,
          code: `${FIXTURE_PREFIX}_POINT_ACTIVE`,
          name: `${FIXTURE_PREFIX} Point active`,
          active: true,
        },
        {
          id: ids.attentionPointInactive,
          branchId: ids.branchA1,
          code: `${FIXTURE_PREFIX}_POINT_INACTIVE`,
          name: `${FIXTURE_PREFIX} Point inactive`,
          active: false,
        },
      ],
    }),
    prisma.availability.createMany({
      data: [
        {
          id: ids.availabilityMain,
          professionalId: ids.professionalA,
          serviceId: ids.serviceA,
          branchId: ids.branchA1,
          attentionPointId: ids.attentionPointActive,
          date: futureDay,
          startTime: databaseTime(11),
          endTime: databaseTime(16),
        },
        {
          id: ids.availabilityPast,
          professionalId: ids.professionalA,
          serviceId: ids.serviceA,
          branchId: ids.branchA1,
          attentionPointId: ids.attentionPointActive,
          date: pastDay,
          startTime: databaseTime(11),
          endTime: databaseTime(13),
        },
        {
          id: ids.availabilityOtherContext,
          professionalId: ids.professionalA2,
          serviceId: ids.serviceA2,
          branchId: ids.branchA2,
          date: futureDay,
          startTime: databaseTime(11),
          endTime: databaseTime(13),
        },
        {
          id: ids.availabilityCrossTenant,
          professionalId: ids.professionalB,
          serviceId: ids.serviceB,
          branchId: ids.branchB1,
          date: futureDay,
          startTime: databaseTime(11),
          endTime: databaseTime(13),
        },
        {
          id: ids.availabilityInactivePoint,
          professionalId: ids.professionalA,
          serviceId: ids.serviceA,
          branchId: ids.branchA1,
          attentionPointId: ids.attentionPointInactive,
          date: futureDay,
          startTime: databaseTime(17),
          endTime: databaseTime(19),
        },
      ],
    }),
    prisma.agendaSlot.createMany({
      data: [
        {
          id: ids.slotAvailable,
          availabilityId: ids.availabilityMain,
          startsAt: starts.available,
          endsAt: ends.available,
          status: 'AVAILABLE',
        },
        {
          id: ids.slotReserved,
          availabilityId: ids.availabilityMain,
          startsAt: starts.reserved,
          endsAt: ends.reserved,
          status: 'RESERVED',
        },
        {
          id: ids.slotBlocked,
          availabilityId: ids.availabilityMain,
          startsAt: starts.blocked,
          endsAt: ends.blocked,
          status: 'BLOCKED',
        },
        {
          id: ids.slotBlockedUntil,
          availabilityId: ids.availabilityMain,
          startsAt: starts.blockedUntil,
          endsAt: ends.blockedUntil,
          status: 'AVAILABLE',
          blockedUntilAt: utcDateTime(futureDay, 21),
        },
        {
          id: ids.slotPast,
          availabilityId: ids.availabilityPast,
          startsAt: starts.past,
          endsAt: ends.past,
          status: 'AVAILABLE',
        },
        {
          id: ids.slotOtherContext,
          availabilityId: ids.availabilityOtherContext,
          startsAt: starts.otherContext,
          endsAt: ends.otherContext,
          status: 'AVAILABLE',
        },
        {
          id: ids.slotCrossTenant,
          availabilityId: ids.availabilityCrossTenant,
          startsAt: starts.crossTenant,
          endsAt: ends.crossTenant,
          status: 'AVAILABLE',
        },
        {
          id: ids.slotInactivePoint,
          availabilityId: ids.availabilityInactivePoint,
          startsAt: starts.inactivePoint,
          endsAt: ends.inactivePoint,
          status: 'AVAILABLE',
        },
      ],
    }),
  ]);

  return {
    from: utcDateTime(futureDay, 10).toISOString(),
    to: utcDateTime(futureDay, 20).toISOString(),
  };
}

export async function assertCheckpointIsClean(prisma) {
  const counts = await Promise.all([
    prisma.user.count({
      where: {
        OR: [
          { id: { in: auxiliaryUserIds } },
          { email: { startsWith: FIXTURE_EMAIL_PREFIX } },
        ],
      },
    }),
    prisma.institution.count({ where: { id: { in: institutionIds } } }),
    prisma.branch.count({ where: { id: { in: branchIds } } }),
    prisma.serviceCategory.count({ where: { id: { in: categoryIds } } }),
    prisma.service.count({ where: { id: { in: serviceIds } } }),
    prisma.serviceRequirement.count({
      where: { id: { in: requirementIds } },
    }),
    prisma.professional.count({ where: { id: { in: professionalIds } } }),
    prisma.attentionPoint.count({
      where: { id: { in: attentionPointIds } },
    }),
    prisma.availability.count({ where: { id: { in: availabilityIds } } }),
    prisma.agendaSlot.count({ where: { id: { in: slotIds } } }),
    prisma.role.count({ where: { id: { in: roleIds } } }),
    prisma.permission.count({ where: { id: { in: permissionIds } } }),
  ]);

  if (counts.some((count) => count !== 0)) {
    throw new Error('E2E cleanup verification failed');
  }
}
