import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { NestFactory } from '@nestjs/core';
import { createHttpClient, ApiError } from '../../src/lib/http-client.ts';
import { createAuthSession } from '../../src/features/auth/auth-session.ts';
import { createCatalogApi } from '../../src/features/availability/catalog-api.ts';
import { createAvailabilityApi } from '../../src/features/availability/availability-api.ts';
import { createAppointmentsApi } from '../../src/features/appointments/appointments-api.ts';
import {
  loadApiEnvironment, assertSafeLocalDatabaseUrl, getE2ePort,
} from '../../../api/test/e2e/local-environment.mjs';
import {
  FIXTURE_EMAIL_PREFIX, ids, createCheckpointFixtures,
  cleanupCheckpointFixtures, assertCheckpointIsClean,
} from '../../../api/test/e2e/fixture.mjs';

function memoryStorage() {
  let refreshToken;
  let writes = 0;
  return {
    read: () => refreshToken,
    write(value) { refreshToken = value; writes += 1; },
    clear() { refreshToken = undefined; },
    writes: () => writes,
  };
}

function credentials(firstName) {
  return {
    email: `${FIXTURE_EMAIL_PREFIX}${randomUUID()}@example.com`,
    password: `E2e-${randomUUID()}-Aa1!`,
    firstName,
    lastName: 'Integration',
  };
}

const statusIs = (status) => (error) => error instanceof ApiError && error.status === status;

