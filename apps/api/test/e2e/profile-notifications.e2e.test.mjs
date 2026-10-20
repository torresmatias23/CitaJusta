import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { loadApiEnvironment, getE2ePort } from './local-environment.mjs';
import { assertE2EFixtureDatabase } from '../../scripts/e2e-docker-environment.mjs';

test('RF-004 isolated PostgreSQL profile, preferences, outbox and concurrent suppression', { timeout: 180000 }, async t => {
  loadApiEnvironment();
  process.env.ACCOUNT_RECOVERY_ENABLED = 'true'; process.env.ACCOUNT_RECOVERY_WEB_ORIGIN = 'http://127.0.0.1:5173';
  process.env.ACCOUNT_RECOVERY_KEY_ID = 'profile-e2e'; process.env.ACCOUNT_RECOVERY_ENCRYPTION_KEY = randomBytes(32).toString('hex');
  process.env.ACCOUNT_RECOVERY_HMAC_KEY = randomBytes(32).toString('hex');
  process.env.RESEND_FROM = 'CitaJusta <fixture@example.test>'; process.env.RESEND_API_KEY = 're_offline_test_only';
  const [{ AppModule }, { configureApplication }, { PrismaService }, { NotificationsService }, { EmailDeliveryService },
    { AccountRecoveryCrypto }, { AccountRecoveryDeliveryService }, { isTransactionConflict }, { AuditService }] = await Promise.all([
    import('../../dist/app.module.js'), import('../../dist/app.configuration.js'), import('../../dist/database/prisma.service.js'),
    import('../../dist/notifications/notifications.service.js'), import('../../dist/notifications/email-delivery.service.js'),
    import('../../dist/auth/account-recovery.crypto.js'), import('../../dist/auth/account-recovery-delivery.service.js'), import('../../dist/database/transaction-conflict.js'), import('../../dist/audit/audit.service.js'),
  ]);
  const prefix = `rf004-${randomUUID()}-`, users = [], emails = [];
  const app = await NestFactory.create(AppModule, { logger: false });
  let prisma, base, crypto;
  const allEnabled = { appointmentEmailsEnabled: true, offerEmailsEnabled: true };
  const noneEnabled = { appointmentEmailsEnabled: false, offerEmailsEnabled: false };
  const sender = { send: t.mock.fn(async () => randomUUID()) };
  async function request(method, path, token, body) {
    const response = await fetch(`${base}${path}`, { method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const text = await response.text();
    try { return { status: response.status, body: JSON.parse(text) }; }
    catch {
      // The deliberately nonexistent /users/:id route has no DTO contract; assert its 404 below.
      if (response.status === 404) return { status: response.status, body: null };
      throw new Error(`Fixture received non-JSON HTTP ${response.status} for ${method} request`);
    }
  }
  async function register(name) {
    const credentials = { email: `${prefix}${name}@example.test`, password: `Profile-${randomUUID()}-Aa1!` }; emails.push(credentials.email);
    const result = await request('POST', '/auth/register', undefined, { ...credentials, firstName: 'Profile', lastName: 'Fixture' });
    assert.equal(result.status, 201); users.push(result.body.id);
    const pair = await request('POST', '/auth/login', undefined, credentials); assert.equal(pair.status, 200);
    return { id: result.body.id, token: pair.body.accessToken, credentials };
  }
  const preferences = (user, value) => request('PUT', '/users/me/notification-preferences', user.token, value);
  async function serializable(operation) {
    for (let attempt = 0; ; attempt++) {
      try { return await prisma.$transaction(operation, { isolationLevel: 'Serializable' }); }
      catch (error) { if (attempt >= 2 || !isTransactionConflict(error)) throw error; }
    }
  }
  function event(user, type) {
    const resourceId = randomUUID();
    return { recipientUserId: user.id, institutionId: null, branchId: null, type,
      resourceType: type.startsWith('APPOINTMENT') ? 'APPOINTMENT' : type.startsWith('OFFER') ? 'OFFER' : 'WAITLIST_ENTRY',
      resourceId, dedupeKey: `${type}:${resourceId}`,
      data: ['APPOINTMENT_BOOKED', 'APPOINTMENT_CANCELLED', 'OFFER_CREATED', 'OFFER_ACCEPTED'].includes(type)
        ? { startsAt: '2035-01-01T12:00:00.000Z', ...(type === 'OFFER_CREATED' ? { expiresAt: '2034-12-31T12:00:00.000Z' } : {}) } : {} };
  }
  const enqueue = async input => {
    await serializable(tx => NotificationsService.create(tx, input));
    return prisma.notification.findUniqueOrThrow({ where: { recipientUserId_dedupeKey: { recipientUserId: input.recipientUserId, dedupeKey: input.dedupeKey } }, include: { emailDelivery: true } });
  };
  try {
    configureApplication(app); await app.listen(getE2ePort(), '127.0.0.1'); prisma = app.get(PrismaService);
    await assertE2EFixtureDatabase(prisma); crypto = app.get(AccountRecoveryCrypto);
    base = `http://127.0.0.1:${app.getHttpServer().address().port}/api/v1`;
    const deliveryConfig = { get: key => app.get(ConfigService).get(key), getOrThrow: key => key === 'EMAIL_DELIVERY_ENABLED' ? true : app.get(ConfigService).getOrThrow(key) };
    const delivery = new EmailDeliveryService(prisma, deliveryConfig, sender);
    const user = await register('owner'), foreign = await register('other');

    await t.test('additive columns are nonnullable with true defaults and new accounts preserve identity', async () => {
      const columns = await prisma.$queryRaw`SELECT column_name, is_nullable, column_default FROM information_schema.columns WHERE table_name='usuarios' AND column_name IN ('emails_citas_habilitados','emails_ofertas_habilitados')`;
      assert.equal(columns.length, 2); assert.ok(columns.every(column => column.is_nullable === 'NO' && column.column_default === 'true'));
      const row = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      assert.equal(row.appointmentEmailsEnabled, true); assert.equal(row.offerEmailsEnabled, true); assert.equal(row.email, user.credentials.email);
    });
    await t.test('GET remains additive and PATCH returns controlled normalized personal fields', async () => {
      const me = await request('GET', '/users/me', user.token); assert.equal(me.status, 200); assert.equal(me.body.data.phone, null);
      assert.deepEqual(me.body.data.notificationPreferences, allEnabled);
      for (const field of ['id', 'email', 'firstName', 'lastName', 'status', 'context', 'roles', 'permissions']) assert.ok(field in me.body.data);
      const updated = await request('PATCH', '/users/me', user.token, { firstName: ' Nueva ', lastName: ' Persona ', phone: ' 123 (45) ' });
      assert.equal(updated.status, 200); assert.deepEqual(updated.body, { data: { firstName: 'Nueva', lastName: 'Persona', phone: '123 (45)' } });
      const removed = await request('PATCH', '/users/me', user.token, { phone: null }); assert.equal(removed.body.data.phone, null);
      assert.equal((await request('GET', '/users/me', foreign.token)).body.data.firstName, 'Profile');
    });
    await t.test('auth, IDOR, protected fields and unexpected query are rejected without leaking other identities', async () => {
      assert.equal((await request('PATCH', '/users/me', undefined, { phone: null })).status, 401);
      assert.equal((await request('PUT', '/users/me/notification-preferences', undefined, allEnabled)).status, 401);
      for (const body of [{}, { userId: foreign.id }, { email: foreign.credentials.email }, { firstName: 'ok', roles: ['GLOBAL'] }, { phone: 'x'.repeat(31) }])
        assert.equal((await request('PATCH', '/users/me', user.token, body)).status, 400);
      assert.equal((await request('PATCH', `/users/me?userId=${foreign.id}`, user.token, { phone: null })).status, 400);
      assert.equal((await request('PATCH', `/users/${foreign.id}`, user.token, { firstName: 'Wrong' })).status, 404);
      assert.equal((await preferences(user, { ...allEnabled, userId: foreign.id })).status, 400);
      assert.equal((await preferences(user, { appointmentEmailsEnabled: true })).status, 400);
    });
    await t.test('preferences persist independently between sessions and internal events are never filtered', async () => {
      const chosen = { appointmentEmailsEnabled: false, offerEmailsEnabled: true };
      assert.deepEqual((await preferences(user, chosen)).body, { data: chosen });
      const pair = await request('POST', '/auth/login', undefined, user.credentials); assert.equal(pair.status, 200);
      assert.deepEqual((await request('GET', '/users/me', pair.body.accessToken)).body.data.notificationPreferences, chosen);
      const disabled = await enqueue(event(user, 'APPOINTMENT_BOOKED')), enabled = await enqueue(event(user, 'OFFER_CREATED'));
      assert.equal(disabled.emailDelivery.status, 'FAILED'); assert.equal(disabled.emailDelivery.lastErrorCode, 'EMAIL_PREFERENCE_DISABLED');
      assert.equal(enabled.emailDelivery.status, 'PENDING');
      const internal = (await request('GET', '/notifications/me', user.token)).body.data;
      assert.ok(internal.some(row => row.id === disabled.id)); assert.ok(internal.some(row => row.id === enabled.id));
      const waiting = await enqueue(event(user, 'WAITLIST_ENTERED')); assert.equal(waiting.emailDelivery, null);
      assert.equal((await preferences(user, { appointmentEmailsEnabled: true, offerEmailsEnabled: false })).status, 200);
      assert.equal((await enqueue(event(user, 'APPOINTMENT_CANCELLED'))).emailDelivery.status, 'PENDING');
      for (const type of ['OFFER_CREATED', 'OFFER_ACCEPTED', 'OFFER_REJECTED', 'OFFER_EXPIRED'])
        assert.equal((await enqueue(event(user, type))).emailDelivery.lastErrorCode, 'EMAIL_PREFERENCE_DISABLED');
    });
    await t.test('disabling retires PENDING and PROCESSING payloads and claims but preserves SENT, audit and foreign deliveries', async () => {
      assert.equal((await preferences(user, allEnabled)).status, 200);
      const pending = await enqueue(event(user, 'APPOINTMENT_BOOKED')), claimed = await enqueue(event(user, 'OFFER_CREATED'));
      const sent = await enqueue(event(user, 'OFFER_ACCEPTED')), other = await enqueue(event(foreign, 'OFFER_CREATED'));
      await prisma.notificationEmailDelivery.update({ where: { id: claimed.emailDelivery.id }, data: { status: 'PROCESSING', claimToken: randomUUID(), lockedUntil: new Date(Date.now() + 60000), payload: { to: ['private@example.test'] } } });
      await delivery.deliver(sent.emailDelivery.id); assert.equal((await prisma.notificationEmailDelivery.findUniqueOrThrow({ where: { id: sent.emailDelivery.id } })).status, 'SENT');
      assert.equal((await preferences(user, noneEnabled)).status, 200);
      for (const id of [pending.emailDelivery.id, claimed.emailDelivery.id]) {
        const row = await prisma.notificationEmailDelivery.findUniqueOrThrow({ where: { id } });
        assert.equal(row.status, 'FAILED'); assert.equal(row.lastErrorCode, 'EMAIL_PREFERENCE_DISABLED');
        assert.equal(row.payload, null); assert.equal(row.claimToken, null); assert.equal(row.lockedUntil, null);
      }
      assert.equal((await prisma.notificationEmailDelivery.findUniqueOrThrow({ where: { id: sent.emailDelivery.id } })).status, 'SENT');
      assert.equal((await prisma.notificationEmailDelivery.findUniqueOrThrow({ where: { id: other.emailDelivery.id } })).status, 'PENDING');
    });
    await t.test('reactivation/replayed event never resurrects tombstones; only a new event sends', async () => {
      const input = event(user, 'APPOINTMENT_BOOKED'), original = await enqueue(input);
      assert.equal(original.emailDelivery.status, 'FAILED'); assert.equal((await preferences(user, allEnabled)).status, 200);
      const replay = await enqueue(input); assert.equal(replay.id, original.id); assert.equal(replay.emailDelivery.status, 'FAILED');
      const before = sender.send.mock.callCount(); await delivery.deliver(replay.emailDelivery.id); assert.equal(sender.send.mock.callCount(), before);
      const fresh = await enqueue(event(user, 'APPOINTMENT_BOOKED')); await delivery.deliver(fresh.emailDelivery.id);
      assert.equal(sender.send.mock.callCount(), before + 1);
    });
    await t.test('concurrent producer and disable settle without any unsuppressed owned delivery', async () => {
      for (let attempt = 0; attempt < 3; attempt++) {
        assert.equal((await preferences(user, allEnabled)).status, 200);
        const input = event(user, 'OFFER_CREATED');
        const [, disabled] = await Promise.all([enqueue(input), preferences(user, noneEnabled)]); assert.equal(disabled.status, 200);
        const row = await prisma.notificationEmailDelivery.findFirstOrThrow({ where: { notification: { recipientUserId: user.id, dedupeKey: input.dedupeKey } } });
        assert.equal(row.status, 'FAILED'); assert.equal(row.lastErrorCode, 'EMAIL_PREFERENCE_DISABLED');
        assert.equal(await prisma.notification.count({ where: { recipientUserId: user.id, dedupeKey: input.dedupeKey } }), 1);
      }
    });
    await t.test('worker paused after claim cannot send after disabling clears ownership', async () => {
      await preferences(user, allEnabled); const input = await enqueue(event(user, 'APPOINTMENT_BOOKED'));
      const read = prisma.notificationEmailDelivery.findUniqueOrThrow.bind(prisma.notificationEmailDelivery);
      let release, reached;
      const blocked = new Promise(resolve => { release = resolve; }), checkpoint = new Promise(resolve => { reached = resolve; });
      // A barrier delegates to the real Prisma client; its dynamic proxy is not a mockable own method.
      const controlled = new EmailDeliveryService({ notificationEmailDelivery: {
        updateMany: args => prisma.notificationEmailDelivery.updateMany(args),
        findUniqueOrThrow: async args => {
          const snapshot = await read(args);
          if (args.where.id === input.emailDelivery.id && args.include) { reached(); await blocked; }
          return snapshot;
        },
      }, institution: prisma.institution }, deliveryConfig, sender);
      const before = sender.send.mock.callCount(), work = controlled.deliver(input.emailDelivery.id);
      try { await checkpoint; assert.equal((await preferences(user, noneEnabled)).status, 200); }
      finally { release(); await work; }
      assert.equal(sender.send.mock.callCount(), before);
      const row = await read({ where: { id: input.emailDelivery.id } }); assert.equal(row.status, 'FAILED'); assert.equal(row.payload, null);
    });
    await t.test('audit insert failure rolls preference write and suppression back atomically', async () => {
      await preferences(user, allEnabled); const queued = await enqueue(event(user, 'OFFER_CREATED'));
      const spy = t.mock.method(AuditService, 'record', async () => { throw new TypeError('controlled audit failure'); });
      try { assert.equal((await preferences(user, noneEnabled)).status, 500); }
      finally { spy.mock.restore(); }
      assert.deepEqual((await request('GET', '/users/me', user.token)).body.data.notificationPreferences, allEnabled);
      assert.equal((await prisma.notificationEmailDelivery.findUniqueOrThrow({ where: { id: queued.emailDelivery.id } })).status, 'PENDING');
    });
    await t.test('effective changes audit only codes/IDs; identical update is a no-op audit', async () => {
      const where = { actorUserId: user.id, actionCode: 'ACCOUNT_EMAIL_PREFERENCES_UPDATED' };
      const before = await prisma.auditEvent.count({ where }); await preferences(user, allEnabled);
      assert.equal(await prisma.auditEvent.count({ where }), before);
      const rows = await prisma.auditEvent.findMany({ where: { actorUserId: user.id, actionCode: { in: ['ACCOUNT_PROFILE_UPDATED', 'ACCOUNT_EMAIL_PREFERENCES_UPDATED'] } } });
      assert.ok(rows.some(row => row.actionCode === 'ACCOUNT_PROFILE_UPDATED'));
      assert.doesNotMatch(JSON.stringify(rows), /Nueva|Persona|123 \(45\)|password|phone|firstName/);
      assert.ok(!JSON.stringify(rows).includes(user.credentials.email));
    });
    await t.test('disabled notification categories do not suppress independent password recovery', async () => {
      await preferences(user, noneEnabled);
      const response = await request('POST', '/auth/forgot-password', undefined, { email: user.credentials.email }); assert.equal(response.status, 202);
      const row = await prisma.accountRecovery.findFirstOrThrow({ where: { userId: user.id } });
      const before = sender.send.mock.callCount(); await new AccountRecoveryDeliveryService(prisma, deliveryConfig, crypto, sender).deliver(row.id);
      assert.equal(sender.send.mock.callCount(), before + 1);
      assert.equal((await prisma.accountRecovery.findUniqueOrThrow({ where: { id: row.id } })).ciphertext, null);
    });
    await t.test('deactivated and soft-deleted users cannot update either endpoint', async () => {
      const blocked = await register('inactive');
      await prisma.user.update({ where: { id: blocked.id }, data: { status: 'INACTIVE' } });
      assert.equal((await preferences(blocked, allEnabled)).status, 401);
      await prisma.user.update({ where: { id: blocked.id }, data: { status: 'ACTIVE', deletedAt: new Date() } });
      assert.equal((await request('PATCH', '/users/me', blocked.token, { firstName: 'Invalid' })).status, 401);
    });
  } finally {
    if (prisma) {
      try {
        await assertE2EFixtureDatabase(prisma);
        const own = await prisma.user.findMany({ where: { id: { in: users } }, select: { id: true, email: true } });
        assert.ok(own.every(user => emails.includes(user.email) && user.email.startsWith(prefix)));
        const ids = own.map(user => user.id);
        await prisma.notification.deleteMany({ where: { recipientUserId: { in: ids } } });
        await prisma.accountRecovery.deleteMany({ where: { userId: { in: ids } } });
        await prisma.accountRecoveryLimit.deleteMany({ where: { emailHmac: { in: emails.map(email => crypto.emailHmac(email)) } } });
        const auditScope = { OR: [{ actorUserId: { in: ids } }, { resourceId: { in: ids }, actionCode: 'ACCOUNT_RECOVERY_REQUESTED' }] };
        await prisma.auditEvent.deleteMany({ where: auditScope });
        await prisma.authSession.deleteMany({ where: { userId: { in: ids } } });
        await prisma.user.deleteMany({ where: { id: { in: ids }, email: { startsWith: prefix } } });
        assert.equal(await prisma.user.count({ where: { email: { startsWith: prefix } } }), 0);
        assert.equal(await prisma.notification.count({ where: { recipientUserId: { in: ids } } }), 0);
        assert.equal(await prisma.auditEvent.count({ where: auditScope }), 0);
        assert.equal(await prisma.accountRecoveryLimit.count({ where: { emailHmac: { in: emails.map(email => crypto.emailHmac(email)) } } }), 0);
      } finally { await app.close(); }
    } else await app.close();
  }
});
