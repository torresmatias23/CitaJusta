import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { NestFactory } from '@nestjs/core';
import { loadApiEnvironment, assertSafeLocalDatabaseUrl, getE2ePort } from './local-environment.mjs';
import { FIXTURE_EMAIL_PREFIX, ids, cleanupCheckpointFixtures, createCheckpointFixtures, assertCheckpointIsClean } from './fixture.mjs';

test('HU-017 real PostgreSQL attendance, isolation, rollback and concurrent outcomes', { timeout: 120_000 }, async (t) => {
  loadApiEnvironment(); assertSafeLocalDatabaseUrl(process.env.DATABASE_URL); process.env.NODE_ENV = 'test';
  const [{ AppModule }, { configureApplication }, { PrismaService }, { bootstrapAppointmentStatus }] = await Promise.all([
    import('../../dist/app.module.js'), import('../../dist/app.configuration.js'), import('../../dist/database/prisma.service.js'),
    import('../../dist/database/appointment-status.bootstrap.js'),
  ]);
  const app = await NestFactory.create(AppModule, { logger: false });
  let prisma; let cleanupEnabled = false; const createdPermissions = [];
  try {
    configureApplication(app); await app.listen(getE2ePort(), '127.0.0.1');
    const base = `http://127.0.0.1:${app.getHttpServer().address().port}/api/v1`;
    prisma = app.get(PrismaService); await cleanupCheckpointFixtures(prisma); cleanupEnabled = true;
    async function request(method, path, token, body, headers = {}) {
      const result = await fetch(`${base}${path}`, { method, headers: { ...headers,
        ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
        body: body === undefined ? undefined : JSON.stringify(body) });
      return { status: result.status, body: await result.json() };
    }
    async function register() {
      const body = { email: `${FIXTURE_EMAIL_PREFIX}${randomUUID()}@example.com`, password: `E2e-${randomUUID()}-Aa1!`, firstName: 'Attendance', lastName: 'Checkpoint' };
      const registered = await request('POST', '/auth/register', undefined, body); assert.equal(registered.status, 201);
      const login = await request('POST', '/auth/login', undefined, { email: body.email, password: body.password }); assert.equal(login.status, 200);
      return { id: registered.body.id, token: login.body.accessToken };
    }
    const admin = await register(); const owner = await register(); const officer = await register(); const foreign = await register();
    await createCheckpointFixtures(prisma, admin.id);
    await bootstrapAppointmentStatus(prisma);
    for (const [module, action] of [['appointments', 'attendance'], ['agenda', 'read']]) {
      const code = `${module}.${action}`;
      let permission = await prisma.permission.findUnique({ where: { code } });
      if (!permission) { permission = await prisma.permission.create({ data: { id: randomUUID(), code, module, action } }); createdPermissions.push(permission.id); }
      await prisma.rolePermission.createMany({ data: [ids.roleInstitution, ids.roleBranch].map((roleId) => ({ roleId, permissionId: permission.id })) });
    }
    await prisma.userRole.createMany({ data: [
      { id: randomUUID(), userId: officer.id, roleId: ids.roleBranch, institutionId: ids.institutionA, branchId: ids.branchA1 },
      { id: randomUUID(), userId: foreign.id, roleId: ids.roleInstitution, institutionId: ids.institutionB },
    ] });
    const statuses = Object.fromEntries((await prisma.appointmentStatus.findMany({ where: { code: { in: ['AGENDADA', 'CANCELADA', 'ATENDIDA', 'INASISTENCIA'] } } })).map((row) => [row.code, row]));
    const slotIds = [ids.slotAvailable, ids.slotReserved, ids.slotBlocked, ids.slotBlockedUntil, ids.slotPast, ids.slotOtherContext, ids.slotInactivePoint, ids.slotCrossTenant];
    const rows = [];
    for (const [index, agendaSlotId] of slotIds.entries()) {
      const slot = await prisma.agendaSlot.findUniqueOrThrow({ where: { id: agendaSlotId }, include: { availability: true } });
      const a = slot.availability;
      rows.push(await prisma.appointment.create({ data: { id: randomUUID(), institutionId: ids.institutionA,
        branchId: a.branchId, serviceId: a.serviceId, professionalId: a.professionalId, attentionPointId: a.attentionPointId,
        userId: owner.id, agendaSlotId, statusId: statuses[index === 2 ? 'CANCELADA' : 'AGENDADA'].id,
        origin: 'WEB', startsAt: slot.startsAt, endsAt: slot.endsAt } }));
      await prisma.agendaSlot.update({ where: { id: agendaSlotId }, data: { status: index === 2 ? 'RELEASED' : 'RESERVED' } });
    }
    const headers = { 'x-institution-id': ids.institutionA };
    const record = (index, status, token = admin.token, scope = headers) => request('POST', `/appointments/${rows[index].id}/attendance`, token, { status }, scope);
    const history = (index) => prisma.appointmentHistory.findMany({ where: { appointmentId: rows[index].id }, orderBy: { id: 'asc' } });
    const stored = (index) => prisma.appointment.findUniqueOrThrow({ where: { id: rows[index].id } });
    const slots = () => prisma.agendaSlot.findMany({ where: { id: { in: slotIds } }, orderBy: { id: 'asc' } });
    const originalSlots = await slots();
    const engine = async () => ({ offers: await prisma.appointmentOffer.count(), reassignments: await prisma.reassignment.count(), candidates: await prisma.reassignmentCandidate.count() });
    const originalEngine = await engine();

    await t.test('bootstrap is repeatable/concurrent and preserves compatible catalog configuration', async () => {
      const before = await prisma.appointmentStatus.findMany({ orderBy: { id: 'asc' } });
      await Promise.all([bootstrapAppointmentStatus(prisma), bootstrapAppointmentStatus(prisma)]);
      assert.deepEqual(await prisma.appointmentStatus.findMany({ orderBy: { id: 'asc' } }), before);
      for (const code of ['ATENDIDA', 'INASISTENCIA']) {
        assert.equal(statuses[code].active, true); assert.equal(statuses[code].isFinal, true);
        assert.equal(statuses[code].allowsCancellation, false); assert.equal(statuses[code].allowsConfirmation, false);
      }
    });
    await t.test('authentication, explicit permission and institutional context are mandatory', async () => {
      assert.equal((await request('POST', `/appointments/${rows[0].id}/attendance`, undefined, { status: 'ATENDIDA' }, headers)).status, 401);
      assert.equal((await record(0, 'ATENDIDA', owner.token)).status, 403);
      assert.equal((await record(0, 'ATENDIDA', admin.token, {})).status, 403);
    });
    await t.test('unknown status, extra payload/query, identity overrides and invalid UUID are 400', async () => {
      for (const body of [{}, { status: 'CANCELADA' }, ...['userId', 'institutionId', 'branchId', 'actorUserId', 'previousStatus', 'reason'].map((field) => ({ status: 'ATENDIDA', [field]: 'override' }))]) {
        assert.equal((await request('POST', `/appointments/${rows[0].id}/attendance`, admin.token, body, headers)).status, 400);
      }
      assert.equal((await request('POST', '/appointments/invalid/attendance', admin.token, { status: 'ATENDIDA' }, headers)).status, 400);
      assert.equal((await request('POST', `/appointments/${rows[0].id}/attendance?userId=${owner.id}`, admin.token, { status: 'ATENDIDA' }, headers)).status, 400);
    });
    await t.test('missing/deleted/foreign/incoherent and out-of-branch appointments share 404', async () => {
      assert.equal((await request('POST', `/appointments/${ids.missing}/attendance`, admin.token, { status: 'ATENDIDA' }, headers)).status, 404);
      assert.equal((await record(0, 'ATENDIDA', foreign.token, { 'x-institution-id': ids.institutionB })).status, 404);
      assert.equal((await record(5, 'ATENDIDA', officer.token, { ...headers, 'x-branch-id': ids.branchA1 })).status, 404);
      assert.equal((await record(7, 'ATENDIDA')).status, 404);
      await prisma.appointment.update({ where: { id: rows[0].id }, data: { deletedAt: new Date() } });
      try { assert.equal((await record(0, 'ATENDIDA')).status, 404); }
      finally { await prisma.appointment.update({ where: { id: rows[0].id }, data: { deletedAt: null } }); }
    });
    for (const [index, outcome] of [[0, 'ATENDIDA'], [1, 'INASISTENCIA']]) await t.test(`authorized ${outcome} persists controlled DTO and exactly one actor/status history`, async () => {
      const result = await record(index, outcome, officer.token, { ...headers, 'x-branch-id': ids.branchA1 }); assert.equal(result.status, 200);
      assert.equal(result.body.data.status.code, outcome);
      assert.deepEqual(Object.keys(result.body.data).sort(), ['id', 'status', 'startsAt', 'endsAt', 'branch', 'service', 'professional'].sort());
      assert.equal((await stored(index)).statusId, statuses[outcome].id);
      const entries = await history(index); assert.equal(entries.length, 1);
      assert.equal(entries[0].previousStatusId, statuses.AGENDADA.id); assert.equal(entries[0].newStatusId, statuses[outcome].id);
      assert.equal(entries[0].actorUserId, officer.id); assert.equal(entries[0].previousUserId, owner.id); assert.equal(entries[0].newUserId, owner.id);
      assert.equal(entries[0].reason, outcome === 'ATENDIDA' ? 'ATTENDANCE_RECORDED' : 'NO_SHOW_RECORDED');
      assert.equal(entries[0].details, null);
    });
    await t.test('equivalent repeats are 200 with no timestamp/history effects; contradictory final outcomes are 409', async () => {
      for (const [index, outcome, contrary] of [[0, 'ATENDIDA', 'INASISTENCIA'], [1, 'INASISTENCIA', 'ATENDIDA']]) {
        const before = await stored(index); const entries = await history(index);
        assert.equal((await record(index, outcome)).status, 200); assert.equal((await record(index, contrary)).status, 409);
        assert.deepEqual(await stored(index), before); assert.deepEqual(await history(index), entries);
      }
    });
    await t.test('CANCELADA rejects both outcomes and preserves previous cancellation idempotence', async () => {
      const before = await stored(2);
      for (const outcome of ['ATENDIDA', 'INASISTENCIA']) assert.equal((await record(2, outcome)).status, 409);
      assert.equal((await request('POST', `/appointments/${rows[2].id}/cancel`, owner.token, {})).status, 200);
      assert.deepEqual(await stored(2), before); assert.deepEqual(await history(2), []);
    });
    async function race(index, outcomes) {
      // Both actual Serializable transactions read AGENDADA before either writes.
      const transaction = prisma.$transaction.bind(prisma); const barrier = Promise.withResolvers(); let reads = 0;
      prisma.$transaction = (work, options) => typeof work === 'function' ? transaction(async (tx) => work(new Proxy(tx, { get(target, key) {
        if (key !== 'appointment') return target[key];
        return new Proxy(target.appointment, { get(delegate, method) {
          if (method !== 'findFirst') return delegate[method];
          return async (args) => {
            const result = await delegate.findFirst(args);
            if (args.where.id === rows[index].id && ++reads <= 2) { if (reads === 2) barrier.resolve(); await barrier.promise; }
            return result;
          };
        } });
      } })), options) : transaction(work, options);
      try { return await Promise.all(outcomes.map((outcome) => record(index, outcome))); }
      finally { prisma.$transaction = transaction; }
    }
    await t.test('concurrent equivalent outcomes return 200/200 and one effective transition/history', async () => {
      const results = await race(3, ['ATENDIDA', 'ATENDIDA']); assert.deepEqual(results.map((r) => r.status), [200, 200]);
      assert.equal((await stored(3)).statusId, statuses.ATENDIDA.id); assert.equal((await history(3)).length, 1);
    });
    await t.test('concurrent contradictory outcomes return 200/409 and one consistent final history', async () => {
      const results = await race(4, ['ATENDIDA', 'INASISTENCIA']); assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
      const entries = await history(4); assert.equal(entries.length, 1); assert.equal(entries[0].newStatusId, (await stored(4)).statusId);
      assert.equal(entries[0].previousStatusId, statuses.AGENDADA.id);
    });
    await t.test('actual history INSERT followed by SQL transaction failure rolls back appointment and history', async () => {
      const before = await stored(6); const entries = await history(6);
      const transaction = prisma.$transaction.bind(prisma);
      prisma.$transaction = (work, options) => typeof work === 'function' ? transaction(async (tx) => work(new Proxy(tx, { get(target, key) {
        if (key !== 'appointmentHistory') return target[key];
        return new Proxy(target.appointmentHistory, { get(delegate, method) {
          if (method !== 'create') return delegate[method];
          return async (args) => { await delegate.create(args); throw new Error('HU017 private failure'); };
        } });
      } })), options) : transaction(work, options);
      try { const result = await record(6, 'ATENDIDA'); assert.equal(result.status, 500); assert.equal(JSON.stringify(result.body).includes('private'), false); }
      finally { prisma.$transaction = transaction; }
      assert.deepEqual(await stored(6), before); assert.deepEqual(await history(6), entries);
    });
    await t.test('agenda and own appointment read paths reflect persisted outcomes without special logic', async () => {
      const institution = await prisma.institution.findUniqueOrThrow({ where: { id: ids.institutionA } });
      const date = new Intl.DateTimeFormat('en-CA', { timeZone: institution.timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(rows[0].startsAt);
      const agenda = await request('GET', `/agenda?${new URLSearchParams({ date })}`, admin.token, undefined, headers); assert.equal(agenda.status, 200);
      const mine = await request('GET', '/appointments/me', owner.token); assert.equal(mine.status, 200);
      for (const [index, outcome] of [[0, 'ATENDIDA'], [1, 'INASISTENCIA']]) {
        assert.equal(agenda.body.data.find((row) => row.id === rows[index].id).status.code, outcome);
        assert.equal(mine.body.data.find((row) => row.id === rows[index].id).status, outcome);
      }
    });
    await t.test('all AgendaSlot fields including lockVersion and reassignment engine remain unchanged', async () => {
      assert.deepEqual(await slots(), originalSlots); assert.deepEqual(await engine(), originalEngine);
    });
  } finally {
    try { if (prisma && cleanupEnabled) { await cleanupCheckpointFixtures(prisma); await prisma.permission.deleteMany({ where: { id: { in: createdPermissions } } }); await assertCheckpointIsClean(prisma); } }
    finally { await app.close(); }
  }
});
