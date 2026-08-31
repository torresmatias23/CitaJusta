import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mock, test } from 'node:test';
import * as argon2 from 'argon2';
import { AuthService } from '../dist/auth/auth.service.js';

const password = 'A-secure-test-password-123';
const accessSecret = 'test-access-secret-with-at-least-32-characters';
const refreshSecret = 'test-refresh-secret-with-at-least-32-characters';
const passwordHash = argon2.hash(password, {
  type: argon2.argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
});

function createConfigMock() {
  const values = {
    JWT_ACCESS_SECRET: accessSecret,
    JWT_REFRESH_SECRET: refreshSecret,
    JWT_ACCESS_TTL_SECONDS: 900,
    JWT_REFRESH_TTL_SECONDS: 2_592_000,
  };

  return {
    getOrThrow: mock.fn((key) => values[key]),
  };
}

function createJwtMock() {
  const tokens = new Map();
  let sequence = 0;

  const service = {
    signAsync: mock.fn(async (payload, options) => {
      const token = `signed-token-${++sequence}`;
      tokens.set(token, { payload: { ...payload }, options: { ...options } });
      return token;
    }),
    verifyAsync: mock.fn(async (token, options) => {
      const signed = tokens.get(token);

      if (
        !signed ||
        signed.options.secret !== options.secret ||
        !options.algorithms.includes(signed.options.algorithm)
      ) {
        throw new Error('invalid token');
      }

      return {
        ...signed.payload,
        iat: 1,
        exp: 2,
      };
    }),
  };

  return { service, tokens };
}

