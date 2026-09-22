import { cancelWithBlockedSlot } from './manual-release.fixture.mjs';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test, mock } from 'node:test';
import { NestFactory } from '@nestjs/core';
import { loadApiEnvironment, assertSafeLocalDatabaseUrl, getE2ePort } from './local-environment.mjs';
import { FIXTURE_EMAIL_PREFIX, ids, createAuditFixtures, cleanupAuditFixtures, assertAuditClean } from './audit.fixture.mjs';

test('HU-020 real audit writes, atomicity, privacy, scoped reads and cursor pagination', { timeout: 120_000 }, async (t) => {
  loadApiEnvironment(); assertSafeLocalDatabaseUrl(process.env.DATABASE_URL); process.env.NODE_ENV = 'test';
  const [{ AppModule }, { configureApplication }, { PrismaService }, { AuditService }, { actions }, { bootstrapAppointmentStatus }, { bootstrapWaitlist }] = await Promise.all([
    import('../../dist/app.module.js'), import('../../dist/app.configuration.js'), import('../../dist/database/prisma.service.js'),
    import('../../dist/audit/audit.service.js'), import('../../dist/audit/audit.schemas.js'),
    import('../../dist/database/appointment-status.bootstrap.js'), import('../../dist/database/waitlist.bootstrap.js'),
  ]);
  const app = await NestFactory.create(AppModule, { logger: false });
  let prisma;
  const users = []; const permissions = []; const appointmentStatusIds = []; const waitlistStatusIds = []; const anonymousEvents = [];
  const marker = randomUUID();
  try {
    configureApplication(app); await app.listen(getE2ePort(), '127.0.0.1'); prisma = app.get(PrismaService);
    const base = `http://127.0.0.1:${app.getHttpServer().address().port}/api/v1`;
    async function request(method, path, token, body, headers = {}) {
      const response = await fetch(`${base}${path}`, { method, headers: { ...headers,
        ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}) });
      const text = await response.text(); return { status: response.status, body: text ? JSON.parse(text) : null };
    }
    async function register() {
      const credentials = { email: `${FIXTURE_EMAIL_PREFIX}${randomUUID()}@example.com`, password: `Test-${randomUUID()}-Aa1!` };
      const registered = await request('POST', '/auth/register', null, { ...credentials, firstName: 'Audit', lastName: 'Fixture' });
      assert.equal(registered.status, 201); users.push(registered.body.id);
      const login = await request('POST', '/auth/login', null, credentials); assert.equal(login.status, 200);
      return { id: registered.body.id, token: login.body.accessToken, refresh: login.body.refreshToken, credentials };
    }
    const admin = await register(); const source = await register(); const officer = await register(); const foreign = await register(); const global = await register();
    await createAuditFixtures(prisma, admin.id, source.id);
    for (const code of ['audit.read', 'appointments.attendance', 'reassignments.generate', 'branches.create', 'branches.update',
      'services.create', 'services.update', 'professionals.create', 'professionals.update', 'availability.create', 'availability.update', 'availability.block', 'reassignments.policy.update']) {
      let permission = await prisma.permission.findUnique({ where: { code } });
      if (!permission) { permission = await prisma.permission.create({ data: { id: randomUUID(), code, module: code.split('.').slice(0, -1).join('.'), action: code.split('.').at(-1) } }); permissions.push(permission.id); }
      await prisma.rolePermission.create({ data: { roleId: ids.roleInstitution, permissionId: permission.id } });
      if (code === 'audit.read') await prisma.rolePermission.createMany({ data: [ids.roleBranch, ids.roleGlobal].map((roleId) => ({ roleId, permissionId: permission.id })) });
    }
    await prisma.userRole.createMany({ data: [
      { id: randomUUID(), userId: officer.id, roleId: ids.roleBranch, institutionId: ids.institutionA, branchId: ids.branchA1 },
      { id: randomUUID(), userId: foreign.id, roleId: ids.roleInstitution, institutionId: ids.institutionB },
      { id: randomUUID(), userId: global.id, roleId: ids.roleGlobal },
    ] });
    const oldStatus = await prisma.appointmentStatus.findMany({ select: { id: true } }); await bootstrapAppointmentStatus(prisma);
    appointmentStatusIds.push(...(await prisma.appointmentStatus.findMany({ select: { id: true } })).filter((row) => !oldStatus.some((old) => old.id === row.id)).map((row) => row.id));
    const oldWaitlist = await prisma.waitlistStatus.findMany({ select: { id: true } }); await bootstrapWaitlist(prisma, ids.institutionA);
    waitlistStatusIds.push(...(await prisma.waitlistStatus.findMany({ select: { id: true } })).filter((row) => !oldWaitlist.some((old) => old.id === row.id)).map((row) => row.id));
    const headers = { 'x-institution-id': ids.institutionA };
    const get = (query = {}, token = admin.token, scope = headers) => request('GET', `/audit/events?${new URLSearchParams(query)}`, token, null, scope);
    const auditRows = (actionCode, resourceId) => prisma.auditEvent.findMany({ where: { actionCode,
      ...(resourceId ? { resourceId } : {}), OR: [{ institutionId: ids.institutionA }, { actorUserId: { in: users } }] } });
    const write = (method, path, body, token = admin.token) => request(method, path, token, body, headers);

    await t.test('login success, safe failure, logout and logout replay', async () => {
      assert.equal((await auditRows('AUTH_LOGIN_SUCCESS')).length, users.length);
      const before = new Set((await prisma.auditEvent.findMany({ where: { actionCode: 'AUTH_LOGIN_FAILURE' }, select: { id: true } })).map((row) => row.id));
      assert.equal((await request('POST', '/auth/login', null, { email: `missing-${marker}@example.com`, password: 'invalid-password' })).status, 401);
      const added = (await prisma.auditEvent.findMany({ where: { actionCode: 'AUTH_LOGIN_FAILURE' } })).filter((row) => !before.has(row.id));
      anonymousEvents.push(...added.map((row) => row.id)); assert.equal(added.length, 1);
      assert.equal(added[0].actorUserId, null); assert.equal(added[0].institutionId, null); assert.equal(added[0].outcome, 'FAILURE');
      assert.ok(!JSON.stringify(added).includes(marker));
      const visitor = await register();
      for (let i = 0; i < 2; i++) assert.equal((await request('POST', '/auth/logout', null, { refreshToken: visitor.refresh })).status, 204);
      assert.equal((await prisma.auditEvent.count({ where: { actorUserId: visitor.id, actionCode: 'AUTH_LOGOUT' } })), 1);
    });

    await t.test('read auth, permission and strict query', async () => {
      assert.equal((await get({}, null)).status, 401); assert.equal((await get({}, source.token)).status, 403);
      assert.equal((await get({}, admin.token, {})).status, 403);
      for (const query of [{ limit: '101' }, { limit: '0' }, { offset: '1' }, { institutionId: ids.institutionB }, { userId: source.id },
        { actorUserId: 'bad' }, { branchId: 'bad' }, { action: 'other' }, { resourceType: 'other' }, { cursor: 'bad' }, { cursor: '' },
        { from: '2026-02-30' }, { from: '2026-02-02', to: '2026-02-01' }]) assert.equal((await get(query)).status, 400);
    });

    const at = new Date('2050-01-15T12:00:00.123Z');
    const generated = Array.from({ length: 105 }, () => ({ id: randomUUID(), institutionId: ids.institutionA, branchId: ids.branchA1,
      actorUserId: admin.id, actorType: 'USER', actionCode: 'AVAILABILITY_CREATED', resourceType: 'AVAILABILITY', resourceId: marker, outcome: 'SUCCESS', occurredAt: at }));
    await prisma.auditEvent.createMany({ data: [...generated,
      { ...generated[0], id: randomUUID(), branchId: ids.branchA2 },
      { ...generated[0], id: randomUUID(), institutionId: ids.institutionB, branchId: ids.branchB1 },
      { ...generated[0], id: randomUUID(), institutionId: null, branchId: null, actorUserId: null, actorType: 'SYSTEM' },
    ] });
    const filters = { from: '2050-01-15', to: '2050-01-15' };
    await t.test('institution/branch/global isolation, null events, filters and controlled DTO', async () => {
      const scoped = await get({ ...filters, branchId: ids.branchA2 }); assert.equal(scoped.body.data.length, 1);
      const branchScope = { ...headers, 'x-branch-id': ids.branchA1 };
      assert.ok((await get(filters, officer.token, branchScope)).body.data.every((row) => row.branchId === ids.branchA1 && row.institutionId === ids.institutionA));
      assert.equal((await get({ branchId: ids.branchA2 }, officer.token, branchScope)).status, 404);
      assert.equal((await get({ branchId: ids.branchB1 })).status, 404);
      assert.equal((await get(filters, foreign.token, { 'x-institution-id': ids.institutionB })).body.data.length, 1);
      assert.equal((await get({ ...filters, action: 'AUTH_LOGIN_SUCCESS' })).body.data.length, 0);
      assert.equal((await get({ ...filters, actorUserId: source.id })).body.data.length, 0);
      assert.equal((await get({ ...filters, resourceType: 'AUTH' })).body.data.length, 0);
      assert.equal((await get({ ...filters, branchId: ids.branchA2, actorUserId: admin.id, action: 'AVAILABILITY_CREATED', resourceType: 'AVAILABILITY' })).body.data.length, 1);
      const globalResult = await get({ ...filters, limit: '100' }, global.token, {}); assert.equal(globalResult.status, 200);
      const globalNext = await get({ ...filters, limit: '100', cursor: globalResult.body.page.nextCursor }, global.token, {});
      assert.ok([...globalResult.body.data, ...globalNext.body.data].some((row) => row.institutionId === null));
      assert.ok((await get(filters, global.token, headers)).body.data.every((row) => row.institutionId === ids.institutionA));
      const keys = ['id','institutionId','branchId','actorUserId','actorType','actionCode','resourceType','resourceId','outcome','previousState','newState','reasonCode','occurredAt'].sort();
      for (const row of scoped.body.data) assert.deepEqual(Object.keys(row).sort(), keys);
    });
    await t.test('default 50/max 100, exact tie ordering and cursor pages without duplicates or gaps; read-only', async () => {
      const query = { ...filters, branchId: ids.branchA1 };
      const before = await prisma.auditEvent.findMany({ where: { resourceId: marker }, orderBy: { id: 'asc' } });
      const first = (await get(query)).body; assert.equal(first.data.length, 50);
      assert.equal((await get({ ...query, limit: '100' })).body.data.length, 100);
      const second = (await get({ ...query, cursor: first.page.nextCursor })).body;
      const third = (await get({ ...query, cursor: second.page.nextCursor })).body;
      const all = [...first.data, ...second.data, ...third.data]; assert.equal(third.page.nextCursor, null);
      assert.deepEqual(all.map((row) => row.id), generated.map((row) => row.id).sort().reverse());
      assert.equal(new Set(all.map((row) => row.id)).size, 105);
      assert.deepEqual(await prisma.auditEvent.findMany({ where: { resourceId: marker }, orderBy: { id: 'asc' } }), before);
    });
    await prisma.auditEvent.deleteMany({ where: { resourceId: marker } });

    let branch; let service; let professional; let available;
    await t.test('real branch/service/professional/availability/block writes and policy version idempotence', async () => {
      branch = await write('POST', '/branches', { code: `AUDIT_${marker}`, name: 'Audit branch', email: 'private@example.com' }); assert.equal(branch.status, 201);
      assert.equal((await write('PATCH', `/branches/${branch.body.data.id}`, { name: 'Updated audit branch' })).status, 200);
      service = await write('POST', '/services', { code: `AUDIT_${marker}`, name: 'Audit service', durationMinutes: 30, branchIds: [branch.body.data.id] }); assert.equal(service.status, 201);
      assert.equal((await write('PATCH', `/services/${service.body.data.id}`, { description: 'Private internal description' })).status, 200);
      const person = await register();
      professional = await write('POST', '/professionals', { userId: person.id, branchIds: [branch.body.data.id], serviceIds: [service.body.data.id] }); assert.equal(professional.status, 201);
      assert.equal((await write('PATCH', `/professionals/${professional.body.data.id}`, { titleOrFunction: 'Private title' })).status, 200);
      const startsAt = new Date(); startsAt.setUTCDate(startsAt.getUTCDate() + 14); startsAt.setUTCHours(14, 0, 0, 0);
      const endsAt = new Date(+startsAt + 3_600_000);
      available = await write('POST', '/availability', { branchId: branch.body.data.id, professionalId: professional.body.data.id,
        serviceId: service.body.data.id, startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString() }); assert.equal(available.status, 201);
      assert.equal((await write('PATCH', `/availability/${available.body.data.id}`, { active: false })).status, 200);
      assert.equal((await write('POST', '/availability/blocks', { branchId: branch.body.data.id,
        startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString(), reason: 'Private block reason' })).status, 201);
      const policy = { rankingStrategy: 'PRIORITY_THEN_WAITING', offerTtlMinutes: 10 };
      const configured = await write('POST', '/reassignment-policy', policy); assert.equal(configured.status, 201);
      assert.equal((await write('POST', '/reassignment-policy', policy)).status, 200);
      assert.equal((await auditRows('REASSIGNMENT_POLICY_VERSION_CREATED')).length, 1);
      for (const action of ['BRANCH_CREATED','BRANCH_UPDATED','SERVICE_CREATED','SERVICE_UPDATED','PROFESSIONAL_CREATED','PROFESSIONAL_UPDATED','AVAILABILITY_CREATED','AVAILABILITY_UPDATED','SCHEDULE_BLOCK_CREATED']) {
        assert.equal((await auditRows(action)).length, 1, action);
      }
    });
    await t.test('real domain rollback after audit insert leaves neither branch nor SUCCESS event', async () => {
      const record = AuditService.record;
      const spy = mock.method(AuditService, 'record', async (client, event) => {
        await record(client, event);
        if (event.actionCode === 'BRANCH_CREATED') throw new Error('Injected transaction failure');
      });
      try {
        const code = `ROLLBACK_${marker}`;
        assert.equal((await write('POST', '/branches', { code, name: 'Rollback branch' })).status, 500);
        assert.equal(await prisma.branch.count({ where: { institutionId: ids.institutionA, code } }), 0);
        assert.equal((await auditRows('BRANCH_CREATED')).length, 1);
      } finally { spy.mock.restore(); }
    });
    async function bookExtra(offset) {
      const initial = await prisma.agendaSlot.findUniqueOrThrow({ where: { id: ids.slotAvailable } });
      const startsAt = new Date(+initial.startsAt + (offset + 1) * 3_600_000);
      const slot = await prisma.agendaSlot.create({ data: { id: randomUUID(), availabilityId: ids.availabilityMain,
        startsAt, endsAt: new Date(+startsAt + 1_800_000), status: 'AVAILABLE' } });
      const booked = await write('POST', '/appointments', { agendaSlotId: slot.id }, source.token); assert.equal(booked.status, 201);
      return { appointmentId: booked.body.data.id, slotId: slot.id };
    }
    await t.test('appointment creation/cancellation, attendance/no-show and replay do not duplicate events', async () => {
      for (const [offset, status, action] of [[0, 'ATENDIDA', 'ATTENDANCE_RECORDED'], [1, 'INASISTENCIA', 'NO_SHOW_RECORDED']]) {
        const booking = await bookExtra(offset);
        for (let i = 0; i < 2; i++) assert.equal((await write('POST', `/appointments/${booking.appointmentId}/attendance`, { status })).status, 200);
        assert.equal((await auditRows(action, booking.appointmentId)).length, 1);
        const event = (await auditRows(action, booking.appointmentId))[0];
        assert.equal(event.previousState, 'AGENDADA'); assert.equal(event.newState, status); assert.equal(event.branchId, ids.branchA1);
      }
    });
    const recipients = [];
    await t.test('offers and reassignment started/completed/exhausted audit all real paths and idempotent replays', async () => {
      for (let i = 0; i < 2; i++) {
        const user = await register(); recipients.push(user);
        const entry = await write('POST', '/waitlist', { serviceId: ids.serviceA, branchId: ids.branchA1 }, user.token); assert.equal(entry.status, 201); user.entryId = entry.body.data.id;
        assert.equal((await write('PUT', `/waitlist/${user.entryId}/preferences`, { preferredDays: [1,2,3,4,5,6,7],
          timeRanges: [{ start: '00:00', end: '23:59' }], preferredBranchIds: [], allowsOtherBranches: false, acceptsAnyProfessional: true }, user.token)).status, 200);
      }
      const booking = await bookExtra(2);
      for (let i = 0; i < 2; i++) assert.equal((await cancelWithBlockedSlot(prisma, booking.appointmentId, () => write('POST', `/appointments/${booking.appointmentId}/cancel`, null, source.token))).status, 200);
      assert.equal((await auditRows('APPOINTMENT_CANCELLED', booking.appointmentId)).length, 1);
      const generated = await write('POST', `/reassignments/${booking.slotId}/offers`); assert.equal(generated.status, 201);
      const pending = await prisma.appointmentOffer.findFirstOrThrow({ where: { reassignmentId: generated.body.data.id, status: 'PENDING' }, include: { candidate: true } });
      const rejector = recipients.find((user) => user.id === pending.candidate.userId);
      for (let i = 0; i < 2; i++) assert.equal((await write('POST', `/reassignments/offers/${pending.id}/reject`, null, rejector.token)).status, 200);
      const next = await prisma.appointmentOffer.findFirstOrThrow({ where: { reassignmentId: generated.body.data.id, status: 'PENDING' }, include: { candidate: true } });
      const acceptor = recipients.find((user) => user.id === next.candidate.userId);
      for (let i = 0; i < 2; i++) assert.equal((await write('POST', `/reassignments/offers/${next.id}/accept`, null, acceptor.token)).status, 200);
      for (const [action, id] of [['OFFER_CREATED', pending.id], ['OFFER_CREATED', next.id], ['OFFER_ACCEPTED', next.id], ['OFFER_REJECTED', pending.id],
        ['REASSIGNMENT_STARTED', generated.body.data.id], ['REASSIGNMENT_COMPLETED', generated.body.data.id]]) assert.equal((await auditRows(action, id)).length, 1, action);
      const another = await bookExtra(3);
      assert.equal((await cancelWithBlockedSlot(prisma, another.appointmentId, () => write('POST', `/appointments/${another.appointmentId}/cancel`, null, source.token))).status, 200);
      const last = await write('POST', `/reassignments/${another.slotId}/offers`); assert.equal(last.status, 201);
      assert.equal((await write('POST', `/reassignments/offers/${last.body.data.offer.id}/reject`, null, rejector.token)).status, 200);
      assert.equal((await auditRows('REASSIGNMENT_EXHAUSTED', last.body.data.id)).length, 1);
      assert.equal((await write('POST', `/waitlist/${rejector.entryId}/withdraw`, null, rejector.token)).status, 200);
      const empty = await bookExtra(4);
      await cancelWithBlockedSlot(prisma, empty.appointmentId, () => write('POST', `/appointments/${empty.appointmentId}/cancel`, null, source.token));
      const exhausted = await write('POST', `/reassignments/${empty.slotId}/offers`); assert.equal(exhausted.status, 201);
      assert.equal(exhausted.body.data.offer, null); assert.equal((await auditRows('REASSIGNMENT_EXHAUSTED', exhausted.body.data.id)).length, 1);
    });
    await t.test('automatic expiration emits one SYSTEM event and replay is read-only', async () => {
      const user = await register();
      const entry = await write('POST', '/waitlist', { serviceId: ids.serviceA, branchId: ids.branchA1 }, user.token);
      assert.equal(entry.status, 201);
      await write('PUT', `/waitlist/${entry.body.data.id}/preferences`, { preferredDays: [1,2,3,4,5,6,7],
        timeRanges: [{ start: '00:00', end: '23:59' }], preferredBranchIds: [], allowsOtherBranches: false, acceptsAnyProfessional: true }, user.token);
      const booking = await bookExtra(5);
      await cancelWithBlockedSlot(prisma, booking.appointmentId, () => write('POST', `/appointments/${booking.appointmentId}/cancel`, null, source.token));
      const generated = await write('POST', `/reassignments/${booking.slotId}/offers`); assert.equal(generated.status, 201);
      const offerId = generated.body.data.offer.id;
      await prisma.appointmentOffer.update({ where: { id: offerId }, data: {
        createdAt: new Date(Date.now() - 120000), expiresAt: new Date(Date.now() - 60000) } });
      const { ReassignmentsService } = await import('../../dist/reassignments/reassignments.service.js');
      for (let i = 0; i < 2; i++) await app.get(ReassignmentsService).expireOffer(offerId);
      const rows = await auditRows('OFFER_EXPIRED', offerId); assert.equal(rows.length, 1);
      assert.equal(rows[0].actorType, 'SYSTEM'); assert.equal(rows[0].actorUserId, null);
      assert.equal(rows[0].newState, 'EXPIRED'); assert.equal(rows[0].reasonCode, 'OFFER_TTL_ELAPSED');
    });
    await t.test('all specified action codes emitted with no private payloads', async () => {
      const rows = await prisma.auditEvent.findMany({ where: { OR: [{ institutionId: ids.institutionA }, { actorUserId: { in: users } }, { id: { in: anonymousEvents } }] } });
      const emitted = new Set(rows.map((row) => row.actionCode));
      for (const action of actions) assert.ok(emitted.has(action), action);
      const text = JSON.stringify(rows);
      for (const secret of [admin.token, source.refresh, admin.credentials.password, admin.credentials.email, 'Private internal description', 'private@example.com', 'Private title', 'Private block reason']) assert.ok(!text.includes(secret));
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
        await prisma.auditEvent.deleteMany({ where: { OR: [{ id: { in: anonymousEvents } }, { resourceId: marker }] } });
        await cleanupAuditFixtures(prisma);
        await prisma.permission.deleteMany({ where: { id: { in: permissions } } });
        await prisma.appointmentStatus.deleteMany({ where: { id: { in: appointmentStatusIds } } });
        await prisma.waitlistStatus.deleteMany({ where: { id: { in: waitlistStatusIds } } });
        await assertAuditClean(prisma);
      } finally { await app.close(); }
    } else await app.close();
  }
});
