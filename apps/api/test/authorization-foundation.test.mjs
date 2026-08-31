import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mock, test } from 'node:test';
import { AuthorizationContextGuard } from '../dist/authorization/authorization-context.guard.js';
import { AuthorizationService } from '../dist/authorization/authorization.service.js';
import { PermissionsGuard } from '../dist/authorization/permissions.guard.js';

const userId = randomUUID();
const institutionA = randomUUID();
const institutionB = randomUUID();
const branchA = randomUUID();
const branchB = randomUUID();

function httpContext(request) {
  const handler = () => {};
  class TestController {}

  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => handler,
    getClass: () => TestController,
  };
}

function hasStatus(status) {
  return (error) =>
    typeof error?.getStatus === 'function' && error.getStatus() === status;
}

function assignment(overrides = {}) {
  const { role: roleOverrides = {}, ...assignmentOverrides } = overrides;

  return {
    active: true,
    validFrom: null,
    validTo: null,
    institutionId: null,
    branchId: null,
    ...assignmentOverrides,
    role: {
      code: 'global-reader',
      scope: 'GLOBAL',
      active: true,
      permissions: [{ permission: { code: 'global.read' } }],
      ...roleOverrides,
    },
  };
}

function createAuthorizationService(assignments = []) {
  const prisma = {
    userRole: {
      findMany: mock.fn(async () => assignments),
    },
    institution: {
      findUnique: mock.fn(async ({ where }) =>
        [institutionA, institutionB].includes(where.id)
          ? { id: where.id }
          : null,
      ),
    },
    branch: {
      findUnique: mock.fn(async ({ where }) => {
        if (where.id === branchA) {
          return { institutionId: institutionA };
        }

        if (where.id === branchB) {
          return { institutionId: institutionB };
        }

        return null;
      }),
    },
  };

  return { service: new AuthorizationService(prisma), prisma };
}

test('RBAC grants only active and currently valid assignments', async () => {
  const now = Date.now();
  const assignments = [
    assignment(),
    assignment({
      active: false,
      role: {
        code: 'inactive-assignment',
        permissions: [{ permission: { code: 'inactive.read' } }],
      },
    }),
    assignment({
      validFrom: new Date(now + 60_000),
      role: {
        code: 'future-assignment',
        permissions: [{ permission: { code: 'future.read' } }],
      },
    }),
    assignment({
      validTo: new Date(now - 60_000),
      role: {
        code: 'expired-assignment',
        permissions: [{ permission: { code: 'expired.read' } }],
      },
    }),
    assignment({
      role: {
        code: 'inactive-role',
        active: false,
        permissions: [{ permission: { code: 'role-inactive.read' } }],
      },
    }),
  ];
  const { service, prisma } = createAuthorizationService(assignments);
  const authorization = await service.resolveForUser(userId, {});

  assert.deepEqual(authorization.roleCodes, ['global-reader']);
  assert.deepEqual(authorization.permissions, ['global.read']);
  const query = prisma.userRole.findMany.mock.calls[0].arguments[0];
  assert.equal(query.where.active, true);
  assert.equal(query.where.role.active, true);
  assert.equal(query.where.AND.length, 2);
});

