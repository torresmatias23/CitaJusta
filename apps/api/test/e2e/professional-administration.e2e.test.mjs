import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { NestFactory } from '@nestjs/core';
import { loadApiEnvironment, assertSafeLocalDatabaseUrl, getE2ePort } from './local-environment.mjs';
import { FIXTURE_EMAIL_PREFIX, FIXTURE_PREFIX, ids, cleanupCheckpointFixtures, createCheckpointFixtures, assertCheckpointIsClean } from './fixture.mjs';

test('HU-013 professional administration with real HTTP and PostgreSQL', { timeout: 120_000 }, async (t) => {
  loadApiEnvironment();
  assertSafeLocalDatabaseUrl(process.env.DATABASE_URL);
  process.env.NODE_ENV = 'test';
  const [{ AppModule }, { configureApplication }, { PrismaService }] = await Promise.all([
    import('../../dist/app.module.js'), import('../../dist/app.configuration.js'), import('../../dist/database/prisma.service.js'),
  ]);
  const app = await NestFactory.create(AppModule, { logger: false });
  const permissionsCreated = [];
  let prisma;
  let cleanupEnabled = false;
  try {
    configureApplication(app);
    await app.listen(getE2ePort(), '127.0.0.1');
    const baseUrl = `http://127.0.0.1:${app.getHttpServer().address().port}/api/v1`;
    prisma = app.get(PrismaService);
    await cleanupCheckpointFixtures(prisma);
    cleanupEnabled = true;
    async function request(method, path, token, body, headers = {}) {
      const response = await fetch(`${baseUrl}${path}`, { method,
        headers: { ...(token ? { authorization: `Bearer ${token}` } : {}),
          ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return { status: response.status, body: await response.json() };
    }
    async function register() {
      const body = { email: `${FIXTURE_EMAIL_PREFIX}${randomUUID()}@example.com`, password: `E2e-${randomUUID()}-Aa1!`, firstName: 'Professional', lastName: 'Checkpoint' };
      const registered = await request('POST', '/auth/register', undefined, body);
      assert.equal(registered.status, 201);
      const login = await request('POST', '/auth/login', undefined, { email: body.email, password: body.password });
      assert.equal(login.status, 200);
      return { id: registered.body.id, token: login.body.accessToken, email: body.email };
    }
    const admin = await register();
    const target = await register();
    const other = await register();
    const branchOfficer = await register();
    const range = await createCheckpointFixtures(prisma, admin.id);
    for (const action of ['create', 'update', 'read']) {
      const code = `professionals.${action}`;
      let permission = await prisma.permission.findUnique({ where: { code } });
      if (!permission) {
        permission = await prisma.permission.create({ data: { id: randomUUID(), code, module: 'professionals', action } });
        permissionsCreated.push(permission.id);
      }
      await prisma.rolePermission.createMany({ data: [ids.roleInstitution, ids.roleBranch].map((roleId) => ({ roleId, permissionId: permission.id })) });
    }
    await prisma.userRole.create({ data: { id: randomUUID(), userId: branchOfficer.id, roleId: ids.roleBranch, institutionId: ids.institutionA, branchId: ids.branchA1 } });
    const headers = { 'x-institution-id': ids.institutionA };
    const write = (method, path, body, token = admin.token, scope = headers) => request(method, path, token, body, scope);
    const input = { userId: target.id, internalCode: `${FIXTURE_PREFIX}_HU013`, titleOrFunction: 'Atención general', branchIds: [ids.branchA1], serviceIds: [ids.serviceA] };
    let professionalId;

    const eligiblePath = email => `/professionals/eligible-users?${new URLSearchParams({ email })}`;
    await t.test('HU-030 new reads require auth, independent permission and institutional context', async () => {
      for (const path of ['/professionals/administration', eligiblePath(target.email)]) {
        assert.equal((await request('GET', path, undefined, undefined, headers)).status, 401);
        assert.equal((await write('GET', path, undefined, target.token)).status, 403);
        assert.equal((await write('GET', path, undefined, admin.token, {})).status, 403);
        assert.equal((await write('GET', path, undefined, admin.token, { 'x-institution-id': ids.institutionB })).status, 403);
        assert.equal((await write('GET', path, undefined, branchOfficer.token, { ...headers, 'x-branch-id': ids.branchA1 })).status, 403);
      }
      for (const [code, path] of [['professionals.read', '/professionals/administration'], ['professionals.create', eligiblePath(target.email)]]) {
        const permission = await prisma.permission.findUniqueOrThrow({ where: { code } });
        await prisma.rolePermission.delete({ where: { roleId_permissionId: { roleId: ids.roleInstitution, permissionId: permission.id } } });
        try { assert.equal((await write('GET', path)).status, 403); }
        finally { await prisma.rolePermission.create({ data: { roleId: ids.roleInstitution, permissionId: permission.id } }); }
      }
    });
    await t.test('HU-030 list includes all statuses, excludes deleted/foreign and preserves public catalog', async () => {
      await prisma.professional.update({ where: { id: ids.professionalA3 }, data: { status: 'SUSPENDED' } });
      try {
        const response = await write('GET', '/professionals/administration');
        assert.equal(response.status, 200);
        assert.deepEqual([...new Set(response.body.data.map(p => p.status))].sort(), ['ACTIVE', 'INACTIVE', 'SUSPENDED']);
        assert.ok(!response.body.data.some(p => p.id === ids.professionalB));
        const row = response.body.data.find(p => p.id === ids.professionalA);
        assert.deepEqual(Object.keys(row).sort(), ['id', 'user', 'internalCode', 'titleOrFunction', 'description', 'status', 'createdAt', 'updatedAt', 'branchIds', 'serviceIds'].sort());
        assert.deepEqual(Object.keys(row.user).sort(), ['id', 'email', 'firstNames', 'lastNames'].sort());
        assert.deepEqual(row.branchIds, [...row.branchIds].sort());
        const publicResponse = await request('GET', '/professionals', target.token);
        assert.equal(publicResponse.status, 200);
        assert.ok(!publicResponse.body.data.some(p => [ids.professionalA3, ids.professionalInactive].includes(p.id)));
        await prisma.professional.update({ where: { id: ids.professionalA2 }, data: { deletedAt: new Date() } });
        try { assert.ok(!(await write('GET', '/professionals/administration')).body.data.some(p => p.id === ids.professionalA2)); }
        finally { await prisma.professional.update({ where: { id: ids.professionalA2 }, data: { deletedAt: null } }); }
      } finally { await prisma.professional.update({ where: { id: ids.professionalA3 }, data: { status: 'ACTIVE' } }); }
    });
    await t.test('HU-030 eligible search is exact, normalized and uniformly excludes unavailable accounts', async () => {
      const response = await write('GET', eligiblePath(` ${target.email.toUpperCase()} `));
      assert.equal(response.status, 200);
      assert.equal(response.body.data.id, target.id);
      assert.deepEqual(Object.keys(response.body.data).sort(), ['id', 'email', 'firstNames', 'lastNames'].sort());
      for (const path of ['/professionals/eligible-users', eligiblePath('partial'), `${eligiblePath(target.email)}&institutionId=${ids.institutionB}`,
        `${eligiblePath(target.email)}&limit=5`, `/professionals/administration?userId=${target.id}`]) assert.equal((await write('GET', path)).status, 400);
      const missing = await write('GET', eligiblePath(`absent-${randomUUID()}@example.test`));
      assert.equal(missing.status, 404);
      for (const data of [{ status: 'PENDING' }, { deletedAt: new Date() }]) {
        await prisma.user.update({ where: { id: target.id }, data });
        try { assert.deepEqual((await write('GET', eligiblePath(target.email))).body, missing.body); }
        finally { await prisma.user.update({ where: { id: target.id }, data: { status: 'ACTIVE', deletedAt: null } }); }
      }
      assert.deepEqual((await write('GET', eligiblePath(admin.email))).body, missing.body);
      await prisma.professional.update({ where: { id: ids.professionalA }, data: { deletedAt: new Date(), status: 'INACTIVE' } });
      try { assert.deepEqual((await write('GET', eligiblePath(admin.email))).body, missing.body); }
      finally { await prisma.professional.update({ where: { id: ids.professionalA }, data: { deletedAt: null, status: 'ACTIVE' } }); }
      const foreign = await prisma.user.findUniqueOrThrow({ where: { id: ids.professionalBUser }, select: { email: true } });
      assert.equal((await write('GET', eligiblePath(foreign.email))).status, 200, 'User is global; foreign professional does not preclude own institution');
    });

    await t.test('auth, permissions, institution and branch-only scope are enforced', async () => {
      assert.equal((await request('POST', '/professionals', undefined, input, headers)).status, 401);
      assert.equal((await write('POST', '/professionals', input, target.token)).status, 403);
      assert.equal((await write('POST', '/professionals', input, admin.token, {})).status, 403);
      assert.equal((await write('POST', '/professionals', input, admin.token, { 'x-institution-id': ids.institutionB })).status, 403);
      assert.equal((await write('POST', '/professionals', input, branchOfficer.token, { ...headers, 'x-branch-id': ids.branchA1 })).status, 403);
      assert.equal((await write('POST', '/professionals', input, branchOfficer.token)).status, 403);
    });
    await t.test('invalid input, inactive user and foreign/inactive associations are rejected before creation', async () => {
      for (const body of [{ ...input, institutionId: ids.institutionB }, { ...input, branchIds: [] },
        { ...input, serviceIds: [ids.serviceA, ids.serviceA] }, { ...input, status: 'INVALID' }]) {
        assert.equal((await write('POST', '/professionals', body)).status, 400);
      }
      for (const body of [{ ...input, userId: ids.missing }, { ...input, branchIds: [ids.branchB1] },
        { ...input, serviceIds: [ids.serviceB] }, { ...input, branchIds: [ids.branchInactive] }, { ...input, serviceIds: [ids.serviceInactive] }]) {
        assert.equal((await write('POST', '/professionals', body)).status, 404);
      }
      await prisma.user.update({ where: { id: target.id }, data: { status: 'PENDING' } });
      try { assert.equal((await write('POST', '/professionals', input)).status, 404); }
      finally { await prisma.user.update({ where: { id: target.id }, data: { status: 'ACTIVE' } }); }
      assert.equal(await prisma.professional.count({ where: { institutionId: ids.institutionA, userId: target.id } }), 0);
    });
    await t.test('authorized creation persists exactly one professional with controlled DTO and associations', async () => {
      const response = await write('POST', '/professionals', input);
      assert.equal(response.status, 201);
      professionalId = response.body.data.id;
      assert.deepEqual(Object.keys(response.body.data).sort(), ['id', 'userId', 'internalCode', 'titleOrFunction', 'description', 'status', 'createdAt', 'updatedAt', 'branchIds', 'serviceIds'].sort());
      assert.equal(response.body.data.createdAt, new Date(response.body.data.createdAt).toISOString());
      const stored = await prisma.professional.findUniqueOrThrow({ where: { id: professionalId }, include: { branchAssignments: true, serviceAssignments: true } });
      assert.equal(stored.institutionId, ids.institutionA);
      assert.equal(stored.userId, target.id);
      assert.equal(stored.branchAssignments.length, 1);
      assert.equal(stored.serviceAssignments.length, 1);
      assert.equal(stored.branchAssignments[0].active, true);
      assert.equal(stored.serviceAssignments[0].serviceId, ids.serviceA);
    });
    await t.test('PATCH updates profile without changing identity and prevents IDOR and extra payload', async () => {
      const response = await write('PATCH', `/professionals/${professionalId}`, { titleOrFunction: 'Atención actualizada', status: 'SUSPENDED' });
      assert.equal(response.status, 200);
      assert.equal(response.body.data.status, 'SUSPENDED');
      assert.equal(response.body.data.userId, target.id);
      assert.equal((await write('PATCH', `/professionals/${professionalId}`, { status: 'ACTIVE' })).status, 200);
      for (const body of [{}, { userId: other.id }, { institutionId: ids.institutionB }, { deletedAt: null }]) {
        assert.equal((await write('PATCH', `/professionals/${professionalId}`, body)).status, 400);
      }
      assert.equal((await write('PATCH', `/professionals/${professionalId}?userId=${other.id}`, { status: 'ACTIVE' })).status, 400);
      assert.equal((await write('PATCH', '/professionals/bad', { status: 'ACTIVE' })).status, 400);
      assert.equal((await write('PATCH', `/professionals/${ids.professionalB}`, { status: 'INACTIVE' })).status, 404);
      assert.equal((await write('PATCH', `/professionals/${ids.missing}`, { status: 'INACTIVE' })).status, 404);
      assert.equal((await write('PATCH', `/professionals/${professionalId}`, { status: 'INACTIVE' }, other.token)).status, 403);
      assert.equal((await write('PATCH', `/professionals/${professionalId}`, { status: 'INACTIVE' }, branchOfficer.token, { ...headers, 'x-branch-id': ids.branchA1 })).status, 403);
    });
    const snapshot = () => prisma.professional.findUniqueOrThrow({ where: { id: professionalId }, include: {
      branchAssignments: { orderBy: { branchId: 'asc' } }, serviceAssignments: { orderBy: { serviceId: 'asc' } },
    } });
    await t.test('association replacement preserves rows, custom durations and original creation timestamps', async () => {
      await prisma.professionalService.update({ where: { professionalId_serviceId: { professionalId, serviceId: ids.serviceA } }, data: { customDurationMinutes: 45 } });
      const before = await snapshot();
      assert.equal((await write('PATCH', `/professionals/${professionalId}`, { branchIds: [ids.branchA2], serviceIds: [ids.serviceA2] })).status, 200);
      const after = await snapshot();
      assert.equal(after.branchAssignments.length, 2);
      assert.equal(after.serviceAssignments.length, 2);
      assert.equal(after.branchAssignments.find((item) => item.branchId === ids.branchA1).active, false);
      assert.equal(after.serviceAssignments.find((item) => item.serviceId === ids.serviceA).active, false);
      assert.equal((await write('PATCH', `/professionals/${professionalId}`, { branchIds: [ids.branchA1], serviceIds: [ids.serviceA] })).status, 200);
      const restored = await snapshot();
      assert.deepEqual(restored.serviceAssignments.find((item) => item.serviceId === ids.serviceA), before.serviceAssignments[0]);
      assert.deepEqual(restored.branchAssignments.find((item) => item.branchId === ids.branchA1), before.branchAssignments[0]);
      assert.equal((await write('PATCH', `/professionals/${professionalId}`, { branchIds: [ids.branchB1] })).status, 404);
      assert.equal((await write('PATCH', `/professionals/${professionalId}`, { serviceIds: [ids.serviceB] })).status, 404);
      assert.deepEqual(await snapshot(), restored);
    });
    await t.test('unique institutional user and code reject duplicates, including real concurrent creation', async () => {
      assert.equal((await write('POST', '/professionals', { ...input, internalCode: null })).status, 409);
      assert.equal((await write('POST', '/professionals', { ...input, userId: other.id })).status, 409);
      const racedInput = { ...input, userId: other.id, internalCode: `${FIXTURE_PREFIX}_HU013_RACE` };
      const responses = await Promise.all([write('POST', '/professionals', racedInput), write('POST', '/professionals', racedInput)]);
      assert.deepEqual(responses.map((response) => response.status).sort(), [201, 409]);
      const rows = await prisma.professional.findMany({ where: { institutionId: ids.institutionA, userId: other.id }, include: { branchAssignments: true, serviceAssignments: true } });
      assert.equal(rows.length, 1);
      assert.equal(rows[0].branchAssignments.length, 1);
      assert.equal(rows[0].serviceAssignments.length, 1);
      assert.equal((await write('PATCH', `/professionals/${rows[0].id}`, { internalCode: input.internalCode })).status, 409);
    });
    await t.test('concurrent equivalent association PATCH creates no duplicate rows', async () => {
      const patch = { branchIds: [ids.branchA1, ids.branchA2], serviceIds: [ids.serviceA, ids.serviceA2] };
      const responses = await Promise.all([write('PATCH', `/professionals/${professionalId}`, patch), write('PATCH', `/professionals/${professionalId}`, patch)]);
      assert.ok(responses.every((response) => [200, 409].includes(response.status)));
      assert.ok(responses.some((response) => response.status === 200));
      const stored = await snapshot();
      assert.equal(stored.branchAssignments.length, 2);
      assert.equal(stored.serviceAssignments.length, 2);
      assert.ok(stored.branchAssignments.every((item) => item.active));
      assert.ok(stored.serviceAssignments.every((item) => item.active));
    });
    await t.test('real SQL failure rolls back profile, timestamp and both association sets', async () => {
      const before = await snapshot();
      const transaction = prisma.$transaction.bind(prisma);
      prisma.$transaction = (work, options) => typeof work === 'function' ? transaction(async (tx) => work(new Proxy(tx, {
        get(target, key) {
          if (key !== 'professionalService') return target[key];
          return new Proxy(target.professionalService, { get(delegate, method) {
            if (method !== 'upsert') return delegate[method];
            return async (args) => { await delegate.upsert(args); throw new Error('HU013 injected private detail'); };
          } });
        },
      })), options) : transaction(work, options);
      try {
        const response = await write('PATCH', `/professionals/${professionalId}`, { titleOrFunction: 'Rollback', branchIds: [ids.branchA1], serviceIds: [ids.serviceA] });
        assert.equal(response.status, 500);
        assert.equal(JSON.stringify(response.body).includes('injected'), false);
      } finally { prisma.$transaction = transaction; }
      assert.deepEqual(await snapshot(), before);
    });
    await t.test('failure after nested creation rolls back the professional and initial associations', async () => {
      const transaction = prisma.$transaction.bind(prisma);
      let rolledBackId;
      prisma.$transaction = (work, options) => typeof work === 'function' ? transaction(async (tx) => work(new Proxy(tx, {
        get(target, key) {
          if (key !== 'professional') return target[key];
          return new Proxy(target.professional, { get(delegate, method) {
            if (method !== 'create') return delegate[method];
            return async (args) => {
              const created = await delegate.create(args);
              rolledBackId = created.id;
              throw new Error('HU013 injected after nested create');
            };
          } });
        },
      })), options) : transaction(work, options);
      try {
        const response = await write('POST', '/professionals', { ...input, userId: branchOfficer.id, internalCode: null });
        assert.equal(response.status, 500);
        assert.equal(JSON.stringify(response.body).includes('injected'), false);
      } finally { prisma.$transaction = transaction; }
      assert.ok(rolledBackId);
      assert.equal(await prisma.professional.count({ where: { id: rolledBackId } }), 0);
      assert.equal(await prisma.professionalBranch.count({ where: { professionalId: rolledBackId } }), 0);
      assert.equal(await prisma.professionalService.count({ where: { professionalId: rolledBackId } }), 0);
    });
    await t.test('professional deactivation/unassignment preserves appointments, history and materialized agenda', async () => {
      const booking = await request('POST', '/appointments', target.token, { agendaSlotId: ids.slotAvailable });
      assert.equal(booking.status, 201, 'Appointment status bootstrap required');
      const appointmentId = booking.body.data.id;
      const historical = async () => ({
        appointment: await prisma.appointment.findUniqueOrThrow({ where: { id: appointmentId }, include: { historyEntries: true } }),
        availability: await prisma.availability.findMany({ where: { professionalId: ids.professionalA }, orderBy: { id: 'asc' } }),
        slot: await prisma.agendaSlot.findUniqueOrThrow({ where: { id: ids.slotAvailable } }),
      });
      const before = await historical();
      assert.equal((await write('PATCH', `/professionals/${ids.professionalA}`, { status: 'INACTIVE', branchIds: [], serviceIds: [] })).status, 200);
      assert.deepEqual(await historical(), before);
      assert.equal((await request('GET', `/professionals/${ids.professionalA}`, target.token)).status, 404);
      const mine = await request('GET', '/appointments/me', target.token);
      assert.ok(mine.body.data.some((item) => item.id === appointmentId));
      assert.equal((await write('PATCH', `/professionals/${ids.professionalA}`, { status: 'ACTIVE', branchIds: [ids.branchA1], serviceIds: [ids.serviceA] })).status, 200);
      assert.deepEqual(await historical(), before);
    });
    await t.test('existing read-only professional and availability routes stay compatible', async () => {
      for (const path of ['/professionals', `/professionals/${professionalId}`, `/branches/${ids.branchA1}/professionals`,
        `/services/${ids.serviceA}/professionals`, `/branches/${ids.branchA1}/services/${ids.serviceA}/professionals`,
        `/branches/${ids.branchA1}/services/${ids.serviceA}/availability?${new URLSearchParams(range)}`]) {
        const response = await request('GET', path, target.token);
        assert.equal(response.status, 200, path);
        assert.ok(response.body.data);
      }
      const listing = await request('GET', '/professionals', target.token);
      assert.ok(listing.body.data.some((item) => item.id === professionalId));
      const publicDto = listing.body.data.find((item) => item.id === professionalId);
      for (const field of ['userId', 'deletedAt', 'passwordHash', 'email']) assert.equal(Object.hasOwn(publicDto, field), false);
    });
  } finally {
    try {
      if (prisma && cleanupEnabled) {
        await cleanupCheckpointFixtures(prisma);
        await prisma.permission.deleteMany({ where: { id: { in: permissionsCreated } } });
        await assertCheckpointIsClean(prisma);
      }
    } finally { await app.close(); }
  }
});
