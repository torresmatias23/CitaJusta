import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { NestFactory } from '@nestjs/core';
import { loadApiEnvironment, getE2ePort } from './local-environment.mjs';
import { assertE2EFixtureDatabase } from '../../scripts/e2e-docker-environment.mjs';

test('RF-003 real isolated PostgreSQL recovery, delivery, limits, races and session revocation', { timeout: 180000 }, async t => {
  loadApiEnvironment();
  process.env.ACCOUNT_RECOVERY_ENABLED = 'true'; process.env.ACCOUNT_RECOVERY_WEB_ORIGIN = 'http://127.0.0.1:5173';
  process.env.ACCOUNT_RECOVERY_KEY_ID = 'recovery-e2e'; process.env.ACCOUNT_RECOVERY_ENCRYPTION_KEY = randomBytes(32).toString('hex');
  process.env.ACCOUNT_RECOVERY_HMAC_KEY = randomBytes(32).toString('hex');
  process.env.RESEND_FROM = 'CitaJusta <fixture@example.test>'; process.env.RESEND_API_KEY = 're_offline_test_only';
  const [{ AppModule }, { configureApplication }, { PrismaService }, { AccountRecoveryCrypto }, { AccountRecoveryDeliveryService }, { AuthService }, { AuditService }, { ConfigService }] = await Promise.all([
    import('../../dist/app.module.js'), import('../../dist/app.configuration.js'), import('../../dist/database/prisma.service.js'),
    import('../../dist/auth/account-recovery.crypto.js'), import('../../dist/auth/account-recovery-delivery.service.js'), import('../../dist/auth/auth.service.js'),
    import('../../dist/audit/audit.service.js'), import('@nestjs/config'),
  ]);
  const app = await NestFactory.create(AppModule, { logger: false });
  const prefix = `rf003-${randomUUID()}-`, users = [], emails = new Set(), anonymousAuditIds = [], roleId = randomUUID(), institutionId = randomUUID();
  let prisma, crypto, base;
  const originalPassword = `Original-${randomUUID()}`, newPassword = `New-${randomUUID()}`;
  const payloads = new Map();
  const sender = { send: t.mock.fn(async (id, payload) => { payloads.set(id, payload); return randomUUID(); }) };
  async function request(path, body, access) {
    const response = await fetch(`${base}${path}`, { method: body === undefined ? 'GET' : 'POST',
      headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(access ? { authorization: `Bearer ${access}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, body: response.status === 204 ? null : await response.json() };
  }
  async function local(name) {
    const email = `${prefix}${name}@example.test`; emails.add(email);
    const response = await request('/auth/register', { email, password: originalPassword, firstName: 'Recovery', lastName: 'Fixture' });
    assert.equal(response.status, 201); users.push(response.body.id); return { id: response.body.id, email };
  }
  const ask = user => request('/auth/forgot-password', { email: user.email });
  const reset = (token, password = newPassword) => request('/auth/reset-password', { token, password });
  const login = (user, password = originalPassword) => request('/auth/login', { email: user.email, password });
  async function recovery(user) {
    const row = await prisma.accountRecovery.findFirstOrThrow({ where: { userId: user.id, consumedAt: null, invalidatedAt: null } });
    const payload = crypto.decrypt(row.id, row);
    return { row, token: new URLSearchParams(new URL(payload.text.split('\n')[1]).hash.slice(1)).get('token') };
  }
  async function cooldown(user) {
    assert.ok(emails.has(user.email) && user.email.startsWith(prefix));
    await prisma.accountRecoveryLimit.update({ where: { emailHmac: crypto.emailHmac(user.email) }, data: { lastAcceptedAt: new Date(Date.now() - 61000) } });
  }
  try {
    configureApplication(app); await app.listen(getE2ePort(), '127.0.0.1');
    prisma = app.get(PrismaService); crypto = app.get(AccountRecoveryCrypto); await assertE2EFixtureDatabase(prisma);
    const createAudit = prisma.auditEvent.create.bind(prisma.auditEvent);
    prisma.auditEvent.create = async args => { const row = await createAudit(args); if (!args.data.actorUserId && !args.data.resourceId) anonymousAuditIds.push(args.data.id); return row; };
    base = `http://127.0.0.1:${app.getHttpServer().address().port}/api/v1`;
    // Manual delivery boundary with mocked provider. Automatic sending is disabled; retention remains active.
    // Explicit per-key delegation leaves the automatic worker disabled.
    const deliveryConfig = { getOrThrow: key => key === 'EMAIL_DELIVERY_ENABLED' ? true : app.get(ConfigService).getOrThrow(key) };
    const delivery = new AccountRecoveryDeliveryService(prisma, deliveryConfig, crypto, sender);

    await t.test('migration creates exactly two recovery tables, FK, unique token and open-user protection', async () => {
      const tables = await prisma.$queryRaw`SELECT tablename FROM pg_catalog.pg_tables WHERE schemaname = 'public' AND tablename IN ('recuperaciones_cuenta','limites_recuperacion_cuenta')`;
      assert.equal(tables.length, 2);
      const indexes = await prisma.$queryRaw`SELECT indexname, indexdef FROM pg_indexes WHERE schemaname='public' AND tablename='recuperaciones_cuenta'`;
      assert.ok(indexes.some(row => row.indexname === 'recuperaciones_cuenta_usuario_abierta_key' && row.indexdef.includes('UNIQUE') && row.indexdef.includes('WHERE')));
      const constraints = await prisma.$queryRaw`SELECT contype::text AS contype FROM pg_constraint WHERE conrelid = 'recuperaciones_cuenta'::regclass`;
      assert.ok(constraints.some(row => row.contype === 'f')); assert.ok(constraints.some(row => row.contype === 'c'));
    });
    await t.test('complete HTTP flow encrypts delivery, emits minimal audit and revokes access/refresh, not RBAC', async () => {
      const user = await local('complete');
      await prisma.institution.create({ data: { id: institutionId, name: prefix } });
      await prisma.role.create({ data: { id: roleId, code: `${prefix}ROLE`, name: 'Recovery fixture', scope: 'INSTITUTION' } });
      await prisma.userRole.create({ data: { id: randomUUID(), userId: user.id, roleId, institutionId } });
      const grants = await prisma.userRole.findMany({ where: { userId: user.id } });
      const pair = await login(user); assert.equal(pair.status, 200);
      assert.equal((await request('/users/me', undefined, pair.body.accessToken)).status, 200);
      const asked = await ask(user); assert.equal(asked.status, 202); assert.deepEqual(Object.keys(asked.body), ['message']);
      const { row, token } = await recovery(user); assert.notEqual(row.tokenHash, token);
      assert.equal(row.expiresAt - row.createdAt, 1800000); assert.ok(!JSON.stringify(row).includes(token));
      assert.equal(await prisma.notification.count({ where: { recipientUserId: user.id } }), 0);
      await delivery.deliver(row.id); assert.ok(payloads.get(row.id).text.includes(token));
      assert.equal((await prisma.accountRecovery.findUniqueOrThrow({ where: { id: row.id } })).ciphertext, null);
      assert.equal((await reset(token)).status, 200); assert.equal((await reset(token)).status, 400);
      assert.equal((await request('/users/me', undefined, pair.body.accessToken)).status, 401);
      assert.equal((await request('/auth/refresh', { refreshToken: pair.body.refreshToken })).status, 401);
      assert.equal((await login(user)).status, 401); assert.equal((await login(user, newPassword)).status, 200);
      assert.deepEqual(await prisma.userRole.findMany({ where: { userId: user.id } }), grants);
      const audits = await prisma.auditEvent.findMany({ where: { OR: [{ actorUserId: user.id }, { resourceId: user.id }] } });
      assert.equal(audits.filter(row => row.actionCode === 'ACCOUNT_PASSWORD_RESET').length, 1);
      for (const secret of [token, user.email, originalPassword, newPassword, row.tokenHash]) assert.ok(!JSON.stringify(audits).includes(secret));
    });
    await t.test('invalid, manipulated and expired tokens do not consume or modify users', async () => {
      const user = await local('expired'); await ask(user); const { row, token } = await recovery(user);
      assert.equal((await reset('bad')).status, 400); assert.equal((await reset(crypto.token())).status, 400);
      await prisma.accountRecovery.update({ where: { id: row.id }, data: { expiresAt: new Date(row.createdAt.getTime() + 1) } });
      assert.equal((await reset(token)).status, 400); assert.equal((await login(user)).status, 200);
    });
    await t.test('two concurrent resets consume exactly once and leave one reset audit', async () => {
      const user = await local('race'); await ask(user); const { row, token } = await recovery(user);
      const results = await Promise.all([reset(token), reset(token)]);
      assert.deepEqual(results.map(r => r.status).sort(), [200, 400]);
      const stored = await prisma.accountRecovery.findUniqueOrThrow({ where: { id: row.id } }); assert.ok(stored.consumedAt); assert.equal(stored.ciphertext, null);
      assert.equal(await prisma.auditEvent.count({ where: { actorUserId: user.id, actionCode: 'ACCOUNT_PASSWORD_RESET' } }), 1);
    });
    await t.test('concurrent requests share persistent throttle key and create only one outstanding recovery', async () => {
      const user = await local('request-race');
      const results = await Promise.all([ask(user), ask(user), ask(user)]); assert.ok(results.every(r => r.status === 202));
      assert.equal(await prisma.accountRecovery.count({ where: { userId: user.id } }), 1);
      const limit = await prisma.accountRecoveryLimit.findUniqueOrThrow({ where: { emailHmac: crypto.emailHmac(user.email) } }); assert.equal(limit.requestCount, 1);
    });
    await t.test('three hourly admissions, 60-second cooldown and invalidation are persistent and generic', async () => {
      const user = await local('limits'); const firstResponse = await ask(user); const first = await recovery(user);
      assert.deepEqual((await ask(user)).body, firstResponse.body); assert.equal(await prisma.accountRecovery.count({ where: { userId: user.id } }), 1);
      for (let i = 0; i < 2; i++) { await cooldown(user); assert.deepEqual(await ask(user), firstResponse); }
      await cooldown(user); assert.deepEqual(await ask(user), firstResponse);
      assert.equal(await prisma.accountRecovery.count({ where: { userId: user.id } }), 3);
      assert.equal(await prisma.accountRecovery.count({ where: { userId: user.id, consumedAt: null, invalidatedAt: null } }), 1);
      assert.equal((await reset(first.token)).status, 400);
      assert.equal((await prisma.accountRecoveryLimit.findUniqueOrThrow({ where: { emailHmac: crypto.emailHmac(user.email) } })).requestCount, 3);
    });
    await t.test('nonexistent email receives same response and persistent admission controls', async () => {
      const user = { email: `${prefix}missing@example.test` }; emails.add(user.email);
      const response = await ask(user); assert.equal(response.status, 202);
      for (let i = 0; i < 4; i++) { await cooldown(user); assert.deepEqual(await ask(user), response); }
      assert.equal((await prisma.accountRecoveryLimit.findUniqueOrThrow({ where: { emailHmac: crypto.emailHmac(user.email) } })).requestCount, 3);
      assert.equal(await prisma.user.count({ where: { email: user.email } }), 0);
    });
    await t.test('Google-only, inactive, deleted and technical identities cannot provision local passwords', async () => {
      for (const [key, data] of [['google', { passwordHash: null }], ['inactive', { status: 'INACTIVE' }], ['deleted', { deletedAt: new Date() }], ['technical', { passwordHash: '!CITA_JUSTA_DEMO_NO_LOGIN!' }]]) {
        const user = await local(key); await prisma.user.update({ where: { id: user.id }, data });
        const before = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
        assert.equal((await ask(user)).status, 202); assert.equal(await prisma.accountRecovery.count({ where: { userId: user.id } }), 0);
        assert.deepEqual(await prisma.user.findUniqueOrThrow({ where: { id: user.id } }), before);
      }
    });
    await t.test('local account linked to Google preserves external identity on reset', async () => {
      const user = await local('linked'); const identityId = randomUUID();
      await prisma.externalIdentity.create({ data: { id: identityId, userId: user.id, provider: 'GOOGLE', providerSubject: `${prefix}subject` } });
      const before = await prisma.externalIdentity.findUniqueOrThrow({ where: { id: identityId } });
      await ask(user); const { token } = await recovery(user); assert.equal((await reset(token)).status, 200);
      assert.deepEqual(await prisma.externalIdentity.findUniqueOrThrow({ where: { id: identityId } }), before);
    });
    await t.test('old-password login paused after verification cannot create a session after reset commits', async () => {
      const user = await local('stale-login'); await ask(user); const { token } = await recovery(user);
      const auth = app.get(AuthService); const verify = auth.verifyPassword.bind(auth);
      let release, entered; const paused = new Promise(resolve => { entered = resolve; }); const resume = new Promise(resolve => { release = resolve; });
      const spy = t.mock.method(auth, 'verifyPassword', async (hash, password) => { const valid = await verify(hash, password); if (password === originalPassword) { entered(); await resume; } return valid; });
      try {
        const pending = login(user); await paused; assert.equal((await reset(token)).status, 200); release();
        assert.equal((await pending).status, 401); assert.equal(await prisma.authSession.count({ where: { userId: user.id, revokedAt: null } }), 0);
      } finally { release(); spy.mock.restore(); }
    });
    await t.test('audit write failure rolls back consumption, password, all sessions and sensitive envelope', async () => {
      const user = await local('rollback'); const pair = await login(user); await ask(user); const { row, token } = await recovery(user);
      const before = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      const record = AuditService.record.bind(AuditService);
      const spy = t.mock.method(AuditService, 'record', async (tx, event) => { if (event.actionCode === 'ACCOUNT_PASSWORD_RESET') throw new Error('controlled fixture audit failure'); return record(tx, event); });
      try { assert.equal((await reset(token)).status, 500); } finally { spy.mock.restore(); }
      const after = await prisma.accountRecovery.findUniqueOrThrow({ where: { id: row.id } });
      assert.equal(after.consumedAt, null); assert.ok(after.ciphertext); assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).passwordHash, before.passwordHash);
      assert.equal((await request('/users/me', undefined, pair.body.accessToken)).status, 200); assert.equal((await reset(token)).status, 200);
    });
    await t.test('request schemas reject extra input and short passwords without reflecting secrets', async () => {
      const user = await local('strict');
      const extra = await request('/auth/forgot-password', { email: user.email, userId: users[0] }); assert.equal(extra.status, 400);
      await ask(user); const { token } = await recovery(user);
      for (const body of [{ token, password: 'short' }, { token, password: newPassword, userId: users[0] }]) {
        const response = await request('/auth/reset-password', body); assert.equal(response.status, 400); assert.ok(!JSON.stringify(response.body).includes(token));
      }
    });
    await t.test('expired leases resume safely without plaintext persistence or double delivery', async () => {
      const user = await local('lease'); await ask(user); const { row } = await recovery(user);
      await prisma.accountRecovery.update({ where: { id: row.id }, data: { deliveryStatus: 'PROCESSING', claimToken: randomUUID(), lockedUntil: new Date(0), attemptCount: 1 } });
      const before = sender.send.mock.callCount(); await Promise.all([delivery.deliver(row.id), delivery.deliver(row.id)]);
      assert.equal(sender.send.mock.callCount() - before, 1);
      assert.equal((await prisma.accountRecovery.findUniqueOrThrow({ where: { id: row.id } })).ciphertext, null);
    });
    await t.test('processing expires encrypted material and removes only expired limit records', async () => {
      const user = await local('purge'); await ask(user); const { row } = await recovery(user);
      await prisma.accountRecovery.update({ where: { id: row.id }, data: { expiresAt: new Date(row.createdAt.getTime() + 1) } });
      await delivery.cleanupExpiredBatch();
      const after = await prisma.accountRecovery.findUniqueOrThrow({ where: { id: row.id } }); assert.equal(after.ciphertext, null); assert.equal(after.lastErrorCode, 'EMAIL_RECOVERY_EXPIRED');
    });
  } finally {
    if (prisma) {
      try {
        await assertE2EFixtureDatabase(prisma);
        const own = await prisma.user.findMany({ where: { id: { in: users } }, select: { id: true, email: true } });
        assert.ok(own.every(user => user.email.startsWith(prefix) && emails.has(user.email)));
        await prisma.accountRecovery.deleteMany({ where: { userId: { in: own.map(user => user.id) } } });
        await prisma.accountRecoveryLimit.deleteMany({ where: { emailHmac: { in: [...emails].map(email => crypto.emailHmac(email)) } } });
        await prisma.auditEvent.deleteMany({ where: { OR: [{ actorUserId: { in: users } }, { resourceId: { in: users }, actionCode: 'ACCOUNT_RECOVERY_REQUESTED' }, { id: { in: anonymousAuditIds } }] } });
        await prisma.authSession.deleteMany({ where: { userId: { in: users } } });
        await prisma.externalIdentity.deleteMany({ where: { userId: { in: users }, providerSubject: { startsWith: prefix } } });
        await prisma.userRole.deleteMany({ where: { userId: { in: users }, roleId } });
        await prisma.role.deleteMany({ where: { id: roleId, code: `${prefix}ROLE` } });
        await prisma.institution.deleteMany({ where: { id: institutionId, name: prefix } });
        await prisma.user.deleteMany({ where: { id: { in: users }, email: { startsWith: prefix } } });
        assert.equal(await prisma.user.count({ where: { email: { startsWith: prefix } } }), 0);
        assert.equal(await prisma.accountRecoveryLimit.count({ where: { emailHmac: { in: [...emails].map(email => crypto.emailHmac(email)) } } }), 0);
      } finally { await app.close(); }
    } else await app.close();
  }
});