// Real HTTP and PostgreSQL contract coverage, not browser interaction coverage.
// Fixed checkpoint IDs require this suite and the API E2E suites to run serially.
test('web clients complete auth, availability and appointment flow against real Nest/PostgreSQL', { timeout: 120_000 }, async (t) => {
  loadApiEnvironment();
  assertSafeLocalDatabaseUrl(process.env.DATABASE_URL);
  process.env.NODE_ENV = 'test';
  const [{ AppModule }, { configureApplication }, { PrismaService }] = await Promise.all([
    import('../../../api/dist/app.module.js'),
    import('../../../api/dist/app.configuration.js'),
    import('../../../api/dist/database/prisma.service.js'),
  ]);
  const app = await NestFactory.create(AppModule, { logger: false });
  let prisma;
  let cleanupEnabled = false;
  try {
    configureApplication(app);
    await app.listen(getE2ePort(), '127.0.0.1');
    const baseUrl = `http://127.0.0.1:${app.getHttpServer().address().port}/api/v1`;
    prisma = app.get(PrismaService);
    await cleanupCheckpointFixtures(prisma);
    cleanupEnabled = true;

    // Provisioning is an explicit owner action, never an implicit E2E side effect.
    const initialStatus = await prisma.appointmentStatus.findUnique({ where: { code: 'AGENDADA' } });
    const cancelledStatus = await prisma.appointmentStatus.findUnique({ where: { code: 'CANCELADA' } });
    assert.ok(initialStatus?.active && !initialStatus.isFinal,
      'Provision AGENDADA with bootstrap:appointment-status before running this E2E');
    assert.ok(cancelledStatus?.active && cancelledStatus.isFinal
      && !cancelledStatus.allowsCancellation && !cancelledStatus.allowsConfirmation,
    'Provision CANCELADA with bootstrap:appointment-status before running this E2E');

    const publicApi = createHttpClient({ baseUrl });
    const newSession = (storage = memoryStorage()) => createAuthSession({
      publicApi,
      authenticatedApi: (getAccessToken) => createHttpClient({ baseUrl, getAccessToken }),
      storage,
    });
    const storage = memoryStorage();
    let session = newSession(storage);
    const owner = credentials('Web');
    const other = newSession();

    await t.test('anonymous session cannot read appointments and invalid login stays anonymous', async () => {
      await session.restore();
      assert.equal(session.getSnapshot().status, 'anonymous');
      await assert.rejects(createAppointmentsApi(session.api).list(), statusIs(401));
      await assert.rejects(session.login(owner), statusIs(401));
      assert.equal(session.getSnapshot().status, 'anonymous');
      assert.equal(storage.read(), undefined);
    });

    await t.test('registration and login use the real contracts and load the authenticated profile', async () => {
      await session.register(owner);
      await session.login(owner);
      const snapshot = session.getSnapshot();
      assert.equal(snapshot.status, 'authenticated');
      assert.equal(snapshot.user.email, owner.email);
      assert.equal(snapshot.user.firstName, owner.firstName);
      assert.equal(snapshot.user.status, 'ACTIVE');
      assert.equal(Object.hasOwn(snapshot.user, 'passwordHash'), false);
      assert.equal(Object.hasOwn(snapshot, 'accessToken'), false);
      assert.equal(typeof storage.read(), 'string');
    });

    const ownerId = session.getSnapshot().user.id;
    await t.test('restoring a session rotates the real refresh token once and restores profile', async () => {
      const oldToken = storage.read();
      const writesBefore = storage.writes();
      session = newSession(storage);
      await Promise.all([session.restore(), session.restore(), session.restore()]);
      assert.equal(session.getSnapshot().status, 'authenticated');
      assert.equal(session.getSnapshot().user.id, ownerId);
      assert.equal(storage.writes(), writesBefore + 1);
      assert.equal(storage.read() !== oldToken, true, 'Refresh tokens must rotate');
    });

    const secondCredentials = credentials('Other');
    await other.register(secondCredentials);
    await other.login(secondCredentials);
    const range = await createCheckpointFixtures(prisma, ownerId);
    const catalogs = createCatalogApi(session.api);
    const availability = createAvailabilityApi(session.api);
    const appointments = createAppointmentsApi(session.api);
    const otherAppointments = createAppointmentsApi(other.api);
    const query = {
      institutionId: ids.institutionA, branchId: ids.branchA1,
      serviceId: ids.serviceA, ...range,
    };
    let offeredSlot;
    let booked;

    await t.test('catalog clients load actual institutions, their branches and branch services', async () => {
      const institutions = await catalogs.institutions();
      assert.ok(institutions.some(({ id }) => id === ids.institutionA));
      assert.equal(institutions.some(({ id }) => id === ids.institutionInactive), false);
      const branches = await catalogs.branches(ids.institutionA);
      assert.ok(branches.some(({ id }) => id === ids.branchA1));
      assert.ok(branches.every(({ institutionId }) => institutionId === ids.institutionA));
      const services = await catalogs.services(ids.branchA1);
      assert.ok(services.some(({ id }) => id === ids.serviceA));
      assert.ok(services.every(({ institution }) => institution.id === ids.institutionA));
    });

    await t.test('availability client reads actual available slots and excludes blocked fixture slots', async () => {
      const slots = await availability.find(query);
      offeredSlot = slots.find(({ id }) => id === ids.slotAvailable);
      assert.ok(offeredSlot);
      assert.equal(offeredSlot.professional.id, ids.professionalA);
      assert.equal(slots.some(({ id }) => [ids.slotReserved, ids.slotBlocked, ids.slotCrossTenant].includes(id)), false);
    });

    await t.test('appointments empty states use real empty responses', async () => {
    assert.deepEqual(await appointments.list(), []);
    assert.deepEqual(await otherAppointments.list(), []);
    });

    await t.test('booking sends only the slot and receives backend-owned AGENDADA and WEB fields', async () => {
      booked = await appointments.reserve(offeredSlot.id);
      assert.equal(booked.agendaSlotId, ids.slotAvailable);
      assert.equal(booked.status, 'AGENDADA');
      assert.equal(booked.origin, 'WEB');
      assert.equal(Object.hasOwn(booked, 'userId'), false);
      const row = await prisma.appointment.findUniqueOrThrow({ where: { id: booked.id } });
      assert.equal(row.userId, ownerId);
      const slot = await prisma.agendaSlot.findUniqueOrThrow({ where: { id: ids.slotAvailable } });
      assert.equal(slot.status, 'RESERVED');
    });

    await t.test('a second user cannot reserve the same slot and receives a controlled 409', async () => {
      await assert.rejects(otherAppointments.reserve(offeredSlot.id), statusIs(409));
      assert.equal(await prisma.appointment.count({ where: { agendaSlotId: ids.slotAvailable } }), 1);
      assert.equal((await availability.find(query)).some(({ id }) => id === ids.slotAvailable), false);
    });

    await t.test('my appointments returns the public owned DTO and another user sees no appointment', async () => {
      const mine = await appointments.list();
      assert.equal(mine.length, 1);
      assert.equal(mine[0].id, booked.id);
      assert.equal(mine[0].status, 'AGENDADA');
      assert.equal(mine[0].branch.id, ids.branchA1);
      assert.equal(mine[0].service.id, ids.serviceA);
      assert.deepEqual(Object.keys(mine[0]).sort(), [
        'id', 'institutionId', 'status', 'startsAt', 'endsAt', 'origin', 'branch', 'service', 'professional',
      ].sort());
      assert.deepEqual(await otherAppointments.list(), []);
      await assert.rejects(otherAppointments.cancel(booked.id), statusIs(404));
    });

    await t.test('cancellation returns the real updated DTO and RELEASED never becomes public availability', async () => {
      const cancelled = await appointments.cancel(booked.id);
      assert.equal(cancelled.status, 'CANCELADA');
      assert.equal(cancelled.id, booked.id);
      assert.deepEqual(await appointments.list(), [cancelled]);
      const slot = await prisma.agendaSlot.findUniqueOrThrow({ where: { id: ids.slotAvailable } });
      assert.equal(slot.status, 'RELEASED');
      assert.equal((await availability.find(query)).some(({ id }) => id === ids.slotAvailable), false);
      assert.equal(await prisma.appointment.count({ where: { agendaSlotId: ids.slotAvailable } }), 1);
    });

    await t.test('repeated cancellation remains idempotent through the frontend client', async () => {
      const snapshot = async () => ({
        slot: await prisma.agendaSlot.findUniqueOrThrow({ where: { id: ids.slotAvailable } }),
        appointment: await prisma.appointment.findUniqueOrThrow({ where: { id: booked.id } }),
        history: await prisma.appointmentHistory.findMany({ where: { appointmentId: booked.id }, orderBy: { id: 'asc' } }),
      });
      const before = await snapshot();
      assert.equal((await appointments.cancel(booked.id)).status, 'CANCELADA');
      assert.deepEqual(await snapshot(), before);
    });

    await t.test('logout clears frontend storage and revokes the actual backend refresh session', async () => {
      const token = storage.read();
      await session.logout();
      assert.equal(session.getSnapshot().status, 'anonymous');
      assert.equal(session.getSnapshot().user, null);
      assert.equal(storage.read(), undefined);
      await assert.rejects(appointments.list(), statusIs(401));
      await assert.rejects(publicApi.request('auth/refresh', {
        method: 'POST', body: { refreshToken: token },
      }), statusIs(401));
      await other.logout();
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
