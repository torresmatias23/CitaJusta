import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { NestFactory } from '@nestjs/core';
import { loadApiEnvironment, assertSafeLocalDatabaseUrl, getE2ePort } from './local-environment.mjs';
import { FIXTURE_EMAIL_PREFIX, ids, createNotificationsFixtures, cleanupNotificationsFixtures, assertNotificationsClean } from './notifications.fixture.mjs';

test('HU-039 PostgreSQL outbox and real booking; never calls an external provider', { timeout: 120000 }, async (t) => {
  loadApiEnvironment(); assertSafeLocalDatabaseUrl(process.env.DATABASE_URL); process.env.NODE_ENV = 'test';
  const [{ AppModule }, { configureApplication }, { PrismaService }, { NotificationsService },
    { EmailDeliveryService }, { EmailProviderError }, { bootstrapAppointmentStatus }] = await Promise.all([
    import('../../dist/app.module.js'), import('../../dist/app.configuration.js'), import('../../dist/database/prisma.service.js'),
    import('../../dist/notifications/notifications.service.js'), import('../../dist/notifications/email-delivery.service.js'),
    import('../../dist/notifications/resend.client.js'), import('../../dist/database/appointment-status.bootstrap.js'),
  ]);
  const app = await NestFactory.create(AppModule, { logger: false });
  let prisma; const statusIds = [], deliveryIds = [];
  try {
    configureApplication(app); await app.listen(getE2ePort(), '127.0.0.1'); prisma = app.get(PrismaService);
    const base = `http://127.0.0.1:${app.getHttpServer().address().port}/api/v1`;
    async function request(method, path, token, body) {
      const response = await fetch(`${base}${path}`, { method,
        headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
      return { status: response.status, body: await response.json() };
    }
    const credentials = { email: `${FIXTURE_EMAIL_PREFIX}${randomUUID()}@example.com`, password: `Test-${randomUUID()}-Aa1!` };
    const registered = await request('POST', '/auth/register', undefined, { ...credentials, firstName: 'Email', lastName: 'Fixture' });
    assert.equal(registered.status, 201); const userId = registered.body.id;
    const login = await request('POST', '/auth/login', undefined, credentials); assert.equal(login.status, 200);
    const token = login.body.accessToken;
    const second = await request('POST', '/auth/register', undefined, {
      email: `${FIXTURE_EMAIL_PREFIX}${randomUUID()}@example.com`, password: `Test-${randomUUID()}-Aa1!`,
      firstName: 'Second', lastName: 'Fixture',
    });
    assert.equal(second.status, 201);
    await createNotificationsFixtures(prisma, userId, second.body.id);
    const before = await prisma.appointmentStatus.findMany({ select: { id: true } }); await bootstrapAppointmentStatus(prisma);
    statusIds.push(...(await prisma.appointmentStatus.findMany({ select: { id: true } })).filter((row) => !before.some((old) => old.id === row.id)).map((row) => row.id));
    const values = { EMAIL_DELIVERY_ENABLED: true, EMAIL_DELIVERY_BATCH_SIZE: 10, EMAIL_DELIVERY_LEASE_MS: 60000,
      EMAIL_DELIVERY_MAX_ATTEMPTS: 5, EMAIL_DELIVERY_REQUEST_TIMEOUT_MS: 100, RESEND_API_KEY: 're_e2e_fake_not_a_real_key', RESEND_FROM: 'CitaJusta <test@example.test>' };
    const config = { get: (key) => values[key], getOrThrow: (key) => { assert.notEqual(values[key], undefined); return values[key]; } };
    // Target only test-owned IDs. A global batch must never mark existing local deliveries SENT with a fake adapter.
    const worker = (send) => new EmailDeliveryService(prisma, config, { send });
    let counter = 0;
    async function createEvent(type = 'OFFER_REJECTED') {
      const id = randomUUID();
      const input = { recipientUserId: userId, institutionId: ids.institutionA, branchId: ids.branchA1, type,
        resourceType: type.startsWith('WAITLIST') ? 'WAITLIST_ENTRY' : 'OFFER', resourceId: id, dedupeKey: `${type}:${id}`, data: {} };
      await prisma.$transaction((tx) => NotificationsService.create(tx, input));
      const row = await prisma.notification.findUniqueOrThrow({ where: { recipientUserId_dedupeKey: { recipientUserId: userId, dedupeKey: input.dedupeKey } }, include: { emailDelivery: true } });
      if (row.emailDelivery) deliveryIds.push(row.emailDelivery.id);
      return { input, row, id: row.emailDelivery?.id };
    }
    async function newSlot() {
      const startsAt = new Date(Date.now() + 86400000 * 7 + (++counter) * 3600000);
      return prisma.agendaSlot.create({ data: { id: randomUUID(), availabilityId: ids.availabilityMain, startsAt, endsAt: new Date(+startsAt + 1800000), status: 'AVAILABLE' } });
    }
    let booked;
    await t.test('real booking commits appointment, notification and exactly one PENDING delivery', async () => {
      const result = await request('POST', '/appointments', token, { agendaSlotId: ids.slotAvailable });
      assert.equal(result.status, 201);
      booked = await prisma.notification.findUniqueOrThrow({ where: { recipientUserId_dedupeKey: { recipientUserId: userId, dedupeKey: `APPOINTMENT_BOOKED:${result.body.data.id}` } }, include: { emailDelivery: true } });
      deliveryIds.push(booked.emailDelivery.id);
      assert.equal(booked.emailDelivery.status, 'PENDING'); assert.equal(booked.emailDelivery.attemptCount, 0); assert.equal(booked.emailDelivery.payload, null);
      assert.equal(await prisma.notificationEmailDelivery.count({ where: { notificationId: booked.id } }), 1);
    });
    await t.test('failure after outbox INSERT rolls back the real domain transaction including slot/history', async () => {
      const slot = await newSlot(), original = NotificationsService.create;
      const notificationCount = await prisma.notification.count({ where: { recipientUserId: userId } });
      const deliveryCount = await prisma.notificationEmailDelivery.count({ where: { notification: { recipientUserId: userId } } });
      let inserted = false;
      const patched = t.mock.method(NotificationsService, 'create', async (tx, input) => {
        await original(tx, input);
        inserted = (await tx.notificationEmailDelivery.count({ where: { notification: { resourceId: input.resourceId } } })) === 1;
        throw new Error('Controlled rollback after outbox');
      });
      try {
        const result = await request('POST', '/appointments', token, { agendaSlotId: slot.id });
        assert.equal(result.status, 500); assert.equal(inserted, true);
      } finally { patched.mock.restore(); }
      assert.equal(await prisma.appointment.count({ where: { agendaSlotId: slot.id } }), 0);
      assert.equal((await prisma.agendaSlot.findUniqueOrThrow({ where: { id: slot.id } })).status, 'AVAILABLE');
      assert.equal(await prisma.notification.count({ where: { recipientUserId: userId } }), notificationCount);
      assert.equal(await prisma.notificationEmailDelivery.count({ where: { notification: { recipientUserId: userId } } }), deliveryCount);
    });
    await t.test('concurrent domain replays dedupe notifications and deliveries; waitlist events stay internal', async () => {
      const event = await createEvent();
      await Promise.all(Array.from({ length: 3 }, () => prisma.$transaction((tx) => NotificationsService.create(tx, event.input))));
      assert.equal(await prisma.notification.count({ where: { recipientUserId: userId, dedupeKey: event.input.dedupeKey } }), 1);
      assert.equal(await prisma.notificationEmailDelivery.count({ where: { notificationId: event.row.id } }), 1);
      for (const type of ['WAITLIST_ENTERED', 'WAITLIST_WITHDRAWN']) assert.equal((await createEvent(type)).row.emailDelivery, null);
    });
    await t.test('two PostgreSQL workers claim once, persist SENT and never resend terminal deliveries', async () => {
      let sends = 0;
      const send = async (_id, payload) => { sends++; assert.match(payload.text, /America\/Santiago/); await new Promise((resolve) => setTimeout(resolve, 30)); return randomUUID(); };
      await Promise.all([worker(send).deliver(booked.emailDelivery.id), worker(send).deliver(booked.emailDelivery.id)]);
      await worker(send).deliver(booked.emailDelivery.id);
      const row = await prisma.notificationEmailDelivery.findUniqueOrThrow({ where: { id: booked.emailDelivery.id } });
      assert.equal(sends, 1); assert.equal(row.status, 'SENT'); assert.equal(row.attemptCount, 1); assert.ok(row.sentAt && row.providerMessageId);
      assert.deepEqual(Object.keys(row.payload).sort(), ['from', 'subject', 'text', 'to']);
      assert.doesNotMatch(JSON.stringify(row), /re_e2e|passwordHash|Authorization|accessToken|refreshToken/);
    });
    await t.test('retryable failure persists attempt/backoff and retries identical frozen payload', async () => {
      const event = await createEvent(); let payload;
      await worker(async (_id, value) => { payload = value; throw new EmailProviderError('RESEND_HTTP_429', true); }).deliver(event.id);
      let row = await prisma.notificationEmailDelivery.findUniqueOrThrow({ where: { id: event.id } });
      assert.equal(row.status, 'PENDING'); assert.equal(row.attemptCount, 1); assert.ok(row.nextAttemptAt > row.lastAttemptAt); assert.equal(row.lockedUntil, null);
      await prisma.notificationEmailDelivery.update({ where: { id: event.id }, data: { nextAttemptAt: new Date(0) } });
      await worker(async (_id, value) => { assert.deepEqual(value, payload); return randomUUID(); }).deliver(event.id);
      row = await prisma.notificationEmailDelivery.findUniqueOrThrow({ where: { id: event.id } }); assert.equal(row.status, 'SENT'); assert.equal(row.attemptCount, 2);
    });
    await t.test('permanent failures are terminal and store only sanitized codes', async () => {
      const event = await createEvent(); let sends = 0;
      const service = worker(async () => { sends++; throw new EmailProviderError('RESEND_HTTP_422', false); });
      await service.deliver(event.id); await service.deliver(event.id);
      const row = await prisma.notificationEmailDelivery.findUniqueOrThrow({ where: { id: event.id } });
      assert.equal(row.status, 'FAILED'); assert.equal(row.lastErrorCode, 'RESEND_HTTP_422'); assert.equal(sends, 1);
    });
    await t.test('crashed worker lease recovers and a stale owner cannot write completion', async () => {
      const event = await createEvent();
      await prisma.notificationEmailDelivery.update({ where: { id: event.id }, data: { status: 'PROCESSING', lockedUntil: new Date(0), claimToken: randomUUID(), attemptCount: 1 } });
      let sends = 0; await worker(async () => { sends++; return randomUUID(); }).deliver(event.id);
      assert.equal(sends, 1); assert.equal((await prisma.notificationEmailDelivery.findUniqueOrThrow({ where: { id: event.id } })).attemptCount, 2);
      const second = await createEvent();
      await worker(async () => {
        await prisma.notificationEmailDelivery.update({ where: { id: second.id }, data: { claimToken: randomUUID() } });
        return randomUUID();
      }).deliver(second.id);
      const stale = await prisma.notificationEmailDelivery.findUniqueOrThrow({ where: { id: second.id } });
      assert.equal(stale.status, 'PROCESSING'); assert.equal(stale.sentAt, null); assert.equal(stale.providerMessageId, null);
    });
    await t.test('HU-024 list/read/count contract and recipient isolation remain independent of email delivery', async () => {
      const list = await request('GET', '/notifications/me', token);
      assert.equal(list.status, 200); const publicRow = list.body.data.find((row) => row.id === booked.id);
      assert.ok(publicRow); assert.doesNotMatch(JSON.stringify(publicRow), /emailDelivery|providerMessageId|claimToken|payload|recipientUserId/);
      const read = await request('POST', `/notifications/${booked.id}/read`, token); assert.equal(read.status, 200);
      assert.equal((await prisma.notificationEmailDelivery.findUniqueOrThrow({ where: { id: booked.emailDelivery.id } })).status, 'SENT');
      assert.equal((await request('GET', '/notifications/me')).status, 401);
    });
  } finally {
    if (prisma) {
      await cleanupNotificationsFixtures(prisma);
      assert.equal(await prisma.notificationEmailDelivery.count({ where: { id: { in: deliveryIds } } }), 0);
      await prisma.appointmentStatus.deleteMany({ where: { id: { in: statusIds } } });
      await assertNotificationsClean(prisma);
    }
    await app.close();
  }
});
