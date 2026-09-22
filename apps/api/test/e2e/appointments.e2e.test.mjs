import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { test } from 'node:test';
import { NestFactory } from '@nestjs/core';
import { loadApiEnvironment, assertSafeLocalDatabaseUrl, getE2ePort } from './local-environment.mjs';
import {
  FIXTURE_EMAIL_PREFIX, ids, cleanupCheckpointFixtures,
  createCheckpointFixtures, assertCheckpointIsClean,
} from './fixture.mjs';

test('HU-004/HU-005/HU-006 real HTTP and PostgreSQL appointments', { timeout: 120_000 }, async (t) => {
  loadApiEnvironment();
  assertSafeLocalDatabaseUrl(process.env.DATABASE_URL);
  process.env.NODE_ENV = 'test';
  const [{ AppModule }, { configureApplication }, { PrismaService }, { bootstrapAppointmentStatus }] =
    await Promise.all([
      import('../../dist/app.module.js'),
      import('../../dist/app.configuration.js'),
      import('../../dist/database/prisma.service.js'),
      import('../../dist/database/appointment-status.bootstrap.js'),
    ]);
  const app = await NestFactory.create(AppModule, { logger: false });
  let prisma;
  let cleanupEnabled = false;
  try {
    configureApplication(app);
    await app.listen(getE2ePort(), '127.0.0.1');
    const baseUrl = `http://127.0.0.1:${app.getHttpServer().address().port}`;
    prisma = app.get(PrismaService);
    await cleanupCheckpointFixtures(prisma);
    cleanupEnabled = true;

    async function post(path, body, token, extraHeaders = {}) {
      const response = await fetch(`${baseUrl}${path}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(token ? { authorization: `Bearer ${token}` } : {}),
          ...extraHeaders,
        },
        body: JSON.stringify(body),
      });
      const text = await response.text();
      let parsed = text;
      try { parsed = JSON.parse(text); } catch { /* Unmatched routes may return HTML. */ }
      return { status: response.status, body: parsed };
    }
    async function register() {
      const body = {
        email: `${FIXTURE_EMAIL_PREFIX}${randomUUID()}@example.com`,
        password: `E2e-${randomUUID()}-Aa1!`,
        firstName: 'Booking', lastName: 'Checkpoint',
      };
      const registered = await post('/api/v1/auth/register', body);
      assert.equal(registered.status, 201, 'Fixture registration');
      const login = await post('/api/v1/auth/login', { email: body.email, password: body.password });
      assert.equal(login.status, 200, 'Fixture login');
      return { id: registered.body.id, token: login.body.accessToken };
    }
    const first = await register();
    const second = await register();
    const range = await createCheckpointFixtures(prisma, first.id);
    const book = (slotId, token = first.token) => post('/api/v1/appointments', { agendaSlotId: slotId }, token);
    const slot = () => prisma.agendaSlot.findUniqueOrThrow({ where: { id: ids.slotAvailable } });
    const appointments = () => prisma.appointment.findMany({ where: { agendaSlotId: ids.slotAvailable } });
    const originalSlot = await slot();
    const initialStatus = await prisma.appointmentStatus.findUnique({ where: { code: 'AGENDADA' } });
    assert.ok(initialStatus?.active && !initialStatus.isFinal, 'Run bootstrap:appointment-status before booking E2E');
    const cancelledStatus = await prisma.appointmentStatus.findUnique({ where: { code: 'CANCELADA' } });
    assert.ok(cancelledStatus?.active && cancelledStatus.isFinal &&
      !cancelledStatus.allowsCancellation && !cancelledStatus.allowsConfirmation,
    'Run bootstrap:appointment-status before cancellation E2E');

    function getMine(token, { query = '', body, headers = {} } = {}) {
      // node:http also permits testing forbidden GET bodies, unlike fetch.
      const payload = body === undefined ? undefined : JSON.stringify(body);
      return new Promise((resolve, reject) => {
        const request = httpRequest(`${baseUrl}/api/v1/appointments/me${query}`, {
          method: 'GET',
          headers: {
            ...(token ? { authorization: `Bearer ${token}` } : {}),
            ...(payload === undefined ? {} : {
              'content-type': 'application/json', 'content-length': Buffer.byteLength(payload),
            }),
            ...headers,
          },
        }, (response) => {
          let text = '';
          response.setEncoding('utf8');
          response.on('data', (chunk) => { text += chunk; });
          response.on('error', reject);
          response.on('end', () => {
            try { resolve({ status: response.statusCode, body: JSON.parse(text) }); }
            catch (error) { reject(error); }
          });
        });
        request.on('error', reject);
        request.end(payload);
      });
    }

    await t.test('bootstrap repeated against PostgreSQL preserves existing AGENDADA and CANCELADA', async () => {
      await bootstrapAppointmentStatus(prisma);
      await bootstrapAppointmentStatus(prisma);
      assert.equal(await prisma.appointmentStatus.count({ where: { code: 'AGENDADA' } }), 1);
      assert.deepEqual(await prisma.appointmentStatus.findUnique({ where: { code: 'AGENDADA' } }), initialStatus);
      assert.equal(await prisma.appointmentStatus.count({ where: { code: 'CANCELADA' } }), 1);
      assert.deepEqual(await prisma.appointmentStatus.findUnique({ where: { code: 'CANCELADA' } }), cancelledStatus);
    });

    await t.test('endpoint requires authentication and rejects body identity and origin', async () => {
      assert.equal((await post('/api/v1/appointments', { agendaSlotId: ids.slotAvailable })).status, 401);
      assert.equal((await post('/appointments', { agendaSlotId: ids.slotAvailable }, first.token)).status, 404);
      for (const body of [
        {}, { agendaSlotId: 'invalid' },
        { agendaSlotId: ids.slotAvailable, userId: second.id },
        { agendaSlotId: ids.slotAvailable, origin: 'WEB' },
        { agendaSlotId: ids.slotAvailable, institutionId: ids.institutionB },
      ]) {
        assert.equal((await post('/api/v1/appointments', body, first.token)).status, 400);
      }
      assert.equal((await appointments()).length, 0);
    });

    await t.test('missing, unavailable, blocked and past slots return controlled errors', async () => {
      assert.equal((await book(ids.missing)).status, 404);
      for (const id of [ids.slotReserved, ids.slotBlocked, ids.slotBlockedUntil, ids.slotPast]) {
        assert.equal((await book(id)).status, 409);
      }
      assert.equal((await book(ids.slotInactivePoint)).status, 404);
      assert.deepEqual(await slot(), originalSlot);
    });

    await t.test('inactive and cross-tenant relations are rejected using actual database joins', async () => {
      const scenarios = [
        ['institution', { id: ids.institutionA }, { status: 'INACTIVE' }, { status: 'ACTIVE' }],
        ['branch', { id: ids.branchA1 }, { status: 'INACTIVE' }, { status: 'ACTIVE' }],
        ['service', { id: ids.serviceA }, { active: false }, { active: true }],
        ['professional', { id: ids.professionalA }, { status: 'INACTIVE' }, { status: 'ACTIVE' }],
        ['availability', { id: ids.availabilityMain }, { active: false }, { active: true }],
        ['serviceBranch', { serviceId_branchId: { serviceId: ids.serviceA, branchId: ids.branchA1 } }, { active: false }, { active: true }],
        ['professionalBranch', { professionalId_branchId: { professionalId: ids.professionalA, branchId: ids.branchA1 } }, { active: false }, { active: true }],
        ['professionalService', { professionalId_serviceId: { professionalId: ids.professionalA, serviceId: ids.serviceA } }, { active: false }, { active: true }],
        ['availability', { id: ids.availabilityMain }, { serviceId: ids.serviceB }, { serviceId: ids.serviceA }],
        ['availability', { id: ids.availabilityMain }, { professionalId: ids.professionalB }, { professionalId: ids.professionalA }],
        ['availability', { id: ids.availabilityMain }, { attentionPointId: ids.attentionPointInactive }, { attentionPointId: ids.attentionPointActive }],
      ];
      for (const [model, where, invalid, restore] of scenarios) {
        await prisma[model].update({ where, data: invalid });
        try { assert.equal((await book(ids.slotAvailable)).status, 404, `Invalid ${model} relation`); }
        finally { await prisma[model].update({ where, data: restore }); }
      }
      assert.deepEqual(await slot(), originalSlot);
      assert.equal((await appointments()).length, 0);
    });

    await t.test('real transaction rolls back slot and appointment when history storage fails', async () => {
      const originalTransaction = prisma.$transaction.bind(prisma);
      // Only fault injection is simulated; preceding SQL writes and rollback are real.
      prisma.$transaction = (work, options) => originalTransaction((tx) => work(new Proxy(tx, {
        get(target, key) {
          if (key === 'appointmentHistory') {
            return new Proxy(target.appointmentHistory, {
              get(delegate, method) {
                if (method === 'create') return async () => { throw new Error('injected-history-failure'); };
                return Reflect.get(delegate, method);
              },
            });
          }
          return Reflect.get(target, key);
        },
      })), options);
      try {
        const response = await book(ids.slotAvailable);
        assert.equal(response.status, 500);
        assert.equal(response.body.message, 'Unable to reserve appointment');
        assert.equal(JSON.stringify(response.body).includes('injected'), false);
      } finally { prisma.$transaction = originalTransaction; }
      assert.deepEqual(await slot(), originalSlot);
      assert.equal((await appointments()).length, 0);
    });

    await t.test('two users race for one slot: exactly one 201, one 409, one appointment and one history', async () => {
      const outcomes = await Promise.all([
        post('/api/v1/appointments', { agendaSlotId: ids.slotAvailable }, first.token, { 'x-institution-id': ids.institutionB }),
        book(ids.slotAvailable, second.token),
      ]);
      assert.deepEqual(outcomes.map((r) => r.status).sort(), [201, 409]);
      const winnerIndex = outcomes.findIndex((r) => r.status === 201);
      const winner = [first, second][winnerIndex];
      const response = outcomes[winnerIndex].body.data;
      assert.deepEqual(Object.keys(response).sort(), [
        'id', 'agendaSlotId', 'institutionId', 'branchId', 'serviceId', 'professionalId',
        'startsAt', 'endsAt', 'origin', 'status',
      ].sort());
      assert.equal(response.status, 'AGENDADA');
      assert.equal(response.origin, 'WEB');
      assert.equal(response.institutionId, ids.institutionA);
      const rows = await appointments();
      assert.equal(rows.length, 1);
      assert.equal(rows[0].id, response.id);
      assert.equal(rows[0].userId, winner.id);
      assert.equal(rows[0].createdByUserId, winner.id);
      assert.equal(rows[0].statusId, initialStatus.id);
      assert.equal(rows[0].origin, 'WEB');
      const finalSlot = await slot();
      assert.equal(finalSlot.status, 'RESERVED');
      assert.equal(finalSlot.lockVersion, originalSlot.lockVersion + 1);
      const history = await prisma.appointmentHistory.findMany({ where: { appointmentId: response.id } });
      assert.equal(history.length, 1);
      assert.equal(history[0].previousStatusId, null);
      assert.equal(history[0].newStatusId, initialStatus.id);
      assert.equal(history[0].previousUserId, null);
      assert.equal(history[0].newUserId, winner.id);
      assert.equal(history[0].actorUserId, winner.id);
      assert.equal((await book(ids.slotAvailable, winner.token)).status, 409);
      const url = `/api/v1/branches/${ids.branchA1}/services/${ids.serviceA}/availability?${new URLSearchParams(range)}`;
      const availability = await fetch(`${baseUrl}${url}`, { headers: { authorization: `Bearer ${winner.token}` } });
      assert.equal(availability.status, 200);
      assert.equal((await availability.json()).data.some((s) => s.id === ids.slotAvailable), false);
    });

    await t.test('UNIQUE prevents a second appointment and booking never replaces the original', async () => {
      const [existing] = await appointments();
      await assert.rejects(prisma.appointment.create({ data: { ...existing, id: randomUUID() } }), (error) => error.code === 'P2002');
      await prisma.agendaSlot.update({ where: { id: ids.slotAvailable }, data: { status: 'AVAILABLE' } });
      try { assert.equal((await book(ids.slotAvailable)).status, 409); }
      finally { await prisma.agendaSlot.update({ where: { id: ids.slotAvailable }, data: { status: 'RESERVED' } }); }
      assert.deepEqual(await appointments(), [existing]);
      assert.equal(await prisma.appointmentHistory.count({ where: { appointmentId: existing.id } }), 1);
    });

    await t.test('HU-005 requires authentication and rejects query/body identity or filter overrides', async () => {
      assert.equal((await getMine()).status, 401);
      assert.equal((await getMine('invalid-token')).status, 401);
      for (const fields of [
        { userId: second.id }, { institutionId: ids.institutionB },
        { branchId: ids.branchB1 }, { status: 'AGENDADA' }, { orderBy: 'desc' },
      ]) {
        assert.equal((await getMine(first.token, { query: `?${new URLSearchParams(fields)}` })).status, 400);
        assert.equal((await getMine(first.token, { body: fields })).status, 400);
      }
    });

    const listingUser = await register();
    await t.test('HU-005 returns an empty list without exposing another user appointments', async () => {
      assert.equal((await appointments()).length, 1);
      assert.deepEqual(await getMine(listingUser.token), { status: 200, body: { data: [] } });
    });

    async function createListingFixture(agendaSlotId, overrides = {}) {
      return prisma.$transaction(async (tx) => {
        const source = await tx.agendaSlot.findUniqueOrThrow({
          where: { id: agendaSlotId },
          include: { availability: { include: { branch: true } } },
        });
        const created = await tx.appointment.create({
          data: {
            id: randomUUID(), agendaSlotId, userId: listingUser.id,
            createdByUserId: listingUser.id, statusId: initialStatus.id, origin: 'WEB',
            institutionId: source.availability.branch.institutionId,
            branchId: source.availability.branchId, serviceId: source.availability.serviceId,
            professionalId: source.availability.professionalId, attentionPointId: source.availability.attentionPointId,
            startsAt: source.startsAt, endsAt: source.endsAt,
            operationalNote: 'E2E_CHECKPOINT private appointment note',
            ...overrides,
          },
        });
        await tx.agendaSlot.update({
          where: { id: agendaSlotId },
          data: {
            status: 'RESERVED', lockVersion: { increment: 1 },
            startsAt: created.startsAt, endsAt: created.endsAt,
          },
        });
        await tx.appointmentHistory.create({
          data: {
            id: randomUUID(), appointmentId: created.id,
            previousStatusId: null, newStatusId: initialStatus.id,
            previousUserId: null, newUserId: listingUser.id, actorUserId: listingUser.id,
          },
        });
        return created;
      });
    }

    const future = await createListingFixture(ids.slotReserved);
    const past = await createListingFixture(ids.slotPast);
    const tied = await createListingFixture(ids.slotOtherContext, {
      startsAt: future.startsAt, endsAt: future.endsAt,
    });
    const deleted = await createListingFixture(ids.slotBlocked, { deletedAt: new Date() });
    const visible = [past, future, tied].sort((a, b) =>
      a.startsAt - b.startsAt || a.id.localeCompare(b.id));
    const visibleIds = visible.map(({ id }) => id);

    await t.test('HU-005 returns only owned public DTOs, past/future dates and stable ordering without writes', async () => {
      const ownedWhere = { userId: listingUser.id };
      const snapshot = async () => Promise.all([
        prisma.appointment.findMany({ where: ownedWhere, orderBy: { id: 'asc' } }),
        prisma.appointmentHistory.findMany({
          where: { appointment: ownedWhere }, orderBy: { id: 'asc' },
        }),
        prisma.agendaSlot.findMany({
          where: { appointment: ownedWhere }, orderBy: { id: 'asc' },
        }),
      ]);
      const before = await snapshot();
      const response = await getMine(listingUser.token);
      assert.equal(response.status, 200);
      assert.deepEqual(Object.keys(response.body), ['data']);
      assert.deepEqual(response.body.data.map(({ id }) => id), visibleIds);
      assert.ok(past.endsAt < new Date());
      assert.ok(future.startsAt > new Date());
      assert.equal(response.body.data.some(({ id }) => id === deleted.id), false);
      for (const [index, item] of response.body.data.entries()) {
        assert.deepEqual(Object.keys(item).sort(), [
          'id', 'institutionId', 'status', 'startsAt', 'endsAt', 'origin',
          'branch', 'service', 'professional',
        ].sort());
        assert.deepEqual(Object.keys(item.branch).sort(), ['id', 'name']);
        assert.deepEqual(Object.keys(item.service).sort(), ['id', 'name']);
        assert.deepEqual(Object.keys(item.professional).sort(), ['firstNames', 'id', 'lastNames']);
        assert.equal(item.startsAt, visible[index].startsAt.toISOString());
        assert.equal(item.endsAt, visible[index].endsAt.toISOString());
        assert.equal(item.status, 'AGENDADA');
        assert.equal(item.origin, 'WEB');
        assert.equal(item.institutionId, ids.institutionA);
        assert.equal(item.branch.id, visible[index].branchId);
        assert.equal(item.service.id, visible[index].serviceId);
        assert.equal(item.professional.id, visible[index].professionalId);
        assert.ok(item.branch.name && item.service.name && item.professional.firstNames);
      }
      assert.deepEqual(await getMine(listingUser.token, {
        headers: { 'x-institution-id': ids.institutionB, 'x-branch-id': ids.branchB1 },
      }), response);
      for (const user of [first, second]) {
        const other = await getMine(user.token);
        assert.equal(other.status, 200);
        assert.equal(other.body.data.some(({ id }) => visibleIds.includes(id)), false);
      }
      assert.deepEqual(await getMine(listingUser.token), response);
      assert.deepEqual(await snapshot(), before);
    });

    await t.test('HU-005 retains owned history when catalogs become inactive', async () => {
      const scenarios = [
        ['institution', { id: ids.institutionA }, { status: 'INACTIVE' }, { status: 'ACTIVE' }],
        ['branch', { id: ids.branchA1 }, { status: 'INACTIVE' }, { status: 'ACTIVE' }],
        ['service', { id: ids.serviceA }, { active: false }, { active: true }],
        ['professional', { id: ids.professionalA }, { status: 'INACTIVE' }, { status: 'ACTIVE' }],
      ];
      for (const [model, where, data, restore] of scenarios) {
        await prisma[model].update({ where, data });
        try {
          const response = await getMine(listingUser.token);
          assert.equal(response.status, 200);
          assert.deepEqual(response.body.data.map(({ id }) => id), visibleIds);
        } finally { await prisma[model].update({ where, data: restore }); }
      }
    });

    await t.test('HU-005 hides cross-tenant appointment relations instead of exposing foreign catalogs', async () => {
      for (const data of [
        { institutionId: ids.institutionB }, { branchId: ids.branchB1 },
        { serviceId: ids.serviceB }, { professionalId: ids.professionalB },
      ]) {
        await prisma.appointment.update({ where: { id: past.id }, data });
        try {
          const response = await getMine(listingUser.token);
          assert.equal(response.status, 200);
          assert.deepEqual(response.body.data.map(({ id }) => id), visibleIds.filter((id) => id !== past.id));
        } finally {
          await prisma.appointment.update({
            where: { id: past.id },
            data: {
              institutionId: past.institutionId, branchId: past.branchId,
              serviceId: past.serviceId, professionalId: past.professionalId,
            },
          });
        }
      }
    });

    await t.test('HU-005 ownership follows current userId, not creator or history', async () => {
      await prisma.appointment.update({ where: { id: past.id }, data: { userId: first.id } });
      try {
        const originalOwner = await getMine(listingUser.token);
        const currentOwner = await getMine(first.token);
        assert.equal(originalOwner.status, 200);
        assert.equal(currentOwner.status, 200);
        assert.equal(originalOwner.body.data.some(({ id }) => id === past.id), false);
        assert.equal(currentOwner.body.data.some(({ id }) => id === past.id), true);
      } finally {
        await prisma.appointment.update({ where: { id: past.id }, data: { userId: listingUser.id } });
      }
    });

    const cancel = (id, token = listingUser.token, body, query = '') =>
      post(`/api/v1/appointments/${id}/cancel${query}`, body, token);
    const cancellationSnapshot = async (id) => ({
      appointment: await prisma.appointment.findUniqueOrThrow({ where: { id } }),
      slot: await prisma.agendaSlot.findFirstOrThrow({ where: { appointment: { id } } }),
      history: await prisma.appointmentHistory.findMany({ where: { appointmentId: id }, orderBy: { id: 'asc' } }),
      cancellations: await prisma.cancellation.findMany({ where: { appointmentId: id }, orderBy: { id: 'asc' } }),
    });

    await t.test('HU-006 requires authentication and rejects identity or functional fields in every input', async () => {
      const before = await cancellationSnapshot(future.id);
      assert.equal((await cancel(future.id, null)).status, 401);
      assert.equal((await cancel(future.id, 'invalid-token')).status, 401);
      assert.equal((await cancel('invalid-id')).status, 400);
      for (const fields of [
        { userId: first.id }, { institutionId: ids.institutionB },
        { status: 'CANCELADA' }, { reason: 'not-supported' },
      ]) {
        assert.equal((await cancel(future.id, listingUser.token, fields)).status, 400);
        assert.equal((await cancel(future.id, listingUser.token, undefined, `?${new URLSearchParams(fields)}`)).status, 400);
      }
      assert.deepEqual(await cancellationSnapshot(future.id), before);
    });

    await t.test('HU-006 missing, soft-deleted and foreign appointments have the same non-disclosing 404', async () => {
      const before = await cancellationSnapshot(future.id);
      const outcomes = [await cancel(ids.missing), await cancel(deleted.id), await cancel(future.id, first.token)];
      assert.deepEqual(outcomes.map(({ status }) => status), [404, 404, 404]);
      assert.deepEqual(outcomes[0].body, outcomes[1].body);
      assert.deepEqual(outcomes[0].body, outcomes[2].body);
      assert.equal(outcomes[0].body.message, 'Appointment not found');
      assert.deepEqual(await cancellationSnapshot(future.id), before);
    });

    await t.test('HU-006 rejects a non-cancelable state and non-RESERVED slot without side effects', async () => {
      const otherStatus = await prisma.appointmentStatus.create({
        data: {
          id: randomUUID(), code: `E2E_CHECKPOINT_${randomUUID()}`, name: 'E2E_CHECKPOINT final',
          active: true, isFinal: true, allowsCancellation: false,
        },
      });
      try {
        await prisma.appointment.update({ where: { id: future.id }, data: { statusId: otherStatus.id } });
        const before = await cancellationSnapshot(future.id);
        assert.equal((await cancel(future.id)).status, 409);
        assert.deepEqual(await cancellationSnapshot(future.id), before);
      } finally {
        await prisma.appointment.update({ where: { id: future.id }, data: { statusId: initialStatus.id } });
        await prisma.appointmentStatus.delete({ where: { id: otherStatus.id } });
      }
      await prisma.agendaSlot.update({ where: { id: future.agendaSlotId }, data: { status: 'BLOCKED' } });
      try {
        const before = await cancellationSnapshot(future.id);
        assert.equal((await cancel(future.id)).status, 409);
        assert.deepEqual(await cancellationSnapshot(future.id), before);
      } finally {
        await prisma.agendaSlot.update({ where: { id: future.agendaSlotId }, data: { status: 'RESERVED' } });
      }
    });

    await t.test('HU-006 never modifies a slot through incoherent tenant or appointment relations', async () => {
      for (const data of [
        { institutionId: ids.institutionB }, { branchId: ids.branchB1 },
        { serviceId: ids.serviceB }, { professionalId: ids.professionalB },
        { branchId: ids.branchA2 },
      ]) {
        await prisma.appointment.update({ where: { id: future.id }, data });
        try {
          const before = await cancellationSnapshot(future.id);
          assert.equal((await cancel(future.id)).status, 404);
          assert.deepEqual(await cancellationSnapshot(future.id), before);
        } finally {
          await prisma.appointment.update({
            where: { id: future.id },
            data: {
              institutionId: future.institutionId, branchId: future.branchId,
              serviceId: future.serviceId, professionalId: future.professionalId,
            },
          });
        }
      }
    });

    await t.test('HU-006 PostgreSQL rolls back slot, appointment and cancellation when an intermediate write fails', async () => {
      const originalTransaction = prisma.$transaction.bind(prisma);
      for (const failOn of ['cancellation', 'appointmentHistory']) {
        const before = await cancellationSnapshot(future.id);
        // Only inject the failure; all preceding SQL and the rollback are real.
        prisma.$transaction = (work, options) => originalTransaction((tx) => work(new Proxy(tx, {
          get(target, key) {
            if (key === failOn) {
              return new Proxy(target[key], {
                get(delegate, method) {
                  if (method === 'create') return async () => { throw new Error('injected-cancellation-storage-failure'); };
                  return Reflect.get(delegate, method);
                },
              });
            }
            return Reflect.get(target, key);
          },
        })), options);
        try {
          const response = await cancel(future.id);
          assert.equal(response.status, 500);
          assert.equal(response.body.message, 'Unable to cancel appointment');
          assert.equal(JSON.stringify(response.body).includes('injected'), false);
        } finally { prisma.$transaction = originalTransaction; }
        assert.deepEqual(await cancellationSnapshot(future.id), before);
      }
    });

    await t.test('HU-006 cancels an owned appointment with history and keeps it visible only to its owner', async () => {
      const before = await cancellationSnapshot(tied.id);
      const response = await post(`/api/v1/appointments/${tied.id}/cancel`, undefined, listingUser.token, {
        'x-institution-id': ids.institutionB,
      });
      assert.equal(response.status, 200);
      assert.deepEqual(Object.keys(response.body), ['data']);
      assert.deepEqual(Object.keys(response.body.data).sort(), [
        'id', 'institutionId', 'status', 'startsAt', 'endsAt', 'origin',
        'branch', 'service', 'professional',
      ].sort());
      assert.deepEqual(Object.keys(response.body.data.branch).sort(), ['id', 'name']);
      assert.deepEqual(Object.keys(response.body.data.service).sort(), ['id', 'name']);
      assert.deepEqual(Object.keys(response.body.data.professional).sort(), ['firstNames', 'id', 'lastNames']);
      assert.equal(response.body.data.status, 'CANCELADA');
      const after = await cancellationSnapshot(tied.id);
      assert.equal(after.appointment.statusId, cancelledStatus.id);
      assert.equal(after.appointment.id, before.appointment.id);
      assert.equal(after.appointment.userId, before.appointment.userId);
      assert.equal(after.appointment.agendaSlotId, before.slot.id);
      assert.equal(after.appointment.deletedAt, null);
      assert.equal(after.slot.status, 'RELEASED');
      assert.equal(after.slot.lockVersion, before.slot.lockVersion + 2);
      assert.equal(after.history.length, before.history.length + 1);
      const history = after.history.find((row) => row.newStatusId === cancelledStatus.id);
      assert.equal(history.previousStatusId, initialStatus.id);
      assert.equal(history.previousUserId, listingUser.id);
      assert.equal(history.newUserId, listingUser.id);
      assert.equal(history.actorUserId, listingUser.id);
      assert.equal(after.cancellations.length, 1);
      assert.equal(after.cancellations[0].cancelledByUserId, listingUser.id);
      assert.equal(after.cancellations[0].releasesSlot, true);
      assert.equal(after.cancellations[0].cancellationReasonId, null);
      assert.equal(after.cancellations[0].comment, null);
      const mine = await getMine(listingUser.token);
      assert.equal(mine.status, 200);
      assert.deepEqual(response.body.data, mine.body.data.find(({ id }) => id === tied.id));
      assert.deepEqual(await cancel(tied.id), response);
      assert.deepEqual(await cancellationSnapshot(tied.id), after);
      assert.equal((await getMine(first.token)).body.data.some(({ id }) => id === tied.id), false);
      assert.equal((await cancel(tied.id, first.token)).status, 404);
    });

    await t.test('HU-006 concurrent cancellations produce exactly one effective change and retries have no writes', async () => {
      const before = await cancellationSnapshot(future.id);
      const responses = await Promise.all([cancel(future.id), cancel(future.id)]);
      const statuses = responses.map(({ status }) => status).sort();
      assert.deepEqual(statuses, [200, 200]);
      assert.deepEqual(responses[0].body, responses[1].body);
      assert.equal(responses[0].body.data.id, future.id);
      assert.equal(responses[0].body.data.status, 'CANCELADA');
      const after = await cancellationSnapshot(future.id);
      assert.equal(after.appointment.statusId, cancelledStatus.id);
      assert.equal(after.appointment.userId, listingUser.id);
      assert.equal(after.appointment.agendaSlotId, before.slot.id);
      assert.equal(after.slot.status, 'RELEASED');
      assert.equal(after.slot.lockVersion, before.slot.lockVersion + 2);
      assert.equal(after.cancellations.length, 1);
      assert.equal(after.history.length, before.history.length + 1);
      assert.equal(after.history.filter((row) => row.newStatusId === cancelledStatus.id).length, 1);
      assert.deepEqual(await cancel(future.id), responses[0]);
      assert.deepEqual(await cancel(future.id), responses[0]);
      assert.deepEqual(await cancellationSnapshot(future.id), after);
      t.diagnostic(`Concurrent cancellation HTTP statuses: ${statuses.join(', ')}; one cancellation/history and one automatic start`);
    });

    await t.test('HU-006 released slots stay outside public availability and HU-004 cannot create another appointment', async () => {
      for (const row of [future, tied]) {
        const before = await cancellationSnapshot(row.id);
        const url = `/api/v1/branches/${row.branchId}/services/${row.serviceId}/availability?${new URLSearchParams(range)}`;
        const response = await fetch(`${baseUrl}${url}`, { headers: { authorization: `Bearer ${listingUser.token}` } });
        assert.equal(response.status, 200);
        assert.equal((await response.json()).data.some(({ id }) => id === row.agendaSlotId), false);
        assert.equal((await book(row.agendaSlotId, listingUser.token)).status, 409);
        assert.equal((await book(row.agendaSlotId, first.token)).status, 409);
        assert.equal(await prisma.appointment.count({ where: { agendaSlotId: row.agendaSlotId } }), 1);
        assert.equal(await prisma.reassignment.count({ where: { appointmentId: row.id, status: 'EXHAUSTED' } }), 1);
        assert.equal(await prisma.appointmentOffer.count({ where: { agendaSlotId: row.agendaSlotId } }), 0);
        assert.deepEqual(await cancellationSnapshot(row.id), before);
      }
    });
  } finally {
    try {
      if (prisma && cleanupEnabled) {
        await cleanupCheckpointFixtures(prisma);
        await assertCheckpointIsClean(prisma);
      }
    } finally { await app.close(); }
  }
});
