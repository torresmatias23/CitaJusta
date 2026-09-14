import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { NestFactory } from '@nestjs/core';
import { loadApiEnvironment, assertSafeLocalDatabaseUrl, getE2ePort } from './local-environment.mjs';
import { FIXTURE_EMAIL_PREFIX, FIXTURE_PREFIX, ids, cleanupCheckpointFixtures,
  createCheckpointFixtures, assertCheckpointIsClean } from './fixture.mjs';

test('HU-012 catalog administration with real HTTP and PostgreSQL', { timeout: 120_000 }, async (t) => {
  loadApiEnvironment();
  assertSafeLocalDatabaseUrl(process.env.DATABASE_URL);
  process.env.NODE_ENV = 'test';
  const [{ AppModule }, { configureApplication }, { PrismaService }] = await Promise.all([
    import('../../dist/app.module.js'), import('../../dist/app.configuration.js'), import('../../dist/database/prisma.service.js'),
  ]);
  const app = await NestFactory.create(AppModule, { logger: false });
  const marker = `${FIXTURE_PREFIX}_${randomUUID().slice(0, 8)}`;
  const createdPermissionIds = [];
  let prisma;
  let cleanupEnabled = false;
  let waitlistId;
  let priorityId;
  try {
    configureApplication(app);
    await app.listen(getE2ePort(), '127.0.0.1');
    const baseUrl = `http://127.0.0.1:${app.getHttpServer().address().port}/api/v1`;
    prisma = app.get(PrismaService);
    await cleanupCheckpointFixtures(prisma);
    cleanupEnabled = true;

    async function request(method, path, token, body, headers = {}) {
      const response = await fetch(`${baseUrl}${path}`, {
        method, headers: {
          ...(token ? { authorization: `Bearer ${token}` } : {}),
          ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers,
        }, body: body === undefined ? undefined : JSON.stringify(body),
      });
      return { status: response.status, body: await response.json() };
    }
    async function register() {
      const body = { email: `${FIXTURE_EMAIL_PREFIX}${randomUUID()}@example.com`,
        password: `E2e-${randomUUID()}-Aa1!`, firstName: 'Catalog', lastName: 'Checkpoint' };
      const registered = await request('POST', '/auth/register', undefined, body);
      assert.equal(registered.status, 201);
      const login = await request('POST', '/auth/login', undefined, { email: body.email, password: body.password });
      assert.equal(login.status, 200);
      return { id: registered.body.id, token: login.body.accessToken };
    }
    const admin = await register();
    const ordinary = await register();
    const branchOfficer = await register();
    const range = await createCheckpointFixtures(prisma, admin.id);
    for (const code of ['branches.create', 'branches.update', 'services.create', 'services.update']) {
      let permission = await prisma.permission.findUnique({ where: { code } });
      if (!permission) {
        const [module, action] = code.split('.');
        permission = await prisma.permission.create({ data: { id: randomUUID(), code, module, action } });
        createdPermissionIds.push(permission.id);
      }
      await prisma.rolePermission.createMany({ data: [ids.roleInstitution, ids.roleBranch].map((roleId) => ({ roleId, permissionId: permission.id })) });
    }
    await prisma.userRole.create({ data: {
      id: randomUUID(), userId: branchOfficer.id, roleId: ids.roleBranch,
      institutionId: ids.institutionA, branchId: ids.branchA1,
    } });
    const institutionHeaders = { 'x-institution-id': ids.institutionA };
    const branchHeaders = { ...institutionHeaders, 'x-branch-id': ids.branchA1 };
    const write = (method, path, body, token = admin.token, headers = institutionHeaders) => request(method, path, token, body, headers);
    const branchBody = { code: `${marker}_BR`, name: 'Sucursal central', municipality: 'Santiago', latitude: -33.1234567, longitude: -70.1234567 };
    const serviceBody = { code: `${marker}_SV`, name: 'Atención general', durationMinutes: 30, categoryId: ids.categoryActive };
    let newBranch;
    let newService;

    await t.test('authentication, explicit permission and institution context are mandatory', async () => {
      for (const [path, body] of [['/branches', branchBody], ['/services', serviceBody]]) {
        assert.equal((await request('POST', path, undefined, body, institutionHeaders)).status, 401);
        assert.equal((await write('POST', path, body, ordinary.token)).status, 403);
        assert.equal((await write('POST', path, body, admin.token, {})).status, 403);
        assert.equal((await write('POST', path, body, admin.token, { 'x-institution-id': ids.institutionB })).status, 403);
      }
    });

    await t.test('authorized branch creation and edit return a controlled DTO', async () => {
      const response = await write('POST', '/branches', branchBody);
      assert.equal(response.status, 201);
      newBranch = response.body.data.id;
      assert.deepEqual(Object.keys(response.body.data).sort(), [
        'id', 'code', 'name', 'addressLine1', 'addressLine2', 'municipality', 'region', 'country',
        'latitude', 'longitude', 'phone', 'email', 'status',
      ].sort());
      assert.equal(response.body.data.latitude, '-33.1234567');
      const updated = await write('PATCH', `/branches/${newBranch}`, { name: 'Sucursal actualizada', phone: '123456', status: 'INACTIVE' });
      assert.equal(updated.status, 200);
      assert.equal(updated.body.data.status, 'INACTIVE');
      assert.equal((await write('PATCH', `/branches/${newBranch}`, { status: 'ACTIVE' })).status, 200);
      const stored = await prisma.branch.findUniqueOrThrow({ where: { id: newBranch } });
      assert.equal(stored.institutionId, ids.institutionA);
      assert.equal(stored.name, 'Sucursal actualizada');
    });

    await t.test('cross-tenant and branch scope cannot escape authorization', async () => {
      assert.equal((await write('PATCH', `/branches/${ids.branchB1}`, { name: 'No' })).status, 404);
      assert.equal((await write('PATCH', `/branches/${ids.missing}`, { name: 'No' })).status, 404);
      assert.equal((await write('PATCH', `/branches/${ids.branchA1}`, { phone: '123' }, branchOfficer.token, branchHeaders)).status, 200);
      assert.equal((await write('PATCH', `/branches/${ids.branchA2}`, { phone: '123' }, branchOfficer.token, branchHeaders)).status, 404);
      assert.equal((await write('PATCH', `/branches/${ids.branchA1}`, { phone: '123' }, ordinary.token)).status, 403);
      for (const [path, body] of [['/branches', branchBody], ['/services', serviceBody]]) {
        assert.equal((await write('POST', path, body, branchOfficer.token, branchHeaders)).status, 403);
        assert.equal((await write('POST', path, body, branchOfficer.token)).status, 403);
      }
      assert.equal((await write('PATCH', `/services/${ids.serviceA}`, { active: false }, branchOfficer.token, branchHeaders)).status, 403);
    });

    await t.test('invalid inputs and foreign relations never create catalog records', async () => {
      const before = await prisma.service.count({ where: { institutionId: ids.institutionA } });
      for (const body of [{ ...serviceBody, institutionId: ids.institutionB }, { ...serviceBody, durationMinutes: 0 },
        { ...serviceBody, active: 'false' }, { ...serviceBody, branchIds: [newBranch, newBranch] },
        { ...serviceBody, minimumAdvanceMinutes: 1441, maximumAdvanceDays: 1 }]) {
        assert.equal((await write('POST', '/services', body)).status, 400);
      }
      assert.equal((await write('POST', '/services', { ...serviceBody, branchIds: [ids.branchB1] })).status, 404);
      assert.equal((await write('POST', '/services', { ...serviceBody, branchIds: [ids.branchInactive] })).status, 404);
      assert.equal((await write('POST', '/services', { ...serviceBody, categoryId: ids.categoryInactive })).status, 404);
      assert.equal((await write('POST', '/services', { ...serviceBody, categoryId: ids.missing })).status, 404);
      assert.equal((await write('POST', '/branches', { ...branchBody, institutionId: ids.institutionB })).status, 400);
      assert.equal((await write('PATCH', `/branches/${newBranch}`, {})).status, 400);
      assert.equal((await write('PATCH', '/branches/invalid', { name: 'No' })).status, 400);
      assert.equal((await write('PATCH', `/branches/${newBranch}?userId=${ordinary.id}`, { name: 'No' })).status, 400);
      assert.equal(await prisma.service.count({ where: { institutionId: ids.institutionA } }), before);
    });

    await t.test('service create/edit/activate/deactivate and branch assignments persist', async () => {
      const response = await write('POST', '/services', { ...serviceBody, branchIds: [newBranch] });
      assert.equal(response.status, 201);
      newService = response.body.data.id;
      assert.deepEqual(Object.keys(response.body.data).sort(), ['id', 'code', 'name', 'description', 'categoryId', 'durationMinutes',
        'minimumAdvanceMinutes', 'maximumAdvanceDays', 'allowsWaitlist', 'requiresConfirmation', 'active', 'branchIds'].sort());
      assert.equal((await prisma.service.findUniqueOrThrow({ where: { id: newService } })).institutionId, ids.institutionA);
      const edit = await write('PATCH', `/services/${newService}`, { name: 'Atención modificada', durationMinutes: 45, branchIds: [ids.branchA1] });
      assert.equal(edit.status, 200);
      assert.deepEqual(edit.body.data.branchIds, [ids.branchA1]);
      assert.equal((await prisma.serviceBranch.findUniqueOrThrow({ where: { serviceId_branchId: { serviceId: newService, branchId: newBranch } } })).active, false);
      assert.equal((await write('PATCH', `/services/${newService}`, { active: false })).body.data.active, false);
      assert.equal((await write('PATCH', `/services/${newService}`, { active: true })).body.data.active, true);
      assert.equal((await write('PATCH', `/services/${ids.serviceB}`, { active: false })).status, 404);
      assert.equal((await write('PATCH', `/services/${ids.missing}`, { active: false })).status, 404);
      assert.equal((await write('PATCH', `/services/${newService}`, { active: false }, ordinary.token)).status, 403);
    });

    await t.test('unique codes are protected on create/edit and simultaneous creation', async () => {
      assert.equal((await write('POST', '/branches', branchBody)).status, 409);
      assert.equal((await write('POST', '/services', serviceBody)).status, 409);
      const existingCode = (await prisma.service.findUniqueOrThrow({ where: { id: ids.serviceA } })).code;
      assert.equal((await write('PATCH', `/services/${newService}`, { code: existingCode })).status, 409);
      const concurrent = { code: `${marker}_RACE`, name: 'Sucursal concurrencia' };
      const results = await Promise.all([write('POST', '/branches', concurrent), write('POST', '/branches', concurrent)]);
      assert.deepEqual(results.map((result) => result.status).sort(), [201, 409]);
      assert.equal(await prisma.branch.count({ where: { institutionId: ids.institutionA, code: concurrent.code } }), 1);
    });

    await t.test('foreign category and assignment PATCH fail atomically', async () => {
      const before = await prisma.service.findUniqueOrThrow({ where: { id: newService }, include: { branchAssignments: true } });
      const foreignCategoryId = randomUUID();
      await prisma.serviceCategory.create({ data: { id: foreignCategoryId, institutionId: ids.institutionB, name: marker } });
      try {
        assert.equal((await write('PATCH', `/services/${newService}`, { name: 'No', categoryId: foreignCategoryId })).status, 404);
        assert.equal((await write('PATCH', `/services/${newService}`, { name: 'No', branchIds: [newBranch, ids.branchB1] })).status, 404);
        assert.deepEqual(await prisma.service.findUniqueOrThrow({ where: { id: newService }, include: { branchAssignments: true } }), before);
      } finally { await prisma.serviceCategory.delete({ where: { id: foreignCategoryId } }); }
    });

    await t.test('failure after an actual intermediate SQL write rolls back service and assignments', async () => {
      const before = await prisma.service.findUniqueOrThrow({ where: { id: newService }, include: { branchAssignments: { orderBy: { branchId: 'asc' } } } });
      const transaction = prisma.$transaction.bind(prisma);
      prisma.$transaction = (work, options) => typeof work === 'function' ? transaction(async (tx) => {
        const proxy = new Proxy(tx, { get(target, key) {
          if (key !== 'serviceBranch') return target[key];
          return new Proxy(target.serviceBranch, { get(delegate, method) {
            if (method !== 'upsert') return delegate[method];
            return async (args) => { await delegate.upsert(args); throw new Error('HU012 injected private SQL detail'); };
          } });
        } });
        return work(proxy);
      }, options) : transaction(work, options);
      try {
        const response = await write('PATCH', `/services/${newService}`, { name: 'Must rollback', branchIds: [newBranch] });
        assert.equal(response.status, 500);
        assert.equal(JSON.stringify(response.body).includes('injected'), false);
      } finally { prisma.$transaction = transaction; }
      assert.deepEqual(await prisma.service.findUniqueOrThrow({ where: { id: newService }, include: { branchAssignments: { orderBy: { branchId: 'asc' } } } }), before);
    });

    await t.test('service deactivation keeps appointment/history/waitlist/agenda/professional records and historical reads', async () => {
      const booking = await request('POST', '/appointments', ordinary.token, { agendaSlotId: ids.slotAvailable });
      assert.equal(booking.status, 201, 'Provision appointment status before E2E');
      const appointmentId = booking.body.data.id;
      const active = await prisma.waitlistStatus.findUniqueOrThrow({ where: { code: 'ACTIVE' } });
      priorityId = randomUUID();
      await prisma.priority.create({ data: { id: priorityId, institutionId: ids.institutionA, code: 'STANDARD', name: marker, level: 0 } });
      const waitlist = await request('POST', '/waitlist', ordinary.token, { serviceId: ids.serviceA, branchId: ids.branchA1 });
      assert.equal(waitlist.status, 201);
      waitlistId = waitlist.body.data.id;
      assert.equal((await prisma.waitlistEntry.findUniqueOrThrow({ where: { id: waitlistId } })).statusId, active.id);
      const snapshot = async () => ({
        appointment: await prisma.appointment.findUniqueOrThrow({ where: { id: appointmentId }, include: { historyEntries: true } }),
        slot: await prisma.agendaSlot.findUniqueOrThrow({ where: { id: ids.slotAvailable } }),
        waitlist: await prisma.waitlistEntry.findUniqueOrThrow({ where: { id: waitlistId } }),
        availability: await prisma.availability.findMany({ where: { serviceId: ids.serviceA }, orderBy: { id: 'asc' } }),
        professional: await prisma.professionalService.findMany({ where: { serviceId: ids.serviceA }, orderBy: { professionalId: 'asc' } }),
        assignments: await prisma.serviceBranch.findMany({ where: { serviceId: ids.serviceA }, orderBy: { branchId: 'asc' } }),
      });
      const before = await snapshot();
      assert.equal((await write('PATCH', `/services/${ids.serviceA}`, { active: false })).status, 200);
      assert.deepEqual(await snapshot(), before);
      const mine = await request('GET', '/appointments/me', ordinary.token);
      assert.ok(mine.body.data.some((item) => item.id === appointmentId));
      const waiting = await request('GET', '/waitlist', ordinary.token);
      assert.ok(waiting.body.data.some((item) => item.id === waitlistId));
      assert.equal((await request('GET', `/services/${ids.serviceA}`, ordinary.token)).status, 404);
      assert.equal((await request('GET', `/branches/${ids.branchA1}/services/${ids.serviceA}/availability?${new URLSearchParams(range)}`, ordinary.token)).status, 404);
      assert.equal((await write('PATCH', `/services/${ids.serviceA}`, { active: true })).status, 200);
      assert.deepEqual(await snapshot(), before);
    });

    await t.test('read-only institution/branch/service/availability endpoints retain their contract', async () => {
      for (const path of ['/institutions', `/institutions/${ids.institutionA}/branches`, '/services',
        `/services/${newService}`, `/branches/${ids.branchA1}/services`,
        `/branches/${ids.branchA1}/services/${ids.serviceA}/availability?${new URLSearchParams(range)}`]) {
        const response = await request('GET', path, ordinary.token);
        assert.equal(response.status, 200, path);
        assert.ok(response.body.data);
      }
      const publicService = (await request('GET', '/services', ordinary.token)).body.data.find((service) => service.id === newService);
      assert.deepEqual(Object.keys(publicService).sort(), ['id', 'code', 'name', 'description', 'durationMinutes', 'institution', 'category'].sort());
    });
  } finally {
    try {
      if (prisma && cleanupEnabled) {
        if (waitlistId) await prisma.waitlistEntry.delete({ where: { id: waitlistId } });
        if (priorityId) await prisma.priority.delete({ where: { id: priorityId } });
        const extraServices = await prisma.service.findMany({ where: { institutionId: ids.institutionA, code: { startsWith: marker } }, select: { id: true } });
        await prisma.serviceBranch.deleteMany({ where: { serviceId: { in: extraServices.map((service) => service.id) } } });
        await prisma.service.deleteMany({ where: { id: { in: extraServices.map((service) => service.id) } } });
        await prisma.branch.deleteMany({ where: { institutionId: ids.institutionA, code: { startsWith: marker } } });
        await cleanupCheckpointFixtures(prisma);
        await prisma.permission.deleteMany({ where: { id: { in: createdPermissionIds } } });
        await assertCheckpointIsClean(prisma);
      }
    } finally { await app.close(); }
  }
});
