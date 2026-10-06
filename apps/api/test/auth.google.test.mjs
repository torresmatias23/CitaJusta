import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { test } from 'node:test';
import { JwtService } from '@nestjs/jwt';
import { UnauthorizedException } from '@nestjs/common';
import { AuthService } from '../dist/auth/auth.service.js';

const identity = { subject: 'verified-google-subject', email: 'google@example.test', firstName: 'Ana', lastName: 'Pérez' };
const config = { JWT_ACCESS_SECRET: 'a'.repeat(32), JWT_REFRESH_SECRET: 'b'.repeat(32), JWT_ACCESS_TTL_SECONDS: 900, JWT_REFRESH_TTL_SECONDS: 2592000 };
const user = (patch = {}) => ({ id: randomUUID(), email: identity.email, passwordHash: null, status: 'ACTIVE', deletedAt: null, ...patch });
function setup(initialUsers = [], initialIdentities = []) {
  const state = { users: structuredClone(initialUsers), identities: structuredClone(initialIdentities), sessions: [], audit: [], auditAttempts: 0, attempts: 0 };
  let verified = identity, failures = [], failAudit = false;
  const prisma = {
    user: {
      findUnique: async ({ where }) => state.users.find((row) => where.email ? row.email === where.email : row.id === where.id) ?? null,
      create: async ({ data }) => { state.users.push({ ...data, deletedAt: null }); return data; },
      update: async ({ where, data }) => { Object.assign(state.users.find((row) => row.id === where.id), data); },
    },
    externalIdentity: {
      findUnique: async ({ where }) => {
        const key = where.provider_providerSubject ?? where.userId_provider;
        const row = state.identities.find((row) => row.provider === key.provider &&
          (key.providerSubject ? row.providerSubject === key.providerSubject : row.userId === key.userId));
        return row ? { ...row, user: state.users.find((user) => user.id === row.userId) } : null;
      },
      create: async ({ data }) => { state.identities.push({ ...data }); return data; },
    },
    authSession: { create: async ({ data }) => { state.sessions.push({ ...data }); } },
    auditEvent: { create: async ({ data }) => { state.auditAttempts++; if (failAudit) throw new Error('private audit detail'); state.audit.push({ ...data }); } },
    $transaction: async (work, options) => {
      assert.equal(options?.isolationLevel, 'Serializable'); state.attempts++;
      const before = structuredClone(state);
      try { const result = await work(prisma); if (failures.length) throw failures.shift(); return result; }
      catch (error) { for (const key of ['users', 'identities', 'sessions', 'audit']) state[key] = before[key]; throw error; }
    },
  };
  const jwt = new JwtService();
  const verifier = { verify: async (credential) => {
    assert.equal(credential, 'google-secret-token');
    if (verified instanceof Error) throw verified; return verified;
  } };
  return { state, jwt, service: new AuthService(prisma, jwt, { getOrThrow: (key) => config[key] }, verifier),
    setIdentity: (value) => { verified = value; }, failAudit: () => { failAudit = true; }, failTransactions: (values) => { failures = values; } };
}
const token = 'google-secret-token';
const conflict = (code) => (error) => error.status === 409 && error.getResponse().code === code && !/userId|email|secret-token/.test(JSON.stringify(error.getResponse()));