test('RBAC applies GLOBAL, INSTITUTION and BRANCH scopes only to matching contexts', async () => {
  const assignments = [
    assignment({
      role: {
        permissions: [
          { permission: { code: 'shared.read' } },
          { permission: { code: 'global.read' } },
        ],
      },
    }),
    assignment({
      institutionId: institutionA,
      role: {
        code: 'institution-manager',
        scope: 'INSTITUTION',
        permissions: [
          { permission: { code: 'institution.read' } },
          { permission: { code: 'shared.read' } },
        ],
      },
    }),
    assignment({
      institutionId: institutionA,
      branchId: branchA,
      role: {
        code: 'branch-operator',
        scope: 'BRANCH',
        permissions: [{ permission: { code: 'branch.read' } }],
      },
    }),
  ];
  const { service } = createAuthorizationService(assignments);

  const globalOnly = await service.resolveForUser(userId, {});
  assert.deepEqual(globalOnly.roleCodes, ['global-reader']);

  const institution = await service.resolveForUser(userId, {
    institutionId: institutionA,
  });
  assert.deepEqual(institution.roleCodes, [
    'global-reader',
    'institution-manager',
  ]);
  assert.deepEqual(institution.permissions, [
    'global.read',
    'institution.read',
    'shared.read',
  ]);

  const otherInstitution = await service.resolveForUser(userId, {
    institutionId: institutionB,
  });
  assert.deepEqual(otherInstitution.roleCodes, ['global-reader']);

  const branchOnly = await service.resolveForUser(userId, {
    branchId: branchA,
  });
  assert.deepEqual(branchOnly.roleCodes, ['branch-operator', 'global-reader']);

  const institutionAndBranch = await service.resolveForUser(userId, {
    institutionId: institutionA,
    branchId: branchA,
  });
  assert.deepEqual(institutionAndBranch.roleCodes, [
    'branch-operator',
    'global-reader',
    'institution-manager',
  ]);

  const otherBranch = await service.resolveForUser(userId, {
    branchId: branchB,
  });
  assert.deepEqual(otherBranch.roleCodes, ['global-reader']);
});

test('RBAC rejects an inconsistent institution and branch context', async () => {
  const { service } = createAuthorizationService();

  await assert.rejects(
    service.resolveForUser(userId, {
      institutionId: institutionA,
      branchId: branchB,
    }),
    hasStatus(400),
  );
});

test('institution context guard validates UUIDs and ignores client RBAC claims', async () => {
  const resolved = {
    userId,
    institutionId: institutionA,
    branchId: branchA,
    roleCodes: ['database-role'],
    permissions: ['database.read'],
  };
  const resolveForUser = mock.fn(async () => resolved);
  const guard = new AuthorizationContextGuard({ resolveForUser });
  const request = {
    headers: {
      'x-institution-id': institutionA,
      'x-branch-id': branchA,
      'x-role-code': 'client-admin',
      'x-permissions': 'everything',
      'x-scope': 'GLOBAL',
    },
    principal: { userId, sessionId: randomUUID() },
  };

  assert.equal(await guard.canActivate(httpContext(request)), true);
  assert.deepEqual(resolveForUser.mock.calls[0].arguments, [userId, {
    institutionId: institutionA,
    branchId: branchA,
  }]);
  assert.deepEqual(request.authorization, resolved);

  for (const invalidValue of ['not-a-uuid', [institutionA, institutionA]]) {
    await assert.rejects(
      guard.canActivate(
        httpContext({
          headers: { 'x-institution-id': invalidValue },
          principal: { userId, sessionId: randomUUID() },
        }),
      ),
      hasStatus(400),
    );
  }
});

test('institution context guard requires an authenticated principal', async () => {
  const guard = new AuthorizationContextGuard({
    resolveForUser: mock.fn(),
  });

  await assert.rejects(
    guard.canActivate(httpContext({ headers: {} })),
    hasStatus(401),
  );
});

test('permissions guard requires every declared permission', () => {
  const reflector = {
    getAllAndMerge: mock.fn(() => ['services.read', 'services.write']),
  };
  const guard = new PermissionsGuard(reflector);
  const principal = { userId, sessionId: randomUUID() };

  assert.equal(
    guard.canActivate(
      httpContext({
        headers: {},
        principal,
        authorization: {
          userId,
          roleCodes: [],
          permissions: ['services.read', 'services.write'],
        },
      }),
    ),
    true,
  );

  assert.throws(
    () =>
      guard.canActivate(
        httpContext({
          headers: {},
          principal,
          authorization: {
            userId,
            roleCodes: [],
            permissions: ['services.read'],
          },
        }),
      ),
    hasStatus(403),
  );

  assert.throws(
    () => guard.canActivate(httpContext({ headers: {} })),
    hasStatus(401),
  );
});
