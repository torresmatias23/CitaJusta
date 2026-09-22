import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test, mock } from 'node:test';
import { NestFactory } from '@nestjs/core';
import { loadApiEnvironment, assertSafeLocalDatabaseUrl, getE2ePort } from './local-environment.mjs';
import { FIXTURE_EMAIL_PREFIX, ids, createNotificationsFixtures, cleanupNotificationsFixtures, assertNotificationsClean } from './notifications.fixture.mjs';

test('HU-025 automatic start in cancellation transaction, manual start, rollback and concurrency', { timeout: 120_000 }, async (t) => {
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

    const processFor = (booking) => prisma.reassignment.findFirstOrThrow({ where: { appointmentId: booking.appointmentId }, include: { offers: { orderBy: { attemptNumber: 'asc' } }, candidates: { orderBy: { rankingPosition: 'asc' } } } });
    await t.test('concurrent cancellations with no waitlist start exactly one EXHAUSTED process and replay is unchanged', async () => {
      const booking = await book(); const before = await prisma.agendaSlot.findUniqueOrThrow({ where: { id: booking.slotId } });
      const results = await Promise.all([write(`/appointments/${booking.appointmentId}/cancel`), write(`/appointments/${booking.appointmentId}/cancel`)]);
      assert.deepEqual(results.map((result) => result.status), [200,200]); assert.deepEqual(results[0].body, results[1].body);
      const process = await processFor(booking); assert.equal(process.status, 'EXHAUSTED'); assert.equal(process.offers.length, 0);
      assert.equal(await prisma.reassignment.count({ where: { agendaSlotId: booking.slotId } }), 1);
      assert.equal(await prisma.cancellation.count({ where: { appointmentId: booking.appointmentId } }), 1);
      assert.equal((await prisma.agendaSlot.findUniqueOrThrow({ where: { id: booking.slotId } })).lockVersion, before.lockVersion + 2);
      const audit = await prisma.auditEvent.findMany({ where: { resourceId: process.id } });
      assert.deepEqual(audit.map((row) => row.actionCode).sort(), ['REASSIGNMENT_EXHAUSTED', 'REASSIGNMENT_STARTED']);
      assert.ok(audit.every((row) => row.actorType === 'SYSTEM' && row.actorUserId === null));
      assert.equal((await write(`/appointments/${booking.appointmentId}/cancel`)).status, 200);
      assert.deepEqual(await processFor(booking), process);
      assert.equal((await write(`/reassignments/${booking.slotId}/offers`, admin)).status, 409);
    });
    const recipients = [await register(), await register()]; for (const user of recipients) await enter(user);
    await t.test('cancellation by a user without generate permission creates first ranked offer, SYSTEM audit and notification atomically', async () => {
      const booking = await book();
      assert.equal((await write(`/appointments/${booking.appointmentId}/cancel`)).status, 200);
      const process = await processFor(booking); assert.equal(process.status, 'OFFERING'); assert.equal(process.offers.length, 1);
      const offer = process.offers[0], winner = process.candidates.find((row) => row.id === offer.candidateId);
      assert.equal(winner.rankingPosition, 1); assert.equal(offer.attemptNumber, 1);
      assert.equal(offer.expectedSlotVersion, (await prisma.agendaSlot.findUniqueOrThrow({ where: { id: booking.slotId } })).lockVersion);
      const cancellation = await prisma.cancellation.findUniqueOrThrow({ where: { id: process.originCancellationId } });
      assert.equal(cancellation.appointmentId, booking.appointmentId); assert.equal(cancellation.cancelledByUserId, source.id);
      const audit = await prisma.auditEvent.findMany({ where: { resourceId: { in: [booking.appointmentId, process.id, offer.id] } } });
      assert.equal(audit.find((row) => row.actionCode === 'APPOINTMENT_CANCELLED').actorUserId, source.id);
      for (const action of ['REASSIGNMENT_STARTED','OFFER_CREATED']) {
        const event = audit.find((row) => row.actionCode === action); assert.equal(event.actorType, 'SYSTEM'); assert.equal(event.actorUserId, null);
      }
      assert.equal((await rows('OFFER_CREATED', offer.id))[0].recipientUserId, winner.userId);
      assert.equal((await write(`/appointments/${booking.appointmentId}/cancel`)).status, 200);
      assert.deepEqual(await processFor(booking), process);
      assert.equal((await write(`/reassignments/${booking.slotId}/offers`, admin)).status, 409);
      // HU-023 keeps the original process, persisted ranking and policy after automatic start.
      const rejector = recipients.find((user) => user.id === winner.userId);
      assert.equal((await write(`/reassignments/offers/${offer.id}/reject`, rejector)).status, 200);
      const next = (await processFor(booking)).offers[1]; assert.equal(next.reassignmentId, process.id); assert.equal(next.attemptNumber, 2);
      await prisma.appointmentOffer.update({ where: { id: next.id }, data: { createdAt: new Date(Date.now()-120000), expiresAt: new Date(Date.now()-60000) } });
      await app.get(ReassignmentsService).expireOffer(next.id);
      const final = await processFor(booking); assert.equal(final.status, 'EXHAUSTED'); assert.deepEqual(final.candidates, process.candidates);
      assert.equal(await prisma.reassignment.count({ where: { agendaSlotId: booking.slotId } }), 1);
    });
    await t.test('blocked release still cancels; manual start retains authorization, branch isolation, errors and 201 contract after unblocking', async () => {
      const booking = await book();
      await prisma.agendaSlot.update({ where: { id: booking.slotId }, data: { blockedUntilAt: new Date(Date.now()+3600000) } });
      assert.equal((await write(`/appointments/${booking.appointmentId}/cancel`)).status, 200);
      assert.equal(await prisma.reassignment.count({ where: { agendaSlotId: booking.slotId } }), 0);
      assert.equal((await write(`/reassignments/${booking.slotId}/offers`, admin)).status, 409);
      assert.equal((await write(`/reassignments/${booking.slotId}/offers`, source)).status, 403);
      assert.equal((await request('POST', `/reassignments/${booking.slotId}/offers`, admin.token, undefined, { ...headers, 'x-branch-id': ids.branchA2 })).status, 404);
      await prisma.agendaSlot.update({ where: { id: booking.slotId }, data: { blockedUntilAt: null } });
      const generated = await write(`/reassignments/${booking.slotId}/offers`, admin); assert.equal(generated.status, 201);
      assert.deepEqual(Object.keys(generated.body.data).sort(), ['id','offer','status']); assert.equal(generated.body.data.status, 'OFFERING');
      const audit = await prisma.auditEvent.findFirstOrThrow({ where: { actionCode: 'REASSIGNMENT_STARTED', resourceId: generated.body.data.id } });
      assert.equal(audit.actorType, 'USER'); assert.equal(audit.actorUserId, admin.id);
      assert.equal((await write(`/reassignments/${booking.slotId}/offers`, admin)).status, 409);
    });
    await t.test('past slot and inactive context do not prevent cancellation or create partial processes', async () => {
      for (const scenario of ['past', 'inactive']) {
        const booking = await book();
        if (scenario === 'past') {
          const startsAt = new Date(Date.now()-7200000), endsAt = new Date(Date.now()-3600000);
          await prisma.agendaSlot.update({ where: { id: booking.slotId }, data: { startsAt, endsAt } });
          await prisma.appointment.update({ where: { id: booking.appointmentId }, data: { startsAt, endsAt } });
        } else await prisma.service.update({ where: { id: ids.serviceA }, data: { active: false } });
        try {
          assert.equal((await write(`/appointments/${booking.appointmentId}/cancel`)).status, 200);
          assert.equal(await prisma.reassignment.count({ where: { agendaSlotId: booking.slotId } }), 0);
          assert.equal(await prisma.appointmentOffer.count({ where: { agendaSlotId: booking.slotId } }), 0);
          assert.equal((await write(`/reassignments/${booking.slotId}/offers`, admin)).status, scenario === 'past' ? 409 : 404);
        } finally { if (scenario === 'inactive') await prisma.service.update({ where: { id: ids.serviceA }, data: { active: true } }); }
      }
    });
    await t.test('failure after first offer notification INSERT rolls back the entire real cancellation transaction', async () => {
      const booking = await book(); const slot = await prisma.agendaSlot.findUniqueOrThrow({ where: { id: booking.slotId } });
      const appointment = await prisma.appointment.findUniqueOrThrow({ where: { id: booking.appointmentId }, include: { historyEntries: true } });
      const original = NotificationsService.create; let inserted = false;
      const spy = mock.method(NotificationsService, 'create', async (tx, input) => { await original(tx, input);
        if (input.type === 'OFFER_CREATED') { inserted = true; throw new Error('Injected notification failure'); } });
      const beforeAudit = await prisma.auditEvent.count({ where: { institutionId: ids.institutionA } });
      const beforeNotifications = await prisma.notification.count({ where: { institutionId: ids.institutionA } });
      try { assert.equal((await write(`/appointments/${booking.appointmentId}/cancel`)).status, 500); assert.equal(inserted, true); }
      finally { spy.mock.restore(); }
      assert.deepEqual(await prisma.agendaSlot.findUniqueOrThrow({ where: { id: booking.slotId } }), slot);
      assert.deepEqual(await prisma.appointment.findUniqueOrThrow({ where: { id: booking.appointmentId }, include: { historyEntries: true } }), appointment);
      assert.equal(await prisma.cancellation.count({ where: { appointmentId: booking.appointmentId } }), 0);
      assert.equal(await prisma.reassignment.count({ where: { agendaSlotId: booking.slotId } }), 0);
      assert.equal(await prisma.appointmentOffer.count({ where: { agendaSlotId: booking.slotId } }), 0);
      assert.equal(await prisma.auditEvent.count({ where: { institutionId: ids.institutionA } }), beforeAudit);
      assert.equal(await prisma.notification.count({ where: { institutionId: ids.institutionA } }), beforeNotifications);
    });
    await t.test('a reassigned appointment can be cancelled again and binds a new process to its exact cancellation', async () => {
      const booking = await book(); assert.equal((await write(`/appointments/${booking.appointmentId}/cancel`)).status, 200);
      const first = await processFor(booking), offer = first.offers[0];
      const candidate = first.candidates.find((row) => row.id === offer.candidateId);
      const acceptor = recipients.find((user) => user.id === candidate.userId);
      assert.equal((await write(`/reassignments/offers/${offer.id}/accept`, acceptor)).status, 200);
      for (let i = 0; i < 2; i++) assert.equal((await write(`/appointments/${booking.appointmentId}/cancel`, acceptor)).status, 200);
      const processes = await prisma.reassignment.findMany({ where: { appointmentId: booking.appointmentId } });
      const cancellations = await prisma.cancellation.findMany({ where: { appointmentId: booking.appointmentId } });
      assert.equal(processes.length, 2); assert.equal(cancellations.length, 2);
      assert.equal(processes.find((row) => row.id === first.id).status, 'COMPLETED');
      const second = processes.find((row) => row.id !== first.id);
      assert.equal(second.sourceUserId, acceptor.id);
      assert.equal(second.originCancellationId, cancellations.find((row) => row.cancelledByUserId === acceptor.id).id);
      assert.notEqual(second.originCancellationId, first.originCancellationId);
      assert.equal(await prisma.appointmentOffer.count({ where: { agendaSlotId: booking.slotId, status: 'PENDING' } }), 1);
    });
    await t.test('manual start racing cancellation cannot create a second process or pending offer', async () => {
      const booking = await book();
      const [cancelled, generated] = await Promise.all([write(`/appointments/${booking.appointmentId}/cancel`), write(`/reassignments/${booking.slotId}/offers`, admin)]);
      assert.equal(cancelled.status, 200); assert.equal(generated.status, 409);
      const process = await processFor(booking); assert.equal(process.offers.length, 1);
      assert.equal(await prisma.reassignment.count({ where: { agendaSlotId: booking.slotId } }), 1);
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
