import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mock, test } from 'node:test';
import { JwtService } from '@nestjs/jwt';
import { AccessTokenGuard } from '../dist/auth/guards/access-token.guard.js';

const accessSecret = 'test-access-secret-with-at-least-32-characters';
const refreshSecret = 'test-refresh-secret-with-at-least-32-characters';
const userId = randomUUID();
const sessionId = randomUUID();

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

function createGuard(user) {
  const jwtService = new JwtService();
  const findUnique = mock.fn(async () => user);
  const prisma = { user: { findUnique } };
  const config = {
    getOrThrow: mock.fn((key) => {
      assert.equal(key, 'JWT_ACCESS_SECRET');
      return accessSecret;
    }),
  };

  return {
    guard: new AccessTokenGuard(jwtService, prisma, config),
    jwtService,
    findUnique,
  };
}

async function signAccess(jwtService, options = {}) {
  return jwtService.signAsync(
    { sub: userId, sid: sessionId },
    {
      secret: accessSecret,
      algorithm: 'HS256',
      expiresIn: 60,
      ...options,
    },
  );
}

test('access token guard rejects a missing token before querying the user', async () => {
  const { guard, findUnique } = createGuard({
    status: 'ACTIVE',
    deletedAt: null,
  });

  await assert.rejects(
    guard.canActivate(httpContext({ headers: {} })),
    hasStatus(401),
  );
  assert.equal(findUnique.mock.callCount(), 0);
});

test('access token guard rejects an invalid signature', async () => {
  const { guard, jwtService, findUnique } = createGuard({
    status: 'ACTIVE',
    deletedAt: null,
  });
  const token = await jwtService.signAsync(
    { sub: userId, sid: sessionId },
    { secret: 'a-different-secret-with-at-least-32-characters' },
  );

  await assert.rejects(
    guard.canActivate(
      httpContext({ headers: { authorization: `Bearer ${token}` } }),
    ),
    hasStatus(401),
  );
  assert.equal(findUnique.mock.callCount(), 0);
});

test('access token guard requires a non-expired exp claim', async () => {
  const { guard, jwtService, findUnique } = createGuard({
    status: 'ACTIVE',
    deletedAt: null,
  });
  const withoutExpiration = await jwtService.signAsync(
    { sub: userId, sid: sessionId },
    { secret: accessSecret, algorithm: 'HS256' },
  );
  const expired = await signAccess(jwtService, { expiresIn: -1 });

  for (const token of [withoutExpiration, expired]) {
    await assert.rejects(
      guard.canActivate(
        httpContext({ headers: { authorization: `Bearer ${token}` } }),
      ),
      hasStatus(401),
    );
  }
  assert.equal(findUnique.mock.callCount(), 0);
});

test('access token guard does not accept a refresh token', async () => {
  const { guard, jwtService, findUnique } = createGuard({
    status: 'ACTIVE',
    deletedAt: null,
  });
  const refreshToken = await jwtService.signAsync(
    { sub: userId, sid: sessionId, jti: randomUUID() },
    {
      secret: refreshSecret,
      algorithm: 'HS256',
      expiresIn: 60,
    },
  );

  await assert.rejects(
    guard.canActivate(
      httpContext({
        headers: { authorization: `Bearer ${refreshToken}` },
      }),
    ),
    hasStatus(401),
  );
  assert.equal(findUnique.mock.callCount(), 0);
});

test('access token guard authenticates an active user with a minimal principal', async () => {
  const { guard, jwtService, findUnique } = createGuard({
    status: 'ACTIVE',
    deletedAt: null,
  });
  const token = await signAccess(jwtService);
  const request = {
    headers: { authorization: `Bearer ${token}` },
  };

  assert.equal(await guard.canActivate(httpContext(request)), true);
  assert.deepEqual(request.principal, {
    userId,
    sessionId,
  });
  assert.deepEqual(findUnique.mock.calls[0].arguments[0], {
    where: { id: userId },
    select: { status: true, deletedAt: true },
  });
});

test('access token guard rejects non-active users', async () => {
  for (const status of ['PENDING', 'INACTIVE', 'BLOCKED']) {
    const { guard, jwtService } = createGuard({ status, deletedAt: null });
    const token = await signAccess(jwtService);

    await assert.rejects(
      guard.canActivate(
        httpContext({ headers: { authorization: `Bearer ${token}` } }),
      ),
      hasStatus(401),
    );
  }
});

test('access token guard rejects deleted and missing users', async () => {
  for (const user of [
    { status: 'ACTIVE', deletedAt: new Date() },
    null,
  ]) {
    const { guard, jwtService } = createGuard(user);
    const token = await signAccess(jwtService);

    await assert.rejects(
      guard.canActivate(
        httpContext({ headers: { authorization: `Bearer ${token}` } }),
      ),
      hasStatus(401),
    );
  }
});
