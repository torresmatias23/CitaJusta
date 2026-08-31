import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mock, test } from 'node:test';
import { UsersController } from '../dist/users/users.controller.js';
import { UsersService } from '../dist/users/users.service.js';

const userId = randomUUID();

test('/users/me returns a controlled profile without sensitive fields', async () => {
  const findFirst = mock.fn(async () => ({
    id: userId,
    email: 'person@example.com',
    firstNames: 'Person',
    lastNames: 'Example',
    status: 'ACTIVE',
    passwordHash: 'must-not-leak',
    deletedAt: new Date(),
    authSessions: [{ refreshTokenHash: 'must-not-leak' }],
  }));
  const service = new UsersService({ user: { findFirst } });
  const principal = { userId, sessionId: randomUUID() };
  const authorization = {
    userId,
    roleCodes: ['global-reader'],
    permissions: ['profile.read'],
  };
  const result = await service.getMe(principal, authorization);

  assert.deepEqual(result, {
    data: {
      id: userId,
      email: 'person@example.com',
      firstName: 'Person',
      lastName: 'Example',
      status: 'ACTIVE',
      context: {},
      roles: ['global-reader'],
      permissions: ['profile.read'],
    },
  });
  assert.deepEqual(findFirst.mock.calls[0].arguments[0], {
    where: { id: userId, status: 'ACTIVE', deletedAt: null },
    select: {
      id: true,
      email: true,
      firstNames: true,
      lastNames: true,
      status: true,
    },
  });
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes('passwordHash'), false);
  assert.equal(serialized.includes('authSessions'), false);
  assert.equal(serialized.includes('refreshToken'), false);
});

test('/users/me controller delegates only the authenticated principal and resolved context', async () => {
  const expected = { data: { id: userId } };
  const getMe = mock.fn(async () => expected);
  const controller = new UsersController({ getMe });
  const principal = { userId, sessionId: randomUUID() };
  const authorization = {
    userId,
    institutionId: randomUUID(),
    roleCodes: [],
    permissions: [],
  };

  assert.deepEqual(
    await controller.getMe({
      headers: {
        'x-role-code': 'client-admin',
        'x-permissions': 'everything',
      },
      principal,
      authorization,
    }),
    expected,
  );
  assert.deepEqual(getMe.mock.calls[0].arguments, [
    principal,
    authorization,
  ]);
});
