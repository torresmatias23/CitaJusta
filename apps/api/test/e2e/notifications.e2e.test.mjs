import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test, mock } from 'node:test';
import { NestFactory } from '@nestjs/core';
import { loadApiEnvironment, assertSafeLocalDatabaseUrl, getE2ePort } from './local-environment.mjs';
import { FIXTURE_EMAIL_PREFIX, ids, createNotificationsFixtures, cleanupNotificationsFixtures, assertNotificationsClean } from './notifications.fixture.mjs';

test('HU-024 real domain events, atomicity, dedupe, recipient isolation and read API', { timeout: 120_000 }, async (t) => {
  loadApiEnvironment(); assertSafeLocalDatabaseUrl(process.env.DATABASE_URL); process.env.NODE_ENV = 'test';
  const [{ AppModule }, { configureApplication }, { PrismaService }, { NotificationsService }, { ReassignmentsService }, { bootstrapAppointmentStatus }, { bootstrapWaitlist }] = await Promise.all([
    import('../../dist/app.module.js'), import('../../dist/app.configuration.js'), import('../../dist/database/prisma.service.js'),
    import('../../dist/notifications/notifications.service.js'), import('../../dist/reassignments/reassignments.service.js'),
    import('../../dist/database/appointment-status.bootstrap.js'), import('../../dist/database/waitlist.bootstrap.js'),
  ]);
  const app = await NestFactory.create(AppModule, { logger: false });
  let prisma; const users = [], permissions = [], appointmentStatusIds = [], waitlistStatusIds = [];
  try {
    configureApplication(app); await app.listen(getE2ePort(), '127.0.0.1'); prisma = app.get(PrismaService);
    const base = `http://127.0.0.1:${app.getHttpServer().address().port}/api/v1`;
    async function request(method, path, token, body, headers = {}) {
      const response = await fetch(`${base}${path}`, { method, headers: { ...headers,
        ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
      const text = await response.text(); return { status: response.status, body: text ? JSON.parse(text) : null };
    }
    async function register() {
      const credentials = { email: `${FIXTURE_EMAIL_PREFIX}${randomUUID()}@example.com`, password: `Test-${randomUUID()}-Aa1!` };
      const registered = await request('POST', '/auth/register', undefined, { ...credentials, firstName: 'Notifications', lastName: 'Fixture' });
      assert.equal(registered.status, 201); users.push(registered.body.id);
      const login = await request('POST', '/auth/login', undefined, credentials); assert.equal(login.status, 200);
      return { id: registered.body.id, token: login.body.accessToken, credentials };
    }
    const admin = await register(), source = await register(), foreign = await register();
    await createNotificationsFixtures(prisma, admin.id, source.id);
    let permission = await prisma.permission.findUnique({ where: { code: 'reassignments.generate' } });
    if (!permission) { permission = await prisma.permission.create({ data: { id: randomUUID(), code: 'reassignments.generate', module: 'reassignments', action: 'generate' } }); permissions.push(permission.id); }
    await prisma.rolePermission.create({ data: { roleId: ids.roleInstitution, permissionId: permission.id } });
    const oldStatus = await prisma.appointmentStatus.findMany({ select: { id: true } }); await bootstrapAppointmentStatus(prisma);
    appointmentStatusIds.push(...(await prisma.appointmentStatus.findMany({ select: { id: true } })).filter((row) => !oldStatus.some((old) => old.id === row.id)).map((row) => row.id));
    const oldWaitlist = await prisma.waitlistStatus.findMany({ select: { id: true } }); await bootstrapWaitlist(prisma, ids.institutionA);
    waitlistStatusIds.push(...(await prisma.waitlistStatus.findMany({ select: { id: true } })).filter((row) => !oldWaitlist.some((old) => old.id === row.id)).map((row) => row.id));
    const headers = { 'x-institution-id': ids.institutionA };
    const write = (path, user = source, body) => request('POST', path, user.token, body, headers);
    const get = (query = {}, user = source, scope = {}) => request('GET', `/notifications/me?${new URLSearchParams(query)}`, user?.token, undefined, scope);
    const rows = (type, resourceId) => prisma.notification.findMany({ where: { type, resourceId } });
    let offset = 0;
    async function newSlot() {
      const initial = await prisma.agendaSlot.findUniqueOrThrow({ where: { id: ids.slotAvailable } });
      const startsAt = new Date(+initial.startsAt + (++offset) * 3_600_000);
      return prisma.agendaSlot.create({ data: { id: randomUUID(), availabilityId: ids.availabilityMain,
        startsAt, endsAt: new Date(+startsAt + 1_800_000), status: 'AVAILABLE' } });
    }
    async function book() {
      const slot = await newSlot(); const result = await write('/appointments', source, { agendaSlotId: slot.id });
      assert.equal(result.status, 201, JSON.stringify(result.body)); return { slotId: slot.id, appointmentId: result.body.data.id };
    }
    async function enter(user) {
      const body = { serviceId: ids.serviceA, branchId: ids.branchA1 };
      const result = await write('/waitlist', user, body); assert.equal(result.status, 201); user.entryId = result.body.data.id;
      const again = await write('/waitlist', user, body); assert.equal(again.status, 409);
      assert.equal((await rows('WAITLIST_ENTERED', user.entryId)).length, 1);
      const preferences = { preferredDays: [1,2,3,4,5,6,7], timeRanges: [{ start: '00:00', end: '23:59' }],
        preferredBranchIds: [], allowsOtherBranches: false, acceptsAnyProfessional: true };
      assert.equal((await request('PUT', `/waitlist/${user.entryId}/preferences`, user.token, preferences, headers)).status, 200);
    }

    await t.test('auth, strict query/limit/cursor and nonfunctional read body', async () => {
      assert.equal((await get({}, null)).status, 401);
      assert.equal((await request('GET', '/notifications/me/unread-count')).status, 401);
      assert.equal((await request('POST', `/notifications/${randomUUID()}/read`)).status, 401);
      for (const query of [{ limit: '101' }, { limit: '0' }, { limit: '1.5' }, { userId: foreign.id }, { institutionId: ids.institutionA },
        { recipientUserId: foreign.id }, { offset: '0' }, { cursor: 'bad' }, { cursor: '' }]) assert.equal((await get(query)).status, 400);
      assert.equal((await request('GET', '/notifications/me/unread-count?limit=1', source.token)).status, 400);
      assert.equal((await write(`/notifications/${randomUUID()}/read`, source, { recipientUserId: foreign.id })).status, 400);
      assert.equal((await write('/notifications/bad/read')).status, 400);
      assert.equal((await write(`/notifications/${randomUUID()}/read?readAt=now`)).status, 400);
    });
    await t.test('recipient-only listing across institutions, 50/100 limits and tie cursor without gaps; public DTO', async () => {
      const at = new Date('2050-01-15T12:00:00.123Z');
      const generated = Array.from({ length: 105 }, (_, index) => {
        const resourceId = randomUUID(); return { id: randomUUID(), recipientUserId: source.id, type: 'WAITLIST_ENTERED',
          institutionId: index % 2 ? ids.institutionA : ids.institutionB, branchId: null, resourceType: 'WAITLIST_ENTRY', resourceId,
          dedupeKey: `WAITLIST_ENTERED:${resourceId}`, data: {}, createdAt: at };
      });
      const other = { ...generated[0], id: randomUUID(), recipientUserId: foreign.id };
      await prisma.notification.createMany({ data: [...generated, other] });
      const first = (await get()).body; assert.equal(first.data.length, 50); assert.equal(first.unreadCount, 105);
      assert.equal((await get({ limit: '100' })).body.data.length, 100);
      const second = (await get({ cursor: first.page.nextCursor })).body;
      const third = (await get({ cursor: second.page.nextCursor })).body;
      assert.equal(third.page.nextCursor, null);
      assert.deepEqual([...first.data, ...second.data, ...third.data].map((row) => row.id), generated.map((row) => row.id).sort().reverse());
      assert.deepEqual((await get({}, source, { 'x-institution-id': ids.institutionB, 'x-branch-id': ids.branchB1, 'x-user-id': foreign.id })).body, first);
      assert.deepEqual((await get({}, foreign)).body.data.map((row) => row.id), [other.id]);
      for (const row of first.data) assert.deepEqual(Object.keys(row).sort(), ['id','type','resourceType','resourceId','title','message','path','createdAt','readAt'].sort());
      for (const privateValue of [source.id, source.credentials.email, source.token, 'dedupeKey', 'recipientUserId', 'institutionId', 'ranking', 'candidates']) assert.ok(!JSON.stringify(first).includes(privateValue));
      const count = await request('GET', '/notifications/me/unread-count', source.token); assert.deepEqual(count.body, { data: { unreadCount: 105 } });

      const id = first.data[0].id;
      const read = await Promise.all(Array.from({ length: 4 }, () => write(`/notifications/${id}/read`)));
      for (const result of read) { assert.equal(result.status, 200); assert.ok(result.body.data.readAt); assert.deepEqual(result.body, read[0].body); }
      assert.deepEqual((await write(`/notifications/${id}/read`)).body, read[0].body);
      assert.equal((await get()).body.unreadCount, 104);
      assert.equal((await request('GET', '/notifications/me/unread-count', source.token)).body.data.unreadCount, 104);
      const denied = await write(`/notifications/${other.id}/read`), absent = await write(`/notifications/${randomUUID()}/read`);
      assert.equal(denied.status, 404); assert.deepEqual(denied, absent);
      assert.equal((await prisma.notification.findUniqueOrThrow({ where: { id: other.id } })).readAt, null);
      await prisma.notification.deleteMany({ where: { id: { in: [...generated.map((row) => row.id), other.id] } } });
    });
    await t.test('real PostgreSQL notification FK failure rolls back reservation, slot, history and audit', async () => {
      const slot = await newSlot(), original = NotificationsService.create; let storageCode;
      const spy = mock.method(NotificationsService, 'create', async (tx, input) => {
        try { await original(tx, { ...input, recipientUserId: randomUUID() }); }
        catch (error) { storageCode = error.code; throw error; }
      });
      const before = await prisma.auditEvent.count({ where: { institutionId: ids.institutionA } });
      try { assert.equal((await write('/appointments', source, { agendaSlotId: slot.id })).status, 409); assert.equal(storageCode, 'P2003'); }
      finally { spy.mock.restore(); }
      assert.equal(await prisma.appointment.count({ where: { agendaSlotId: slot.id } }), 0);
      assert.deepEqual(await prisma.agendaSlot.findUniqueOrThrow({ where: { id: slot.id } }), slot);
      assert.equal(await prisma.notification.count({ where: { recipientUserId: source.id } }), 0);
      assert.equal(await prisma.auditEvent.count({ where: { institutionId: ids.institutionA } }), before);
    });
    let booking, acceptor, rejector;
    await t.test('booking, entry, cancellation, initial/next offers, acceptance and rejection generate once under replay', async () => {
      const recipients = [await register(), await register()]; for (const user of recipients) await enter(user);
      booking = await book();
      assert.equal((await rows('APPOINTMENT_BOOKED', booking.appointmentId)).length, 1);
      for (let i = 0; i < 2; i++) assert.equal((await write(`/appointments/${booking.appointmentId}/cancel`)).status, 200);
      const generated = await write(`/reassignments/${booking.slotId}/offers`, admin); assert.equal(generated.status, 201);
      const replay = await write(`/reassignments/${booking.slotId}/offers`, admin); assert.equal(replay.status, 409);
      const pending = await prisma.appointmentOffer.findFirstOrThrow({ where: { reassignmentId: generated.body.data.id, status: 'PENDING' }, include: { candidate: true } });
      rejector = recipients.find((user) => user.id === pending.candidate.userId);
      for (let i = 0; i < 2; i++) assert.equal((await write(`/reassignments/offers/${pending.id}/reject`, rejector)).status, 200);
      const next = await prisma.appointmentOffer.findFirstOrThrow({ where: { reassignmentId: generated.body.data.id, status: 'PENDING' }, include: { candidate: true } });
      acceptor = recipients.find((user) => user.id === next.candidate.userId);
      for (let i = 0; i < 2; i++) assert.equal((await write(`/reassignments/offers/${next.id}/accept`, acceptor)).status, 200);
      for (const [type, resourceId, recipientId] of [['APPOINTMENT_CANCELLED', booking.appointmentId, source.id],
        ['OFFER_CREATED', pending.id, rejector.id], ['OFFER_CREATED', next.id, acceptor.id], ['OFFER_REJECTED', pending.id, rejector.id], ['OFFER_ACCEPTED', next.id, acceptor.id]]) {
        const emitted = await rows(type, resourceId); assert.equal(emitted.length, 1, type); assert.equal(emitted[0].recipientUserId, recipientId);
      }
    });
    await t.test('two real cancellations of one reassigned appointment have distinct cancellation event keys', async () => {
      assert.equal((await write(`/appointments/${booking.appointmentId}/cancel`, acceptor)).status, 200);
      const cancellations = await prisma.cancellation.findMany({ where: { appointmentId: booking.appointmentId } });
      assert.equal(cancellations.length, 2);
      const emitted = await rows('APPOINTMENT_CANCELLED', booking.appointmentId); assert.equal(emitted.length, 2);
      assert.deepEqual(emitted.map((row) => row.dedupeKey).sort(), cancellations.map((row) => `APPOINTMENT_CANCELLED:${row.id}`).sort());
    });
    await t.test('withdrawal and automatic expiry persist once and valid replays do not duplicate', async () => {
      for (let i = 0; i < 2; i++) assert.equal((await write(`/waitlist/${rejector.entryId}/withdraw`, rejector)).status, 200);
      assert.equal((await rows('WAITLIST_WITHDRAWN', rejector.entryId)).length, 1);
      const user = await register(); await enter(user); const extra = await book();
      assert.equal((await write(`/appointments/${extra.appointmentId}/cancel`)).status, 200);
      const generated = await write(`/reassignments/${extra.slotId}/offers`, admin); assert.equal(generated.status, 201);
      const offerId = generated.body.data.offer.id;
      await prisma.appointmentOffer.update({ where: { id: offerId }, data: { createdAt: new Date(Date.now() - 120000), expiresAt: new Date(Date.now() - 60000) } });
      for (let i = 0; i < 2; i++) await app.get(ReassignmentsService).expireOffer(offerId);
      const emitted = await rows('OFFER_EXPIRED', offerId); assert.equal(emitted.length, 1); assert.equal(emitted[0].recipientUserId, user.id);
    });
    await t.test('unique constraint, concurrent helper replay and first readAt preservation; historical content independent of active catalogs', async () => {
      const row = (await rows('APPOINTMENT_BOOKED', booking.appointmentId))[0];
      const read = await write(`/notifications/${row.id}/read`); assert.equal(read.status, 200);
      const { recipientUserId, institutionId, branchId, resourceType, resourceId, type, dedupeKey, data } = row;
      const input = { recipientUserId, institutionId, branchId, resourceType, resourceId, type, dedupeKey, data };
      await Promise.all(Array.from({ length: 3 }, () => prisma.$transaction((tx) => NotificationsService.create(tx, input))));
      assert.equal((await rows(type, resourceId)).length, 1);
      assert.equal((await prisma.notification.findUniqueOrThrow({ where: { id: row.id } })).readAt.toISOString(), read.body.data.readAt);
      await assert.rejects(prisma.notification.create({ data: { ...input, id: randomUUID() } }), (error) => error.code === 'P2002');
      await prisma.service.update({ where: { id: ids.serviceA }, data: { active: false } });
      const result = await get(); assert.equal(result.status, 200); assert.ok(result.body.data.some((item) => item.id === row.id && item.title));
      const all = await prisma.notification.findMany({ where: { institutionId: ids.institutionA } });
      assert.deepEqual([...new Set(all.map((item) => item.type))].sort(), ['APPOINTMENT_BOOKED','APPOINTMENT_CANCELLED','WAITLIST_ENTERED','WAITLIST_WITHDRAWN','OFFER_CREATED','OFFER_ACCEPTED','OFFER_REJECTED','OFFER_EXPIRED'].sort());
      for (const item of all) for (const key of Object.keys(item.data)) assert.ok(['startsAt', 'expiresAt'].includes(key));
    });
  } finally {
    if (prisma) {
      try {
        const institutional = { institutionId: { in: [ids.institutionA, ids.institutionB] } };
        await prisma.appointmentOffer.deleteMany({ where: { reassignment: institutional } });
        await prisma.reassignmentCandidate.deleteMany({ where: { reassignment: institutional } });
        await prisma.reassignment.deleteMany({ where: institutional });
        const entry = { userId: { in: users } };
        await prisma.waitlistPreferredDay.deleteMany({ where: { preference: { waitlistEntry: entry } } });
        await prisma.waitlistTimeRange.deleteMany({ where: { preference: { waitlistEntry: entry } } });
        await prisma.waitlistPreferredBranch.deleteMany({ where: { waitlistEntry: entry } });
        await prisma.waitlistPreference.deleteMany({ where: { waitlistEntry: entry } });
        await prisma.waitlistEntry.deleteMany({ where: entry });
        await prisma.priority.deleteMany({ where: { institutionId: ids.institutionA } });
        await cleanupNotificationsFixtures(prisma);
        await prisma.permission.deleteMany({ where: { id: { in: permissions } } });
        await prisma.appointmentStatus.deleteMany({ where: { id: { in: appointmentStatusIds } } });
        await prisma.waitlistStatus.deleteMany({ where: { id: { in: waitlistStatusIds } } });
        await assertNotificationsClean(prisma);
      } finally { await app.close(); }
    } else await app.close();
  }
});
