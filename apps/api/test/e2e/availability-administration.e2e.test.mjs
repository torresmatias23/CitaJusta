import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { NestFactory } from '@nestjs/core';
import { loadApiEnvironment, assertSafeLocalDatabaseUrl, getE2ePort } from './local-environment.mjs';
import { FIXTURE_EMAIL_PREFIX, ids, cleanupCheckpointFixtures, createCheckpointFixtures, assertCheckpointIsClean } from './fixture.mjs';

function at(day, hour, minute = 0) {
  const date = new Date(); date.setUTCDate(date.getUTCDate() + day); date.setUTCHours(hour, minute, 0, 0); return date.toISOString();
}

test('HU-014 real PostgreSQL availability, blocking and booking concurrency', { timeout: 120_000 }, async (t) => {
  loadApiEnvironment(); assertSafeLocalDatabaseUrl(process.env.DATABASE_URL); process.env.NODE_ENV = 'test';
  const [{ AppModule }, { configureApplication }, { PrismaService }] = await Promise.all([
    import('../../dist/app.module.js'), import('../../dist/app.configuration.js'), import('../../dist/database/prisma.service.js'),
  ]);
  const app = await NestFactory.create(AppModule, { logger: false });
  let prisma; let cleanupEnabled = false;
  const createdPermissions = []; const blocks = []; const newSlots = [];
  try {
    configureApplication(app); await app.listen(getE2ePort(), '127.0.0.1');
    prisma = app.get(PrismaService); await cleanupCheckpointFixtures(prisma); cleanupEnabled = true;
    const base = `http://127.0.0.1:${app.getHttpServer().address().port}/api/v1`;
    async function request(method, path, token, body, headers = {}) {
      const response = await fetch(`${base}${path}`, { method, headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers,
      }, body: body === undefined ? undefined : JSON.stringify(body) });
      return { status: response.status, body: await response.json() };
    }
    async function register() {
      const body = { email: `${FIXTURE_EMAIL_PREFIX}${randomUUID()}@example.com`, password: `E2e-${randomUUID()}-Aa1!`, firstName: 'Agenda', lastName: 'Checkpoint' };
      const registered = await request('POST', '/auth/register', undefined, body); assert.equal(registered.status, 201);
      const login = await request('POST', '/auth/login', undefined, { email: body.email, password: body.password }); assert.equal(login.status, 200);
      return { id: registered.body.id, token: login.body.accessToken };
    }
    const admin = await register(); const ordinary = await register(); const officer = await register();
    await createCheckpointFixtures(prisma, admin.id);
    for (const action of ['create', 'update', 'block']) {
      const code = `availability.${action}`;
      let permission = await prisma.permission.findUnique({ where: { code } });
      if (!permission) { permission = await prisma.permission.create({ data: { id: randomUUID(), code, module: 'availability', action } }); createdPermissions.push(permission.id); }
      await prisma.rolePermission.createMany({ data: [ids.roleInstitution, ids.roleBranch].map((roleId) => ({ roleId, permissionId: permission.id })) });
    }
    await prisma.userRole.create({ data: { id: randomUUID(), userId: officer.id, roleId: ids.roleBranch, institutionId: ids.institutionA, branchId: ids.branchA1 } });
    const headers = { 'x-institution-id': ids.institutionA };
    const scope = { ...headers, 'x-branch-id': ids.branchA1 };
    const input = { branchId: ids.branchA1, professionalId: ids.professionalA, serviceId: ids.serviceA, startsAt: at(10, 15), endsAt: at(10, 16) };
    async function write(method, path, body, token = admin.token, context = headers) {
      const result = await request(method, path, token, body, context);
      if (result.status < 300 && result.body.data?.slots) newSlots.push(...result.body.data.slots.map((slot) => slot.id));
      if (path === '/availability/blocks' && result.status === 201) blocks.push(result.body.data.id);
      return result;
    }
    const create = (body) => write('POST', '/availability', body);
    const block = (body) => write('POST', '/availability/blocks', body);
    const book = (slotId) => request('POST', '/appointments', ordinary.token, { agendaSlotId: slotId });
    const available = (body) => request('GET', `/branches/${body.branchId}/services/${body.serviceId}/availability?${new URLSearchParams({ from: body.startsAt, to: body.endsAt })}`, ordinary.token);
    let first;

    await t.test('auth, permissions, invalid input and cross-tenant resource/context checks', async () => {
      assert.equal((await request('POST', '/availability', undefined, input, headers)).status, 401);
      assert.equal((await write('POST', '/availability', input, ordinary.token)).status, 403);
      for (const body of [{ ...input, institutionId: ids.institutionB }, { ...input, endsAt: input.startsAt },
        { ...input, startsAt: at(-1, 15) }, { ...input, professionalId: 'invalid' }, { ...input, endsAt: at(10, 15, 45) }]) {
        assert.equal((await create(body)).status, 400);
      }
      for (const body of [{ ...input, professionalId: ids.professionalB }, { ...input, branchId: ids.branchB1 },
        { ...input, serviceId: ids.serviceB }, { ...input, attentionPointId: ids.attentionPointInactive }]) assert.equal((await create(body)).status, 404);
      assert.equal((await write('POST', '/availability', input, admin.token, { 'x-institution-id': ids.institutionB })).status, 403);
      assert.equal((await write('POST', '/availability', { ...input, branchId: ids.branchA2 }, officer.token, scope)).status, 404);
    });
    await t.test('active professional/branch/service associations are required', async () => {
      for (const [model, where] of [
        ['professionalBranch', { professionalId_branchId: { professionalId: ids.professionalA, branchId: ids.branchA1 } }],
        ['professionalService', { professionalId_serviceId: { professionalId: ids.professionalA, serviceId: ids.serviceA } }],
        ['serviceBranch', { serviceId_branchId: { serviceId: ids.serviceA, branchId: ids.branchA1 } }],
      ]) {
        await prisma[model].update({ where, data: { active: false } });
        try { assert.equal((await create(input)).status, 404); }
        finally { await prisma[model].update({ where, data: { active: true } }); }
      }
    });
    await t.test('authorized branch officer configures materialized slots visible through existing GET', async () => {
      const response = await write('POST', '/availability', input, officer.token, scope);
      assert.equal(response.status, 201); first = response.body.data;
      assert.equal(first.slots.length, 2); assert.ok(first.slots.every((slot) => slot.status === 'AVAILABLE'));
      const listing = await available(input); assert.equal(listing.status, 200);
      assert.ok(first.slots.every((slot) => JSON.stringify(listing.body.data).includes(slot.id)));
      assert.equal(Object.hasOwn(first, 'institutionId'), false);
      assert.equal(Object.hasOwn(first.slots[0], 'lockVersion'), false);
      const stored = await prisma.availability.findUniqueOrThrow({ where: { id: first.id } });
      assert.equal(stored.origin, 'MANUAL'); assert.equal(stored.capacity, 1);
    });
    await t.test('equivalent/overlapping availability is rejected; adjacent interval is accepted', async () => {
      assert.equal((await create(input)).status, 409);
      assert.equal((await create({ ...input, startsAt: at(10, 15, 30), endsAt: at(10, 16, 30) })).status, 409);
      assert.equal((await create({ ...input, startsAt: at(10, 16), endsAt: at(10, 17) })).status, 201);
    });
    await t.test('create -> query -> block -> unavailable -> booking conflict, with one version increment', async () => {
      const response = await block({ branchId: input.branchId, professionalId: input.professionalId, startsAt: input.startsAt, endsAt: input.endsAt });
      assert.equal(response.status, 201);
      const stored = await prisma.scheduleBlock.findUniqueOrThrow({ where: { id: response.body.data.id } });
      assert.equal(stored.createdByUserId, admin.id); assert.equal(stored.institutionId, ids.institutionA);
      const listing = await available(input);
      for (const slot of first.slots) {
        assert.equal(JSON.stringify(listing.body.data).includes(slot.id), false);
        assert.equal((await book(slot.id)).status, 409);
        const row = await prisma.agendaSlot.findUniqueOrThrow({ where: { id: slot.id } });
        assert.equal(row.status, 'BLOCKED'); assert.equal(row.lockVersion, 1);
      }
      assert.equal((await block({ branchId: input.branchId, professionalId: input.professionalId, startsAt: input.startsAt, endsAt: input.endsAt })).status, 409);
      assert.equal((await write('PATCH', `/availability/${first.id}`, { active: false })).status, 409);
    });
    await t.test('block before availability prevents later materialization from bypassing it', async () => {
      const body = { ...input, startsAt: at(11, 15), endsAt: at(11, 16) };
      assert.equal((await block({ branchId: body.branchId, startsAt: body.startsAt, endsAt: body.endsAt })).status, 201);
      const created = await create(body); assert.equal(created.status, 201);
      assert.ok(created.body.data.slots.every((slot) => slot.status === 'BLOCKED'));
      assert.equal((await book(created.body.data.slots[0].id)).status, 409);
    });
    await t.test('PATCH retires old slots without deletion, deactivates and explicitly reactivates', async () => {
      const body = { ...input, startsAt: at(12, 15), endsAt: at(12, 16) };
      const created = await create(body); assert.equal(created.status, 201);
      const id = created.body.data.id;
      const patch = { startsAt: at(12, 17), endsAt: at(12, 18) };
      const edited = await write('PATCH', `/availability/${id}`, patch); assert.equal(edited.status, 200);
      for (const slot of created.body.data.slots) {
        assert.equal((await prisma.agendaSlot.findUniqueOrThrow({ where: { id: slot.id } })).status, 'EXPIRED');
        assert.equal((await book(slot.id)).status, 409);
      }
      assert.equal((await write('PATCH', `/availability/${id}`, { active: false })).status, 200);
      assert.equal((await write('PATCH', `/availability/${id}`, { ...patch, active: true })).status, 200);
      assert.equal((await write('PATCH', `/availability/${id}`, {})).status, 400);
      assert.equal((await write('PATCH', `/availability/${id}`, { professionalId: ids.professionalB })).status, 400);
      assert.equal((await write('PATCH', `/availability/${ids.availabilityOtherContext}`, patch, officer.token, scope)).status, 404);
      assert.equal((await write('PATCH', `/availability/${ids.availabilityCrossTenant}`, patch)).status, 404);
    });
    await t.test('compatible resource overlap honors capacity instead of rejecting all intersections', async () => {
      await prisma.attentionPoint.update({ where: { id: ids.attentionPointActive }, data: { capacity: 2 } });
      await prisma.professionalBranch.upsert({ where: { professionalId_branchId: { professionalId: ids.professionalA2, branchId: ids.branchA1 } }, create: { professionalId: ids.professionalA2, branchId: ids.branchA1 }, update: { active: true } });
      await prisma.professionalService.upsert({ where: { professionalId_serviceId: { professionalId: ids.professionalA3, serviceId: ids.serviceA } }, create: { professionalId: ids.professionalA3, serviceId: ids.serviceA }, update: { active: true } });
      const body = { ...input, startsAt: at(13, 15), endsAt: at(13, 16), attentionPointId: ids.attentionPointActive };
      assert.equal((await create(body)).status, 201);
      assert.equal((await create({ ...body, professionalId: ids.professionalA2 })).status, 201);
      assert.equal((await create({ ...body, professionalId: ids.professionalA3 })).status, 409);
    });
    await t.test('two equivalent availability requests yield one 201, one 409 and a single interval', async () => {
      const body = { ...input, startsAt: at(14, 15), endsAt: at(14, 16) };
      const result = await Promise.all([create(body), create(body)]);
      assert.deepEqual(result.map((r) => r.status).sort(), [201, 409]);
      const winner = result.find((r) => r.status === 201).body.data;
      assert.equal(await prisma.availability.count({ where: { professionalId: input.professionalId, date: new Date(`${winner.date}T00:00:00Z`) } }), 1);
      assert.equal(await prisma.agendaSlot.count({ where: { availabilityId: winner.id } }), 2);
    });
    await t.test('equivalent concurrent blocks persist once and do not double-increment slots', async () => {
      const body = { ...input, startsAt: at(15, 15), endsAt: at(15, 16) };
      const created = await create(body); assert.equal(created.status, 201);
      const payload = { branchId: body.branchId, professionalId: body.professionalId, startsAt: body.startsAt, endsAt: body.endsAt };
      const results = await Promise.all([block(payload), block(payload)]);
      assert.deepEqual(results.map((r) => r.status).sort(), [201, 409]);
      assert.equal(await prisma.scheduleBlock.count({ where: { branchId: body.branchId, startsAt: new Date(body.startsAt), endsAt: new Date(body.endsAt) } }), 1);
      for (const slot of created.body.data.slots) assert.equal((await prisma.agendaSlot.findUniqueOrThrow({ where: { id: slot.id } })).lockVersion, 1);
    });
    await t.test('booking versus blocking cannot both succeed or leave inconsistent state', async () => {
      const body = { ...input, startsAt: at(16, 15), endsAt: at(16, 16) };
      const created = await create(body); assert.equal(created.status, 201);
      const slot = created.body.data.slots[0];
      // Force both transactions to read AVAILABLE before the block wins the SQL write.
      const transaction = prisma.$transaction.bind(prisma);
      const bookingReady = Promise.withResolvers();
      const blockWritten = Promise.withResolvers();
      prisma.$transaction = (work, options) => typeof work === 'function' ? transaction(async (tx) => work(new Proxy(tx, { get(target, key) {
        if (key !== 'agendaSlot') return target[key];
        return new Proxy(target.agendaSlot, { get(delegate, method) {
          if (method !== 'updateMany') return delegate[method];
          return async (args) => {
            if (args.where.id !== slot.id) return delegate.updateMany(args);
            if (args.data.status === 'RESERVED') { bookingReady.resolve(); await blockWritten.promise; }
            if (args.data.status === 'BLOCKED') {
              await bookingReady.promise;
              try { return await delegate.updateMany(args); } finally { blockWritten.resolve(); }
            }
            return delegate.updateMany(args);
          };
        } });
      } })), options) : transaction(work, options);
      let booked; let blocked;
      try {
        [booked, blocked] = await Promise.all([book(slot.id), block({ branchId: body.branchId, professionalId: body.professionalId, startsAt: slot.startsAt, endsAt: slot.endsAt })]);
      } finally { prisma.$transaction = transaction; }
      assert.deepEqual([booked.status, blocked.status].sort(), [201, 409]);
      const stored = await prisma.agendaSlot.findUniqueOrThrow({ where: { id: slot.id } });
      const appointments = await prisma.appointment.count({ where: { agendaSlotId: slot.id } });
      assert.equal(appointments, booked.status === 201 ? 1 : 0);
      assert.equal(stored.status, booked.status === 201 ? 'RESERVED' : 'BLOCKED');
    });
    await t.test('existing appointments/history are never silently cancelled or destroyed', async () => {
      const body = { ...input, startsAt: at(17, 15), endsAt: at(17, 16) };
      const created = await create(body); const slot = created.body.data.slots[0];
      const booked = await book(slot.id); assert.equal(booked.status, 201);
      const where = { id: booked.body.data.id };
      const before = await prisma.appointment.findUniqueOrThrow({ where, include: { historyEntries: true } });
      assert.equal((await block({ branchId: body.branchId, startsAt: slot.startsAt, endsAt: slot.endsAt })).status, 409);
      assert.equal((await write('PATCH', `/availability/${created.body.data.id}`, { active: false })).status, 409);
      assert.deepEqual(await prisma.appointment.findUniqueOrThrow({ where, include: { historyEntries: true } }), before);
    });
    await t.test('SQL failure after block INSERT and slot UPDATE rolls back both', async () => {
      const body = { ...input, startsAt: at(18, 15), endsAt: at(18, 16) };
      const created = await create(body); const slotId = created.body.data.slots[0].id;
      const before = await prisma.agendaSlot.findUniqueOrThrow({ where: { id: slotId } });
      const transaction = prisma.$transaction.bind(prisma);
      prisma.$transaction = (work, options) => typeof work === 'function' ? transaction(async (tx) => work(new Proxy(tx, { get(target, key) {
        if (key !== 'agendaSlot') return target[key];
        return new Proxy(target.agendaSlot, { get(delegate, method) {
          if (method !== 'updateMany') return delegate[method];
          return async (args) => { await delegate.updateMany(args); throw new Error('HU014 private injected failure'); };
        } });
      } })), options) : transaction(work, options);
      try {
        const result = await block({ branchId: body.branchId, startsAt: body.startsAt, endsAt: body.endsAt });
        assert.equal(result.status, 500); assert.equal(JSON.stringify(result.body).includes('private'), false);
      } finally { prisma.$transaction = transaction; }
      assert.deepEqual(await prisma.agendaSlot.findUniqueOrThrow({ where: { id: slotId } }), before);
      assert.equal(await prisma.scheduleBlock.count({ where: { branchId: body.branchId, startsAt: new Date(body.startsAt) } }), 0);
    });
    await t.test('SQL failure during materialization rolls back availability and every new slot', async () => {
      const body = { ...input, startsAt: at(19, 15), endsAt: at(19, 16) };
      const before = await prisma.availability.count({ where: { professionalId: input.professionalId } });
      const transaction = prisma.$transaction.bind(prisma);
      let insertedSlot;
      prisma.$transaction = (work, options) => typeof work === 'function' ? transaction(async (tx) => work(new Proxy(tx, { get(target, key) {
        if (key !== 'agendaSlot') return target[key];
        return new Proxy(target.agendaSlot, { get(delegate, method) {
          if (method !== 'upsert') return delegate[method];
          return async (args) => { insertedSlot = (await delegate.upsert(args)).id; throw new Error('HU014 injected materialization failure'); };
        } });
      } })), options) : transaction(work, options);
      try { assert.equal((await create(body)).status, 500); } finally { prisma.$transaction = transaction; }
      assert.ok(insertedSlot); assert.equal(await prisma.agendaSlot.count({ where: { id: insertedSlot } }), 0);
      assert.equal(await prisma.availability.count({ where: { professionalId: input.professionalId } }), before);
    });
  } finally {
    try {
      if (prisma && cleanupEnabled) {
        await prisma.scheduleBlock.deleteMany({ where: { id: { in: blocks } } });
        const appointments = await prisma.appointment.findMany({ where: { agendaSlotId: { in: newSlots } }, select: { id: true, user: { select: { email: true } } } });
        assert.ok(appointments.every((item) => item.user.email.startsWith(FIXTURE_EMAIL_PREFIX)));
        const appointmentIds = appointments.map((item) => item.id);
        await prisma.appointmentHistory.deleteMany({ where: { appointmentId: { in: appointmentIds } } });
        await prisma.appointment.deleteMany({ where: { id: { in: appointmentIds } } });
        await cleanupCheckpointFixtures(prisma);
        await prisma.permission.deleteMany({ where: { id: { in: createdPermissions } } });
        await assertCheckpointIsClean(prisma);
      }
    } finally { await app.close(); }
  }
});