test('first Google login atomically creates Google-only user, identity and ordinary internal session', async () => {
  const f = setup(), pair = await f.service.loginGoogle(token);
  assert.equal(f.state.users.length, 1); assert.equal(f.state.identities.length, 1); assert.equal(f.state.sessions.length, 1);
  const u = f.state.users[0], session = f.state.sessions[0];
  assert.equal(u.passwordHash, null); assert.equal(u.email, identity.email); assert.equal(u.firstNames, identity.firstName); assert.equal(u.lastNames, identity.lastName);
  assert.equal(u.status, 'ACTIVE'); assert.ok(u.emailVerifiedAt instanceof Date); assert.ok(u.lastLoginAt instanceof Date);
  assert.deepEqual(f.state.identities[0], { id: f.state.identities[0].id, userId: u.id, provider: 'GOOGLE', providerSubject: identity.subject });
  assert.equal(session.refreshTokenHash, createHash('sha256').update(pair.refreshToken).digest('hex'));
  const access = await f.jwt.verifyAsync(pair.accessToken, { secret: config.JWT_ACCESS_SECRET });
  const refresh = await f.jwt.verifyAsync(pair.refreshToken, { secret: config.JWT_REFRESH_SECRET });
  assert.equal(access.sub, u.id); assert.equal(access.sid, session.id); assert.ok(refresh.jti);
  assert.equal(access.exp - access.iat, 900); assert.equal(refresh.exp - refresh.iat, 2592000);
  assert.deepEqual(Object.keys(pair).sort(), ['accessToken', 'refreshToken', 'tokenType', 'accessTokenExpiresIn', 'refreshTokenExpiresIn'].sort());
  assert.doesNotMatch(JSON.stringify(f.state.audit), /google-secret-token|verified-google-subject|google@example/);
  assert.equal(f.state.audit[0].actionCode, 'AUTH_LOGIN_SUCCESS');
});
test('linked identity uses sub, retains local email and reuses user without inventing roles', async () => {
  const u = user({ email: 'original@example.test' });
  const f = setup([u], [{ id: randomUUID(), provider: 'GOOGLE', providerSubject: identity.subject, userId: u.id }]);
  f.setIdentity({ ...identity, firstName: undefined, lastName: undefined });
  await f.service.loginGoogle(token); await f.service.loginGoogle(token);
  assert.equal(f.state.users.length, 1); assert.equal(f.state.identities.length, 1); assert.equal(f.state.sessions.length, 2);
  assert.equal(f.state.users[0].email, u.email); assert.equal('roleAssignments' in f.state.users[0], false);
});
test('inactive, blocked, pending or deleted linked users are denied without session', async () => {
  for (const patch of [{ status: 'INACTIVE' }, { status: 'BLOCKED' }, { status: 'PENDING' }, { deletedAt: new Date() }]) {
    const u = user(patch), f = setup([u], [{ provider: 'GOOGLE', providerSubject: identity.subject, userId: u.id }]);
    await assert.rejects(f.service.loginGoogle(token), { status: 401, message: 'Invalid credentials' }); assert.equal(f.state.sessions.length, 0);
  }
});
test('email collision always requires explicit link, including inactive/deleted users', async () => {
  for (const patch of [{}, { status: 'INACTIVE' }, { deletedAt: new Date() }]) {
    const u = user(patch), f = setup([u]);
    await assert.rejects(f.service.loginGoogle(token), conflict('GOOGLE_ACCOUNT_LINK_REQUIRED'));
    assert.equal(f.state.identities.length + f.state.sessions.length, 0); assert.deepEqual(f.state.users, [u]);
  }
});
test('new user requires both verified names; does not invent profile data', async () => {
  for (const patch of [{ firstName: undefined }, { lastName: undefined }]) {
    const f = setup(); f.setIdentity({ ...identity, ...patch });
    await assert.rejects(f.service.loginGoogle(token), (error) => error.status === 400 && error.getResponse().code === 'GOOGLE_PROFILE_REQUIRED');
    assert.equal(f.state.users.length + f.state.identities.length + f.state.sessions.length, 0);
  }
});
test('Google-only password login keeps Invalid credentials including dummy hash password', async () => {
  const f = setup([user()]);
  for (const password of ['some-password', 'citajusta-invalid-password-placeholder']) {
    await assert.rejects(f.service.login({ email: identity.email, password }), { status: 401, message: 'Invalid credentials' });
  }
  assert.equal(f.state.sessions.length, 0);
});
test('matching authenticated owner links atomically and replay does not create session or duplicate audit', async () => {
  const u = user({ passwordHash: 'existing-hash' }), f = setup([u]);
  await f.service.linkGoogle(u.id, token); await f.service.linkGoogle(u.id, token);
  assert.equal(f.state.identities.length, 1); assert.equal(f.state.sessions.length, 0); assert.deepEqual(f.state.users, [u]);
  assert.equal(f.state.audit.length, 1); assert.equal(f.state.audit[0].actionCode, 'AUTH_GOOGLE_LINKED'); assert.equal(f.state.audit[0].actorUserId, u.id);
});
test('link rejects different email, other identity owner, or another Google identity', async () => {
  const u = user();
  const cases = [
    setup([user({ ...u, email: 'other@example.test' })]),
    setup([u], [{ provider: 'GOOGLE', providerSubject: identity.subject, userId: randomUUID() }]),
    setup([u], [{ provider: 'GOOGLE', providerSubject: 'another-subject', userId: u.id }]),
  ];
  for (const f of cases) {
    const before = structuredClone(f.state);
    await assert.rejects(f.service.linkGoogle(u.id, token), conflict('GOOGLE_IDENTITY_CONFLICT'));
    assert.deepEqual(f.state.identities, before.identities); assert.equal(f.state.sessions.length, 0);
  }
});
test('link rechecks current principal user ACTIVE/deletion within transaction', async () => {
  for (const u of [user({ status: 'BLOCKED' }), user({ deletedAt: new Date() }), null]) {
    const f = setup(u ? [u] : []);
    await assert.rejects(f.service.linkGoogle(u?.id ?? randomUUID(), token), { status: 401 });
    assert.equal(f.state.identities.length, 0);
  }
});
test('audit outage rolls back first login and explicit linking entirely', async () => {
  const f = setup(); f.failAudit(); await assert.rejects(f.service.loginGoogle(token), /private audit detail/);
  assert.equal(f.state.users.length + f.state.identities.length + f.state.sessions.length, 0);
  const u = user(), link = setup([u]); link.failAudit(); await assert.rejects(link.service.linkGoogle(u.id, token));
  assert.equal(link.state.identities.length, 0);
});
test('invalid external credentials remain sanitized even during audit outage', async () => {
  const f = setup(); f.setIdentity(new UnauthorizedException('Invalid Google credential')); f.failAudit();
  await assert.rejects(f.service.loginGoogle(token), { status: 401, message: 'Invalid Google credential' });
  assert.equal(f.state.attempts, 0);
  assert.equal(f.state.auditAttempts, 1);
  assert.equal(f.state.users.length + f.state.identities.length + f.state.sessions.length + f.state.audit.length, 0);
});

