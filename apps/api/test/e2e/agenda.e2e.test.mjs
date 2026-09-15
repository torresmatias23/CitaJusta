import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { test } from 'node:test';
import { NestFactory } from '@nestjs/core';
import { loadApiEnvironment, assertSafeLocalDatabaseUrl, getE2ePort } from './local-environment.mjs';
import { FIXTURE_EMAIL_PREFIX, ids, cleanupCheckpointFixtures, createCheckpointFixtures, assertCheckpointIsClean } from './fixture.mjs';

test('HU-015 institutional agenda is scoped, historical and read-only on PostgreSQL', { timeout: 120_000 }, async (t) => {
  loadApiEnvironment(); assertSafeLocalDatabaseUrl(process.env.DATABASE_URL); process.env.NODE_ENV = 'test';
  const [{ AppModule }, { configureApplication }, { PrismaService }] = await Promise.all([
    import('../../dist/app.module.js'), import('../../dist/app.configuration.js'), import('../../dist/database/prisma.service.js'),
  ]);
  const app = await NestFactory.create(AppModule, { logger: false });
  let prisma; let cleanupEnabled = false; let createdPermission;
  try {
    configureApplication(app); await app.listen(getE2ePort(), '127.0.0.1');
    const base = `http://127.0.0.1:${app.getHttpServer().address().port}/api/v1`;
    prisma = app.get(PrismaService); await cleanupCheckpointFixtures(prisma); cleanupEnabled = true;
    async function request(method, path, token, body, headers = {}) {
      const result = await fetch(`${base}${path}`, { method, headers: { ...headers,
        ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined });
      return { status: result.status, body: await result.json() };
    }
    async function register() {
      const body = { email: `${FIXTURE_EMAIL_PREFIX}${randomUUID()}@example.com`, password: `E2e-${randomUUID()}-Aa1!`, firstName: 'Agenda', lastName: 'Checkpoint' };
      const registered = await request('POST', '/auth/register', undefined, body); assert.equal(registered.status, 201);
      const login = await request('POST', '/auth/login', undefined, { email: body.email, password: body.password }); assert.equal(login.status, 200);
      return { id: registered.body.id, token: login.body.accessToken };
    }
    const admin = await register(); const ordinary = await register(); const officer = await register(); const foreign = await register();
    const range = await createCheckpointFixtures(prisma, admin.id);
    let permission = await prisma.permission.findUnique({ where: { code: 'agenda.read' } });
    if (!permission) { permission = await prisma.permission.create({ data: { id: randomUUID(), code: 'agenda.read', module: 'agenda', action: 'read' } }); createdPermission = permission.id; }
    await prisma.rolePermission.createMany({ data: [ids.roleInstitution, ids.roleBranch].map((roleId) => ({ roleId, permissionId: permission.id })) });
    await prisma.userRole.createMany({ data: [
      { id: randomUUID(), userId: officer.id, roleId: ids.roleBranch, institutionId: ids.institutionA, branchId: ids.branchA1 },
      { id: randomUUID(), userId: foreign.id, roleId: ids.roleInstitution, institutionId: ids.institutionB },
    ] });
    await prisma.institution.update({ where: { id: ids.institutionA }, data: { timeZone: 'America/Santiago' } });
    const scheduled = await prisma.appointmentStatus.findUniqueOrThrow({ where: { code: 'AGENDADA' } });
    const cancelled = await prisma.appointmentStatus.findUniqueOrThrow({ where: { code: 'CANCELADA' } });
    const baseRow = { institutionId: ids.institutionA, branchId: ids.branchA1, serviceId: ids.serviceA, professionalId: ids.professionalA,
      userId: ordinary.id, statusId: scheduled.id, origin: 'WEB', startsAt: new Date('2035-01-15T12:00:00Z'), endsAt: new Date('2035-01-15T12:30:00Z') };
    const definitions = [
      [ids.slotAvailable, {}], [ids.slotReserved, {}],
      [ids.slotBlocked, { branchId: ids.branchA2, statusId: cancelled.id, serviceId: ids.serviceA2, professionalId: ids.professionalA2 }],
      [ids.slotBlockedUntil, { deletedAt: new Date() }],
      [ids.slotPast, { startsAt: new Date('2035-01-15T02:30:00Z'), endsAt: new Date('2035-01-15T03:00:00Z') }],
      [ids.slotOtherContext, { institutionId: ids.institutionB, branchId: ids.branchB1, serviceId: ids.serviceB, professionalId: ids.professionalB }],
      [ids.slotCrossTenant, { professionalId: ids.professionalB }],
    ];
    const rows = [];
    for (const [agendaSlotId, extra] of definitions) rows.push(await prisma.appointment.create({ data: { id: randomUUID(), ...baseRow, agendaSlotId, ...extra } }));
    const headers = { 'x-institution-id': ids.institutionA };
    const get = (filters = {}, token = admin.token, scope = headers) => request('GET', `/agenda?${new URLSearchParams({ date: '2035-01-15', ...filters })}`, token, undefined, scope);
    const expected = rows.slice(0, 3).map((row) => row.id).sort();
    const idsOf = (result) => result.body.data.map((row) => row.id);

    await t.test('authentication, agenda.read and institutional context are mandatory', async () => {
      assert.equal((await request('GET', '/agenda?date=2035-01-15', undefined, undefined, headers)).status, 401);
      assert.equal((await get({}, ordinary.token)).status, 403);
      assert.equal((await get({}, admin.token, {})).status, 403);
    });
    await t.test('strict query and GET functional body are rejected', async () => {
      for (const filter of [{ date: '2035-02-30' }, { date: '' }, { date: '2035-1-15' }, { branchId: 'bad' }, { userId: ordinary.id }, { institutionId: ids.institutionB }, { extra: 'x' }]) assert.equal((await get(filter)).status, 400);
      const payload = JSON.stringify({ userId: ordinary.id });
      const result = await new Promise((resolve, reject) => {
        const req = httpRequest(`${base}/agenda?date=2035-01-15`, { method: 'GET', headers: { ...headers, authorization: `Bearer ${admin.token}`, 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) } }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
        req.on('error', reject); req.end(payload);
      });
      assert.equal(result, 400);
    });
    await t.test('authorized day query includes CANCELADA, excludes deleted/foreign/incoherent and orders ties by id', async () => {
      const result = await get(); assert.equal(result.status, 200); assert.deepEqual(idsOf(result), expected);
      assert.equal(result.body.data.some((row) => row.status.code === 'CANCELADA'), true);
    });
    await t.test('institutional date differs from UTC date at the boundary', async () => {
      assert.deepEqual(idsOf(await get({ date: '2035-01-14' })), [rows[4].id]);
    });
    await t.test('branch/service/professional/status filters and combinations are exact', async () => {
      for (const filter of [{ branchId: ids.branchA2 }, { serviceId: ids.serviceA2 }, { professionalId: ids.professionalA2 }, { status: 'CANCELADA' },
        { branchId: ids.branchA2, serviceId: ids.serviceA2, professionalId: ids.professionalA2, status: 'CANCELADA' }]) assert.deepEqual(idsOf(await get(filter)), [rows[2].id]);
      assert.deepEqual(idsOf(await get({ status: 'UNKNOWN' })), []);
    });
    await t.test('branch officer cannot escape and foreign institution sees only its own appointment', async () => {
      const scope = { ...headers, 'x-branch-id': ids.branchA1 };
      assert.deepEqual(idsOf(await get({}, officer.token, scope)), rows.slice(0, 2).map((row) => row.id).sort());
      assert.equal((await get({ branchId: ids.branchA2 }, officer.token, scope)).status, 404);
      assert.equal((await get({}, officer.token)).status, 403);
      assert.deepEqual(idsOf(await get({}, foreign.token, { 'x-institution-id': ids.institutionB })), [rows[5].id]);
      for (const filter of [{ branchId: ids.branchB1 }, { serviceId: ids.serviceB }, { professionalId: ids.professionalB }]) assert.equal((await get(filter)).status, 404);
    });
    await t.test('inactive related catalogs never hide persisted coherent appointments', async () => {
      await prisma.branch.update({ where: { id: ids.branchA2 }, data: { status: 'INACTIVE' } });
      await prisma.service.update({ where: { id: ids.serviceA2 }, data: { active: false } });
      await prisma.professional.update({ where: { id: ids.professionalA2 }, data: { status: 'INACTIVE' } });
      assert.deepEqual(idsOf(await get()), expected);
      assert.deepEqual(idsOf(await get({ branchId: ids.branchA2, serviceId: ids.serviceA2, professionalId: ids.professionalA2, status: 'CANCELADA' })), [rows[2].id]);
    });
    await t.test('DTO selects operational names only and emits ISO timestamps', async () => {
      for (const row of (await get()).body.data) {
        assert.deepEqual(Object.keys(row).sort(), ['id', 'startsAt', 'endsAt', 'origin', 'status', 'branch', 'service', 'professional', 'user'].sort());
        assert.deepEqual(Object.keys(row.user).sort(), ['id', 'firstNames', 'lastNames'].sort());
        assert.deepEqual(Object.keys(row.professional).sort(), ['id', 'firstNames', 'lastNames', 'titleOrFunction'].sort());
        assert.equal(row.startsAt, new Date(row.startsAt).toISOString());
      }
    });
    await t.test('HTTP reads leave appointments, slots/versions, history, offers and reassignment unchanged', async () => {
      const snapshot = async () => ({ appointments: await prisma.appointment.findMany({ where: { userId: ordinary.id }, orderBy: { id: 'asc' } }),
        slots: await prisma.agendaSlot.findMany({ where: { id: { in: definitions.map(([id]) => id) } }, orderBy: { id: 'asc' } }),
        history: await prisma.appointmentHistory.count(), offers: await prisma.appointmentOffer.count(), reassignments: await prisma.reassignment.count() });
      const before = await snapshot(); await get(); await get({ status: 'CANCELADA' }); assert.deepEqual(await snapshot(), before);
    });
    await t.test('existing availability and own appointment endpoints remain compatible', async () => {
      assert.equal((await request('GET', '/appointments/me', ordinary.token)).status, 200);
      const available = await request('GET', `/branches/${ids.branchA1}/services/${ids.serviceA}/availability?${new URLSearchParams({ from: range.from, to: range.to })}`, ordinary.token);
      assert.equal(available.status, 200);
    });
  } finally {
    try { if (prisma && cleanupEnabled) { await cleanupCheckpointFixtures(prisma); if (createdPermission) await prisma.permission.delete({ where: { id: createdPermission } }); await assertCheckpointIsClean(prisma); } }
    finally { await app.close(); }
  }
});
