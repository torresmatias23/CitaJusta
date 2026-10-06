import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { NestFactory } from '@nestjs/core';
import { UnauthorizedException } from '@nestjs/common';
import { loadApiEnvironment, assertSafeLocalDatabaseUrl, getE2ePort } from './local-environment.mjs';

test('HU-040 real PostgreSQL/HTTP Google authentication with injected offline verifier', { timeout: 120000 }, async (t) => {
  loadApiEnvironment(); assertSafeLocalDatabaseUrl(process.env.DATABASE_URL);
  process.env.NODE_ENV = 'test'; process.env.GOOGLE_AUTH_ENABLED = 'false';
  const [{ AppModule }, { configureApplication }, { PrismaService }, { GoogleTokenVerifier }, { AuditService }] = await Promise.all([
    import('../../dist/app.module.js'), import('../../dist/app.configuration.js'), import('../../dist/database/prisma.service.js'),
    import('../../dist/auth/google-token.verifier.js'), import('../../dist/audit/audit.service.js'),
  ]);
  const run = randomUUID(), prefix = `hu040-e2e-${run}-`, subjectPrefix = `hu040:${run}:`;
  const app = await NestFactory.create(AppModule, { logger: false });
  const identities = new Map(), institutionIds = [randomUUID(), randomUUID()], roleId = randomUUID(), permissionId = randomUUID();
  const anonymousAuditIds = [];
  let prisma;
  function identity(key, email = `${prefix}${key}@example.test`, extra = {}) {
    const credential = `test-only-credential-${key}`;
    identities.set(credential, { subject: `${subjectPrefix}${key}`, email, firstName: 'Google', lastName: 'Fixture', ...extra });
    return credential;
  }
  try {
    // Substitute only the injectable verification boundary. Production never receives a test mode.
    t.mock.method(app.get(GoogleTokenVerifier), 'verify', async (credential) => {
      const verified = identities.get(credential);
      if (!verified) throw new UnauthorizedException('Invalid Google credential');
      return verified;
    });
    configureApplication(app); await app.listen(getE2ePort(), '127.0.0.1'); prisma = app.get(PrismaService);
    // Capture exact IDs of this suite's unverified-actor audits, which cannot be found by user namespace.
    const createAudit = prisma.auditEvent.create.bind(prisma.auditEvent);
    prisma.auditEvent.create = async (args) => {
      const row = await createAudit(args);
      if (!args.data.actorUserId) anonymousAuditIds.push(args.data.id);
      return row;
    };
    const base = `http://127.0.0.1:${app.getHttpServer().address().port}/api/v1`;
    async function request(path, body, token, institutionId) {
      const response = await fetch(`${base}${path}`, { method: body === undefined ? 'GET' : 'POST',
        headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }),
          ...(token ? { authorization: `Bearer ${token}` } : {}), ...(institutionId ? { 'x-institution-id': institutionId } : {}) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      return { status: response.status, body: response.status === 204 ? undefined : await response.json() };
    }
    const google = (credential) => request('/auth/google', { credential });
    const link = (credential, token) => request('/auth/google/link', { credential }, token);
    async function local(key) {
      const credentials = { email: `${prefix}${key}@example.test`, password: `Test-${randomUUID()}-Aa1!` };
      const registered = await request('/auth/register', { ...credentials, firstName: 'Local', lastName: 'Fixture' });
      assert.equal(registered.status, 201);
      const login = await request('/auth/login', credentials); assert.equal(login.status, 200);
      return { id: registered.body.id, credentials, pair: login.body };
    }
    const firstCredential = identity('new'); let firstPair, googleUser, localUser;
    await t.test('additive migration is applied and password hash is nullable', async () => {
      const rows = await prisma.$queryRaw`SELECT is_nullable FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'usuarios' AND column_name = 'password_hash'`;
      assert.equal(rows[0].is_nullable, 'YES');
      assert.equal(await prisma.externalIdentity.count({ where: { providerSubject: { startsWith: subjectPrefix } } }), 0);
      const migrations = await prisma.$queryRaw`SELECT finished_at FROM "_prisma_migrations" WHERE migration_name = '20261006000000_google_external_identity' AND rolled_back_at IS NULL`;
      assert.ok(migrations[0]?.finished_at);
    });
    await t.test('first login creates one User, one ExternalIdentity, one normal AuthSession and minimal audit', async () => {
      const result = await google(firstCredential); assert.equal(result.status, 200); firstPair = result.body;
      googleUser = await prisma.user.findUniqueOrThrow({ where: { email: identities.get(firstCredential).email } });
      assert.equal(googleUser.passwordHash, null); assert.equal(googleUser.status, 'ACTIVE'); assert.ok(googleUser.emailVerifiedAt && googleUser.lastLoginAt);
      assert.equal(await prisma.user.count({ where: { email: googleUser.email } }), 1);
      assert.equal(await prisma.externalIdentity.count({ where: { userId: googleUser.id } }), 1);
      assert.equal(await prisma.authSession.count({ where: { userId: googleUser.id } }), 1);
      assert.equal(await prisma.userRole.count({ where: { userId: googleUser.id } }), 0);
      assert.deepEqual(Object.keys(firstPair).sort(), ['accessToken', 'refreshToken', 'tokenType', 'accessTokenExpiresIn', 'refreshTokenExpiresIn'].sort());
      const audit = await prisma.auditEvent.findMany({ where: { actorUserId: googleUser.id } });
      assert.equal(audit.length, 1); assert.equal(audit[0].actionCode, 'AUTH_LOGIN_SUCCESS');
      assert.doesNotMatch(JSON.stringify(audit), /test-only-credential|hu040:|example.test/);
      const me = await request('/users/me', undefined, firstPair.accessToken); assert.equal(me.status, 200);
      assert.deepEqual(me.body.data.roles, []); assert.deepEqual(me.body.data.permissions, []);
    });
    await t.test('repeat uses stable sub, retains local identity and creates another ordinary session', async () => {
      const changedEmail = identity('new', `${prefix}changed@example.test`, { firstName: undefined, lastName: undefined });
      const result = await google(changedEmail); assert.equal(result.status, 200);
      assert.equal(await prisma.user.count({ where: { email: googleUser.email } }), 1);
      assert.equal(await prisma.user.count({ where: { email: `${prefix}changed@example.test` } }), 0);
      assert.equal(await prisma.externalIdentity.count({ where: { userId: googleUser.id } }), 1);
      assert.equal(await prisma.authSession.count({ where: { userId: googleUser.id } }), 2);
      const refreshed = await request('/auth/refresh', { refreshToken: result.body.refreshToken }); assert.equal(refreshed.status, 200);
      assert.equal((await request('/auth/refresh', { refreshToken: result.body.refreshToken })).status, 401);
      assert.equal((await request('/auth/logout', { refreshToken: refreshed.body.refreshToken })).status, 204);
      assert.equal((await request('/auth/refresh', { refreshToken: refreshed.body.refreshToken })).status, 401);
    });
    await t.test('Google-only password login stays sanitized and creates no session', async () => {
      const before = await prisma.authSession.count({ where: { userId: googleUser.id } });
      const invalid = await request('/auth/login', { email: googleUser.email, password: 'citajusta-invalid-password-placeholder' });
      assert.equal(invalid.status, 401); assert.equal(invalid.body.message, 'Invalid credentials');
      assert.equal(await prisma.authSession.count({ where: { userId: googleUser.id } }), before);
    });
    await t.test('existing local email returns LINK_REQUIRED without auto-link or extra disclosure', async () => {
      localUser = await local('local');
      const result = await google(identity('local', localUser.credentials.email));
      assert.equal(result.status, 409); assert.equal(result.body.code, 'GOOGLE_ACCOUNT_LINK_REQUIRED');
      assert.deepEqual(Object.keys(result.body).sort(), ['code', 'message']);
      assert.equal(await prisma.externalIdentity.count({ where: { userId: localUser.id } }), 0);
      assert.equal(await prisma.authSession.count({ where: { userId: localUser.id } }), 1);
    });
    await t.test('link requires authenticated owner, strict body, matching email and is idempotent without session', async () => {
      const credential = identity('local', localUser.credentials.email), before = await prisma.user.findUniqueOrThrow({ where: { id: localUser.id } });
      assert.equal((await link(credential)).status, 401);
      const failuresBeforeLink = anonymousAuditIds.length;
      const invalidLink = await link('invalid-test-token', localUser.pair.accessToken);
      assert.equal(invalidLink.status, 401); assert.equal(invalidLink.body.message, 'Invalid Google credential');
      assert.equal(anonymousAuditIds.length, failuresBeforeLink);
      assert.equal(await prisma.externalIdentity.count({ where: { userId: localUser.id } }), 0);
      assert.equal(await prisma.authSession.count({ where: { userId: localUser.id } }), 1);
      assert.equal((await request('/auth/google/link', { credential, userId: googleUser.id }, localUser.pair.accessToken)).status, 400);
      assert.equal((await link(firstCredential, localUser.pair.accessToken)).status, 409);
      assert.equal((await link(credential, localUser.pair.accessToken)).status, 204);
      assert.equal((await link(credential, localUser.pair.accessToken)).status, 204);
      assert.equal(await prisma.externalIdentity.count({ where: { userId: localUser.id } }), 1);
      assert.equal(await prisma.authSession.count({ where: { userId: localUser.id } }), 1);
      assert.deepEqual(await prisma.user.findUniqueOrThrow({ where: { id: localUser.id } }), before);
      assert.equal(await prisma.auditEvent.count({ where: { actorUserId: localUser.id, actionCode: 'AUTH_GOOGLE_LINKED' } }), 1);
      assert.equal((await link(identity('second-google', localUser.credentials.email), localUser.pair.accessToken)).status, 409);
    });
    await t.test('Google login/link never create or broaden existing tenant roles and permissions', async () => {
      await prisma.institution.createMany({ data: institutionIds.map((id) => ({ id, name: `${prefix}institution`, status: 'ACTIVE' })) });
      await prisma.role.create({ data: { id: roleId, code: `${prefix}ROLE`, name: 'HU040 fixture', scope: 'INSTITUTION' } });
      await prisma.permission.create({ data: { id: permissionId, code: `${prefix}read`, module: prefix, action: 'read' } });
      await prisma.rolePermission.create({ data: { roleId, permissionId } });
      await prisma.userRole.create({ data: { id: randomUUID(), userId: localUser.id, roleId, institutionId: institutionIds[0], active: true } });
      const before = await prisma.userRole.findMany({ where: { userId: localUser.id } });
      const result = await google(identity('local', localUser.credentials.email)); assert.equal(result.status, 200);
      assert.equal((await link(identity('local', localUser.credentials.email), result.body.accessToken)).status, 204);
      assert.deepEqual(await prisma.userRole.findMany({ where: { userId: localUser.id } }), before);
      const own = await request('/users/me', undefined, result.body.accessToken, institutionIds[0]);
      const foreign = await request('/users/me', undefined, result.body.accessToken, institutionIds[1]);
      assert.equal(own.status, 200); assert.deepEqual(own.body.data.permissions, [`${prefix}read`]);
      assert.equal(foreign.status, 200); assert.deepEqual(foreign.body.data.permissions, []); assert.deepEqual(foreign.body.data.roles, []);
      assert.equal(await prisma.userRole.count({ where: { userId: googleUser.id } }), 0);
    });
    await t.test('concurrent first logins create exactly one User/identity with independent normal sessions', async () => {
      const credential = identity('concurrent');
      const results = await Promise.all(Array.from({ length: 2 }, () => google(credential)));
      assert.deepEqual(results.map((r) => r.status), [200, 200]);
      const u = await prisma.user.findUniqueOrThrow({ where: { email: identities.get(credential).email } });
      assert.equal(await prisma.user.count({ where: { email: u.email } }), 1);
      assert.equal(await prisma.externalIdentity.count({ where: { userId: u.id } }), 1);
      assert.equal(await prisma.authSession.count({ where: { userId: u.id } }), 2);
    });
    await t.test('concurrent explicit link is idempotent and subject already owned elsewhere cannot be reassigned', async () => {
      const owner = await local('owner'), credential = identity('owner', owner.credentials.email);
      const results = await Promise.all([link(credential, owner.pair.accessToken), link(credential, owner.pair.accessToken)]);
      assert.deepEqual(results.map((r) => r.status), [204, 204]);
      assert.equal(await prisma.externalIdentity.count({ where: { userId: owner.id } }), 1);
      const other = await local('other');
      // Simulate verified provider email changing; persistent sub remains attached to its original owner.
      identity('owner', other.credentials.email);
      const denied = await link(credential, other.pair.accessToken); assert.equal(denied.status, 409); assert.equal(denied.body.code, 'GOOGLE_IDENTITY_CONFLICT');
      assert.equal(await prisma.externalIdentity.count({ where: { userId: other.id } }), 0);
    });
    await t.test('inactive/deleted linked users and invalid credentials are denied; body cannot supply grants', async () => {
      for (const patch of [{ status: 'INACTIVE' }, { deletedAt: new Date() }]) {
        await prisma.user.update({ where: { id: googleUser.id }, data: patch });
        const denied = await google(firstCredential); assert.equal(denied.status, 401);
        await prisma.user.update({ where: { id: googleUser.id }, data: { status: 'ACTIVE', deletedAt: null } });
      }
      assert.equal((await google('invalid-test-token')).status, 401);
      for (const key of ['email', 'providerSubject', 'userId', 'role', 'institutionId', 'permissions']) {
        assert.equal((await request('/auth/google', { credential: firstCredential, [key]: 'override' })).status, 400);
      }
      assert.equal((await google(identity('missing-name', undefined, { lastName: undefined }))).status, 400);
    });
    await t.test('audit failure rolls back real PostgreSQL first-login transaction', async () => {
      const credential = identity('rollback');
      const original = AuditService.record;
      const patched = t.mock.method(AuditService, 'record', async (tx, record) => { await original(tx, record); throw new Error('controlled audit outage'); });
      try { assert.equal((await google(credential)).status, 500); } finally { patched.mock.restore(); }
      assert.equal(await prisma.user.count({ where: { email: identities.get(credential).email } }), 0);
      assert.equal(await prisma.externalIdentity.count({ where: { providerSubject: identities.get(credential).subject } }), 0);
    });
  } finally {
    try {
      if (prisma) {
        const users = await prisma.user.findMany({ where: { email: { startsWith: prefix } }, select: { id: true } });
        const userIds = users.map((row) => row.id);
        await prisma.auditEvent.deleteMany({ where: { actorUserId: { in: userIds } } });
        await prisma.auditEvent.deleteMany({ where: { id: { in: anonymousAuditIds } } });
        await prisma.externalIdentity.deleteMany({ where: { userId: { in: userIds } } });
        await prisma.authSession.deleteMany({ where: { userId: { in: userIds } } });
        await prisma.userRole.deleteMany({ where: { userId: { in: userIds } } });
        await prisma.rolePermission.deleteMany({ where: { roleId } });
        await prisma.role.deleteMany({ where: { id: roleId } });
        await prisma.permission.deleteMany({ where: { id: permissionId } });
        await prisma.user.deleteMany({ where: { id: { in: userIds } } });
        await prisma.institution.deleteMany({ where: { id: { in: institutionIds } } });
        assert.equal(await prisma.user.count({ where: { email: { startsWith: prefix } } }), 0);
        assert.equal(await prisma.externalIdentity.count({ where: { providerSubject: { startsWith: subjectPrefix } } }), 0);
        assert.equal(await prisma.auditEvent.count({ where: { actorUserId: { in: userIds } } }), 0);
        assert.ok(anonymousAuditIds.length >= 2);
        assert.equal(await prisma.auditEvent.count({ where: { id: { in: anonymousAuditIds } } }), 0);
      }
    } finally { await app.close(); }
  }
});