test('invalid Google login audits exactly one anonymous AUTH_LOGIN_FAILURE without sensitive identity data', async () => {
  const f = setup(); f.setIdentity(new UnauthorizedException('Invalid Google credential'));
  await assert.rejects(f.service.loginGoogle(token), { status: 401, message: 'Invalid Google credential' });
  assert.equal(f.state.auditAttempts, 1); assert.equal(f.state.audit.length, 1);
  const { id, ...record } = f.state.audit[0];
  assert.match(id, /^[0-9a-f-]{36}$/);
  assert.deepEqual(record, { actorType: 'USER', actionCode: 'AUTH_LOGIN_FAILURE', resourceType: 'AUTH', outcome: 'FAILURE', reasonCode: 'INVALID_CREDENTIALS' });
  assert.doesNotMatch(JSON.stringify(record), /credential|google-secret-token|verified-google-subject|google@example|actorUserId/);
  assert.equal(f.state.attempts, 0); assert.equal(f.state.users.length + f.state.identities.length + f.state.sessions.length, 0);
});

test('invalid Google link never audits a false login failure or creates identity/session, including audit outages', async () => {
  for (const outage of [false, true]) {
    const u = user(), f = setup([u]);
    f.setIdentity(new UnauthorizedException('Invalid Google credential')); if (outage) f.failAudit();
    await assert.rejects(f.service.linkGoogle(u.id, token), { status: 401, message: 'Invalid Google credential' });
    assert.equal(f.state.auditAttempts, 0); assert.deepEqual(f.state.audit, []);
    assert.equal(f.state.attempts, 0); assert.equal(f.state.identities.length + f.state.sessions.length, 0);
    assert.deepEqual(f.state.users, [u]);
  }
});
test('recognized transaction/unique conflicts retry at most twice and leave exactly one identity', async () => {
  for (const error of [{ code: 'P2034' }, { code: 'P2002', meta: { target: ['email'] } },
    { code: 'P2002', meta: { target: ['proveedor', 'sujeto_proveedor'] } },
    { name: 'DriverAdapterError', cause: { kind: 'TransactionWriteConflict', originalCode: '40001' } }]) {
    const f = setup(); f.failTransactions([error]); await f.service.loginGoogle(token);
    assert.equal(f.state.attempts, 2); assert.equal(f.state.users.length, 1); assert.equal(f.state.identities.length, 1); assert.equal(f.state.sessions.length, 1);
  }
  const f = setup(); f.failTransactions([{ code: 'P2034' }, { code: 'P2034' }, { code: 'P2034' }]);
  await assert.rejects(f.service.loginGoogle(token), conflict('GOOGLE_IDENTITY_CONFLICT')); assert.equal(f.state.attempts, 3); assert.equal(f.state.users.length, 0);
});
test('arbitrary storage/programming errors or unrelated constraints do not become conflicts or retries', async () => {
  for (const error of [new Error('programming detail'), { code: 'P2002', meta: { target: ['id'] } }, { code: 'P2002' }]) {
    const f = setup(); f.failTransactions([error]); await assert.rejects(f.service.loginGoogle(token), (caught) => caught === error);
    assert.equal(f.state.attempts, 1); assert.equal(f.state.users.length, 0);
  }
});
