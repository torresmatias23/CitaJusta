import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { NestFactory } from '@nestjs/core';
import { loadApiEnvironment, assertSafeLocalDatabaseUrl, getE2ePort } from './local-environment.mjs';
import {
  FIXTURE_EMAIL_PREFIX, ids, cleanupCheckpointFixtures,
  createCheckpointFixtures, assertCheckpointIsClean,
} from './fixture.mjs';

test('HU-004 real HTTP and PostgreSQL booking', { timeout: 120_000 }, async (t) => {
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

    await t.test('bootstrap repeated against PostgreSQL preserves existing AGENDADA', async () => {
      await bootstrapAppointmentStatus(prisma);
      await bootstrapAppointmentStatus(prisma);
      assert.equal(await prisma.appointmentStatus.count({ where: { code: 'AGENDADA' } }), 1);
      assert.deepEqual(await prisma.appointmentStatus.findUnique({ where: { code: 'AGENDADA' } }), initialStatus);
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
  } finally {
    try {
      if (prisma && cleanupEnabled) {
        await cleanupCheckpointFixtures(prisma);
        await assertCheckpointIsClean(prisma);
      }
    } finally { await app.close(); }
  }
});