function createPrismaMock(initialUsers = []) {
  const users = new Map(initialUsers.map((user) => [user.id, { ...user }]));
  const sessions = new Map();

  const findUserByEmail = (email) =>
    [...users.values()].find((user) => user.email === email) ?? null;

  const prisma = {
    user: {
      findUnique: mock.fn(async ({ where }) => {
        if (where.email !== undefined) {
          return findUserByEmail(where.email);
        }

        return users.get(where.id) ?? null;
      }),
      create: mock.fn(async ({ data }) => {
        const user = {
          ...data,
          deletedAt: null,
          lastLoginAt: null,
        };
        users.set(user.id, user);
        return user;
      }),
      update: mock.fn(async ({ where, data }) => {
        const user = users.get(where.id);

        if (!user) {
          throw new Error('missing user');
        }

        Object.assign(user, data);
        return user;
      }),
    },
    authSession: {
      create: mock.fn(async ({ data }) => {
        const session = {
          ...data,
          revokedAt: null,
          lastUsedAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        sessions.set(session.id, session);
        return session;
      }),
      findUnique: mock.fn(async ({ where }) => {
        const session = sessions.get(where.id);

        if (!session) {
          return null;
        }

        return {
          ...session,
          user: users.get(session.userId),
        };
      }),
      updateMany: mock.fn(async ({ where, data }) => {
        const session = sessions.get(where.id);

        if (
          !session ||
          (where.userId !== undefined && session.userId !== where.userId) ||
          (where.refreshTokenHash !== undefined &&
            session.refreshTokenHash !== where.refreshTokenHash) ||
          (where.revokedAt === null && session.revokedAt !== null) ||
          (where.expiresAt?.gt !== undefined &&
            session.expiresAt <= where.expiresAt.gt)
        ) {
          return { count: 0 };
        }

        Object.assign(session, data, { updatedAt: new Date() });
        return { count: 1 };
      }),
    },
  };

  prisma.$transaction = mock.fn(async (operation) => operation(prisma));

  return { prisma, users, sessions };
}

async function activeUser(overrides = {}) {
  return {
    id: randomUUID(),
    email: 'active@example.com',
    passwordHash: await passwordHash,
    firstNames: 'Active',
    lastNames: 'User',
    status: 'ACTIVE',
    deletedAt: null,
    lastLoginAt: null,
    ...overrides,
  };
}

function createService(initialUsers = []) {
  const database = createPrismaMock(initialUsers);
  const jwt = createJwtMock();
  const service = new AuthService(
    database.prisma,
    jwt.service,
    createConfigMock(),
  );

  return { service, jwt, ...database };
}

test('register creates an active user with a normalized email and Argon2id hash', async () => {
  const { service, users } = createService();
  const result = await service.register({
    email: '  PERSON@Example.COM ',
    password,
    firstName: 'Person',
    lastName: 'Example',
  });
  const storedUser = [...users.values()][0];

  assert.equal(storedUser.email, 'person@example.com');
  assert.notEqual(storedUser.passwordHash, password);
  assert.match(storedUser.passwordHash, /^\$argon2id\$/);
  assert.equal(await argon2.verify(storedUser.passwordHash, password), true);
  assert.equal(storedUser.status, 'ACTIVE');
  assert.equal(result.status, 'ACTIVE');
  assert.equal('passwordHash' in result, false);
});

test('register rejects a duplicate normalized email', async () => {
  const user = await activeUser({ email: 'person@example.com' });
  const { service, prisma } = createService([user]);

  await assert.rejects(
    service.register({
      email: ' PERSON@EXAMPLE.COM ',
      password,
      firstName: 'Other',
      lastName: 'Person',
    }),
    (error) => error.status === 409,
  );
  assert.equal(prisma.user.create.mock.callCount(), 0);
});

test('invalid login does not reveal whether the email exists', async () => {
  const missing = createService();
  const existing = createService([await activeUser()]);

  const getError = async (operation) => {
    try {
      await operation;
      assert.fail('login should fail');
    } catch (error) {
      return error;
    }
  };
  const missingError = await getError(
    missing.service.login({ email: 'missing@example.com', password }),
  );
  const wrongPasswordError = await getError(
    existing.service.login({
      email: 'active@example.com',
      password: 'incorrect-password',
    }),
  );

  assert.equal(missingError.status, 401);
  assert.equal(wrongPasswordError.status, 401);
  assert.equal(missingError.message, 'Invalid credentials');
  assert.equal(wrongPasswordError.message, missingError.message);
});

test('login rejects a pending user without creating a session', async () => {
  const user = await activeUser({
    email: 'pending@example.com',
    status: 'PENDING',
  });
  const { service, prisma, sessions } = createService([user]);

  await assert.rejects(
    service.login({ email: user.email, password }),
    (error) =>
      error.status === 401 && error.message === 'Invalid credentials',
  );
  assert.equal(sessions.size, 0);
  assert.equal(prisma.$transaction.mock.callCount(), 0);
});

test('valid login creates a session and uses separate minimal JWT claims', async () => {
  const user = await activeUser();
  const { service, jwt, sessions, users } = createService([user]);
  const tokens = await service.login({
    email: 'ACTIVE@EXAMPLE.COM',
    password,
  });
  const session = [...sessions.values()][0];
  const access = jwt.tokens.get(tokens.accessToken);
  const refresh = jwt.tokens.get(tokens.refreshToken);

  assert.equal(sessions.size, 1);
  assert.notEqual(session.refreshTokenHash, tokens.refreshToken);
  assert.equal(
    session.refreshTokenHash,
    createHash('sha256').update(tokens.refreshToken).digest('hex'),
  );
  assert.ok(users.get(user.id).lastLoginAt instanceof Date);
  assert.deepEqual(Object.keys(access.payload).sort(), ['sid', 'sub']);
  assert.deepEqual(Object.keys(refresh.payload).sort(), ['jti', 'sid', 'sub']);
  assert.equal(access.payload.sid, session.id);
  assert.equal(refresh.payload.sid, session.id);
  assert.equal(access.options.secret, accessSecret);
  assert.equal(refresh.options.secret, refreshSecret);
});

test('refresh rotates the token and preserves the absolute session expiry', async () => {
  const user = await activeUser();
  const { service, sessions } = createService([user]);
  const initialTokens = await service.login({
    email: user.email,
    password,
  });
  const session = [...sessions.values()][0];
  const initialHash = session.refreshTokenHash;
  const initialExpiry = session.expiresAt.getTime();
  const rotatedTokens = await service.refresh(initialTokens.refreshToken);

  assert.notEqual(rotatedTokens.accessToken, initialTokens.accessToken);
  assert.notEqual(rotatedTokens.refreshToken, initialTokens.refreshToken);
  assert.notEqual(session.refreshTokenHash, initialHash);
  assert.equal(session.expiresAt.getTime(), initialExpiry);
  assert.ok(session.lastUsedAt instanceof Date);
});

test('the previous refresh token is invalid after rotation', async () => {
  const user = await activeUser();
  const { service } = createService([user]);
  const initialTokens = await service.login({
    email: user.email,
    password,
  });

  await service.refresh(initialTokens.refreshToken);

  await assert.rejects(
    service.refresh(initialTokens.refreshToken),
    (error) =>
      error.status === 401 && error.message === 'Invalid refresh token',
  );
});

test('logout revokes without deleting the session and is idempotent', async () => {
  const user = await activeUser();
  const { service, prisma, sessions } = createService([user]);
  const tokens = await service.login({ email: user.email, password });
  const session = [...sessions.values()][0];

  await service.logout(tokens.refreshToken);

  assert.equal(sessions.size, 1);
  assert.ok(session.revokedAt instanceof Date);
  const revokeWhere =
    prisma.authSession.updateMany.mock.calls[0].arguments[0].where;
  assert.equal('refreshTokenHash' in revokeWhere, false);
  await assert.doesNotReject(service.logout(tokens.refreshToken));
});
