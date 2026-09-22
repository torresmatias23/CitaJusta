import { cancelWithBlockedSlot } from './manual-release.fixture.mjs';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { test } from 'node:test';
import { NestFactory } from '@nestjs/core';
import { loadApiEnvironment, assertSafeLocalDatabaseUrl, getE2ePort } from './local-environment.mjs';
import { FIXTURE_EMAIL_PREFIX, ids, cleanupReportsFixtures, createReportsFixtures, assertReportsClean } from './reports.fixture.mjs';

test('HU-019 reports: real PostgreSQL aggregates, authorization, isolation and no writes', { timeout: 120_000 }, async (t) => {
  loadApiEnvironment(); assertSafeLocalDatabaseUrl(process.env.DATABASE_URL); process.env.NODE_ENV = 'test';
  const [{ AppModule }, { configureApplication }, { PrismaService }, { bootstrapWaitlist }, { bootstrapAppointmentStatus }] = await Promise.all([
    import('../../dist/app.module.js'), import('../../dist/app.configuration.js'), import('../../dist/database/prisma.service.js'),
    import('../../dist/database/waitlist.bootstrap.js'), import('../../dist/database/appointment-status.bootstrap.js'),
  ]);
  const app = await NestFactory.create(AppModule, { logger: false });
  let prisma; let cleanupEnabled = false;
  const ownedPermissions = []; const ownedStatuses = []; const ownedWaitlistStatuses = [];
  const users = []; const slots = []; const appointments = []; const processes = []; const entries = [];
  try {
    configureApplication(app); await app.listen(getE2ePort(), '127.0.0.1');
    prisma = app.get(PrismaService); cleanupEnabled = true;
    const base = `http://127.0.0.1:${app.getHttpServer().address().port}/api/v1`;
    async function request(method, path, token, body, headers = {}) {
      const result = await fetch(`${base}${path}`, { method, headers: { ...headers,
        ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}) });
      return { status: result.status, body: await result.json() };
    }
    async function register() {
      const credentials = { email: `${FIXTURE_EMAIL_PREFIX}${randomUUID()}@example.com`, password: `E2e-${randomUUID()}-Aa1!` };
      const result = await request('POST', '/auth/register', undefined, { ...credentials, firstName: 'Reports', lastName: 'Fixture' });
      assert.equal(result.status, 201); users.push(result.body.id);
      const login = await request('POST', '/auth/login', undefined, credentials); assert.equal(login.status, 200);
      return { id: result.body.id, token: login.body.accessToken };
    }
    const admin = await register(); const source = await register(); const officer = await register(); const foreign = await register();
    await createReportsFixtures(prisma, admin.id, source.id);
    for (const code of ['reports.read', 'reassignments.generate', 'appointments.attendance']) {
      let permission = await prisma.permission.findUnique({ where: { code } });
      if (!permission) {
        permission = await prisma.permission.create({ data: { id: randomUUID(), code, module: code.split('.')[0], action: code.split('.')[1] } });
        ownedPermissions.push(permission.id);
      }
      await prisma.rolePermission.createMany({ data: [ids.roleInstitution, ids.roleBranch].map((roleId) => ({ roleId, permissionId: permission.id })) });
      if (code === 'reports.read') await prisma.rolePermission.create({ data: { roleId: ids.roleGlobal, permissionId: permission.id } });
    }
    await prisma.userRole.createMany({ data: [
      { id: randomUUID(), userId: officer.id, roleId: ids.roleBranch, institutionId: ids.institutionA, branchId: ids.branchA1 },
      { id: randomUUID(), userId: foreign.id, roleId: ids.roleInstitution, institutionId: ids.institutionB },
    ] });
    const existingStatuses = await prisma.appointmentStatus.findMany({ select: { id: true } });
    await bootstrapAppointmentStatus(prisma);
    const statuses = await prisma.appointmentStatus.findMany();
    ownedStatuses.push(...statuses.filter((row) => !existingStatuses.some((old) => old.id === row.id)).map((row) => row.id));
    const statusId = (code) => statuses.find((row) => row.code === code).id;
    const existingWaitlist = await prisma.waitlistStatus.findMany({ select: { id: true } });
    await bootstrapWaitlist(prisma, ids.institutionA);
    const waitlistStatuses = await prisma.waitlistStatus.findMany();
    ownedWaitlistStatuses.push(...waitlistStatuses.filter((row) => !existingWaitlist.some((old) => old.id === row.id)).map((row) => row.id));
    const priority = await prisma.priority.findFirstOrThrow({ where: { institutionId: ids.institutionA, code: 'STANDARD' } });
    await prisma.institution.update({ where: { id: ids.institutionA }, data: { timeZone: 'America/Santiago' } });
    const headers = { 'x-institution-id': ids.institutionA };
    const period = { from: '2025-01-15', to: '2025-01-15' };
    const eventAt = new Date('2025-01-15T12:00:00Z');
    const get = (filters = {}, token = admin.token, scope = headers) => request('GET', `/reports/indicators?${new URLSearchParams({ ...period, ...filters })}`, token, undefined, scope);
    const empty = { period, appointments: { scheduled: 0, cancelled: 0, noShows: 0 }, slots: { released: 0, recovered: 0, recoveryRatePct: 0 }, offers: { sent: 0, accepted: 0, rejected: 0, expired: 0 } };
    const main = { period, appointments: { scheduled: 5, cancelled: 4, noShows: 1 }, slots: { released: 3, recovered: 1, recoveryRatePct: 33.33 }, offers: { sent: 5, accepted: 1, rejected: 1, expired: 2 } };
    const single = { period, appointments: { scheduled: 1, cancelled: 1, noShows: 0 }, slots: { released: 1, recovered: 1, recoveryRatePct: 100 }, offers: { sent: 3, accepted: 1, rejected: 1, expired: 1 } };
    const total = { period, appointments: { scheduled: 6, cancelled: 5, noShows: 1 }, slots: { released: 4, recovered: 2, recoveryRatePct: 50 }, offers: { sent: 8, accepted: 2, rejected: 2, expired: 3 } };

    await t.test('auth, permission and context required; empty report and strict inputs', async () => {
      assert.equal((await get({}, null)).status, 401);
      assert.equal((await get({}, source.token)).status, 403);
      assert.equal((await get({}, admin.token, {})).status, 403);
      assert.equal((await get({}, officer.token)).status, 403);
      assert.deepEqual((await get()).body.data, empty);
      for (const filters of [{ from: '' }, { to: '' }, { from: '2025-02-30' }, { from: '2025-01-16' },
        { from: '2024-01-01', to: '2025-01-01' }, { branchId: 'bad' }, { serviceId: 'bad' }, { professionalId: 'bad' },
        { institutionId: ids.institutionB }, { userId: source.id }, { unknown: 'x' }]) assert.equal((await get(filters)).status, 400);
      const payload = JSON.stringify({ institutionId: ids.institutionB });
      const code = await new Promise((resolve, reject) => {
        const req = httpRequest(`${base}/reports/indicators?${new URLSearchParams(period)}`, { method: 'GET', headers: {
          ...headers, authorization: `Bearer ${admin.token}`, 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload),
        } }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
        req.on('error', reject); req.end(payload);
      });
      assert.equal(code, 400);
    });

    let sequence = 0;
    async function appointment(availabilityId = ids.availabilityMain, extra = {}) {
      const availability = await prisma.availability.findUniqueOrThrow({ where: { id: availabilityId }, include: { branch: true } });
      const startsAt = new Date(+eventAt + sequence++ * 1_800_000); const endsAt = new Date(+startsAt + 900_000);
      const slot = await prisma.agendaSlot.create({ data: { id: randomUUID(), availabilityId, startsAt, endsAt, status: 'RESERVED' } }); slots.push(slot.id);
      const row = await prisma.appointment.create({ data: { id: randomUUID(), agendaSlotId: slot.id,
        institutionId: availability.branch.institutionId, branchId: availability.branchId, serviceId: availability.serviceId,
        professionalId: availability.professionalId, attentionPointId: availability.attentionPointId,
        userId: source.id, statusId: statusId('AGENDADA'), origin: 'WEB', startsAt, endsAt, ...extra } });
      appointments.push(row.id); return row;
    }
    async function cancellation(row, releasesSlot = true) {
      return prisma.cancellation.create({ data: { id: randomUUID(), appointmentId: row.id, releasesSlot, cancelledAt: eventAt, cancelledByUserId: source.id } });
    }
    async function processFor(row, completed = false) {
      const cancel = await cancellation(row);
      const process = await prisma.reassignment.create({ data: { id: randomUUID(), institutionId: row.institutionId,
        originCancellationId: cancel.id, appointmentId: row.id, agendaSlotId: row.agendaSlotId, serviceId: row.serviceId,
        sourceUserId: source.id, status: completed ? 'COMPLETED' : 'OFFERING', initialSlotVersion: 0,
        ruleCode: 'PRIORITY_FIFO_V1', scoringVersion: 'priority-level-asc-fifo-v1', criteriaSnapshot: {},
        detectedAt: eventAt, startedAt: eventAt, ...(completed ? { finishedAt: eventAt, closureReasonCode: 'OFFER_ACCEPTED' } : {}) } });
      processes.push(process.id); return process;
    }
    async function offer(process, status, attempt, expiresAt = new Date(+eventAt + 60_000)) {
      const entry = await prisma.waitlistEntry.create({ data: { id: randomUUID(), institutionId: process.institutionId,
        serviceId: process.serviceId, userId: source.id, priorityId: priority.id,
        statusId: waitlistStatuses.find((row) => row.code === 'WITHDRAWN').id } }); entries.push(entry.id);
      const candidate = await prisma.reassignmentCandidate.create({ data: { id: randomUUID(), reassignmentId: process.id,
        waitlistEntryId: entry.id, userId: source.id, priorityId: priority.id, evaluationStatus: 'ELIGIBLE',
        priorityLevelSnapshot: priority.level, entryUpdatedAtSnapshot: eventAt, rankingPosition: attempt,
        totalScore: 1, evaluatedAt: eventAt } });
      return prisma.appointmentOffer.create({ data: { id: randomUUID(), reassignmentId: process.id, candidateId: candidate.id,
        agendaSlotId: process.agendaSlotId, attemptNumber: attempt, status, expectedSlotVersion: 0,
        createdAt: new Date(+eventAt - 60_000), expiresAt,
        ...(['ACCEPTED', 'REJECTED'].includes(status) ? { respondedAt: eventAt, respondedByUserId: source.id, resolvedAt: eventAt } : {}),
        ...(status === 'EXPIRED' ? { resolvedAt: new Date(+eventAt + 120_000) } : {}) } });
    }
    async function recovered(availabilityId) {
      const row = await appointment(availabilityId); const process = await processFor(row, true);
      await offer(process, 'REJECTED', 1); await offer(process, 'EXPIRED', 2); const accepted = await offer(process, 'ACCEPTED', 3);
      return { row, process, accepted };
    }
    const recoveredMain = await recovered(ids.availabilityMain);
    const overdue = await processFor(await appointment()); const overdueOffer = await offer(overdue, 'PENDING', 1);
    const live = await processFor(await appointment()); await offer(live, 'PENDING', 1, new Date('9999-01-01T00:00:00Z'));
    const noShow = await appointment(ids.availabilityMain, { statusId: statusId('INASISTENCIA') });
    const noShowEvent = { appointmentId: noShow.id, previousStatusId: statusId('AGENDADA'), newStatusId: statusId('INASISTENCIA'),
      previousUserId: source.id, newUserId: source.id, actorUserId: admin.id, reason: 'NO_SHOW_RECORDED', occurredAt: eventAt };
    const history = await prisma.appointmentHistory.create({ data: { id: randomUUID(), ...noShowEvent } });
    await cancellation(await appointment(ids.availabilityMain, { statusId: statusId('CANCELADA') }), false);
    await appointment(ids.availabilityMain, { deletedAt: new Date() });
    const boundary = await appointment(ids.availabilityMain, { startsAt: new Date('2025-01-15T02:59:59Z') });
    await recovered(ids.availabilityOtherContext);
    await recovered(ids.availabilityCrossTenant);

    await t.test('all metrics and ratio from persisted rows; completed process with three offers counted once', async () => {
      const result = await get(); assert.equal(result.status, 200); assert.deepEqual(result.body.data, total);
      assert.deepEqual((await get({ branchId: ids.branchA1 })).body.data, main);
    });
    await t.test('same branch, service and professional filters apply to every indicator', async () => {
      for (const filters of [{ branchId: ids.branchA2 }, { serviceId: ids.serviceA2 }, { professionalId: ids.professionalA2 },
        { branchId: ids.branchA2, serviceId: ids.serviceA2, professionalId: ids.professionalA2 }]) assert.deepEqual((await get(filters)).body.data, single);
      assert.deepEqual((await get({ branchId: ids.branchA2, serviceId: ids.serviceA })).body.data, empty);
    });
    await t.test('branch scope cannot escape and cross-tenant filters reveal no data', async () => {
      const scope = { ...headers, 'x-branch-id': ids.branchA1 };
      assert.deepEqual((await get({}, officer.token, scope)).body.data, main);
      assert.equal((await get({ branchId: ids.branchA2 }, officer.token, scope)).status, 404);
      assert.deepEqual((await get({}, foreign.token, { 'x-institution-id': ids.institutionB })).body.data, single);
      for (const filter of [{ branchId: ids.branchB1 }, { serviceId: ids.serviceB }, { professionalId: ids.professionalB }]) assert.equal((await get(filter)).status, 404);
    });
    await t.test('institutional midnight is inclusive and next midnight exclusive', async () => {
      const previous = (await get({ from: '2025-01-14', to: '2025-01-14' })).body.data;
      assert.equal(previous.appointments.scheduled, 1); assert.equal(previous.appointments.noShows, 0);
      assert.equal(previous.slots.recoveryRatePct, 0);
      await prisma.appointment.update({ where: { id: boundary.id }, data: { startsAt: new Date('2025-01-15T03:00:00Z') } });
      assert.equal((await get()).body.data.appointments.scheduled, total.appointments.scheduled + 1);
      await prisma.appointment.update({ where: { id: boundary.id }, data: { startsAt: new Date('2025-01-16T03:00:00Z') } });
      assert.deepEqual((await get()).body.data, total);
    });
    await t.test('noShows follows transition time, deduplicates history and preserves scope', async () => {
      await prisma.appointment.update({ where: { id: noShow.id }, data: { startsAt: new Date('2025-01-14T12:00:00Z') } });
      const duplicate = await prisma.appointmentHistory.create({ data: { id: randomUUID(), ...noShowEvent } });
      assert.equal((await get()).body.data.appointments.noShows, 1);
      assert.equal((await get({ branchId: ids.branchA2 })).body.data.appointments.noShows, 0);
      assert.equal((await get({ serviceId: ids.serviceA2 })).body.data.appointments.noShows, 0);
      assert.equal((await get({ professionalId: ids.professionalA2 })).body.data.appointments.noShows, 0);
      assert.equal((await get({}, foreign.token, { 'x-institution-id': ids.institutionB })).body.data.appointments.noShows, 0);
      assert.equal((await get({ from: '2025-01-14', to: '2025-01-14' })).body.data.appointments.noShows, 0);
      await prisma.appointmentHistory.delete({ where: { id: duplicate.id } });
      await prisma.appointment.update({ where: { id: noShow.id }, data: { startsAt: noShow.startsAt } });
      await prisma.appointmentHistory.update({ where: { id: history.id }, data: { occurredAt: new Date('2025-01-16T03:00:00Z') } });
      assert.equal((await get()).body.data.appointments.noShows, 0);
      assert.equal((await get({ from: '2025-01-16', to: '2025-01-16' })).body.data.appointments.noShows, 1);
      await prisma.appointmentHistory.update({ where: { id: history.id }, data: { occurredAt: new Date('2025-01-15T03:00:00Z') } });
      assert.equal((await get()).body.data.appointments.noShows, 1);
      await prisma.appointmentHistory.update({ where: { id: history.id }, data: { previousStatusId: statusId('INASISTENCIA') } });
      assert.equal((await get()).body.data.appointments.noShows, 0);
      await prisma.appointmentHistory.update({ where: { id: history.id }, data: { previousStatusId: statusId('AGENDADA'), occurredAt: eventAt } });
    });
    await t.test('GLOBAL permissions still require a selected institution for institutional reports', async () => {
      const global = await register();
      await prisma.userRole.create({ data: { id: randomUUID(), userId: global.id, roleId: ids.roleGlobal } });
      assert.equal((await get({}, global.token, {})).status, 400);
      assert.deepEqual((await get({}, global.token, headers)).body.data, total);
      assert.deepEqual((await get({}, global.token, { 'x-institution-id': ids.institutionB })).body.data, single);
    });
    await t.test('event dates differ from appointment date and expiration is operational, independent of resolution lag', async () => {
      const expiredBefore = await prisma.appointmentOffer.findUniqueOrThrow({ where: { id: overdueOffer.id } });
      assert.equal(expiredBefore.status, 'PENDING');
      await prisma.appointmentOffer.update({ where: { id: recoveredMain.accepted.id }, data: { respondedAt: new Date('2025-01-16T12:00:00Z') } });
      assert.equal((await get()).body.data.offers.accepted, 1);
      const later = (await get({ from: '2025-01-16', to: '2025-01-16' })).body.data;
      assert.equal(later.offers.accepted, 1); assert.equal(later.offers.sent, 0); assert.equal(later.slots.recoveryRatePct, 0);
      await prisma.appointmentOffer.update({ where: { id: recoveredMain.accepted.id }, data: { respondedAt: eventAt } });
      const future = (await get({ from: '9999-01-01', to: '9999-01-01' })).body.data;
      assert.equal(future.offers.expired, 0);
    });
    await t.test('inconsistent FKs cannot import another tenant through appointments or reassignments', async () => {
      await prisma.appointment.update({ where: { id: recoveredMain.row.id }, data: { professionalId: ids.professionalB } });
      const corrupt = (await get()).body.data;
      assert.equal(corrupt.appointments.scheduled, total.appointments.scheduled - 1);
      assert.equal(corrupt.appointments.cancelled, total.appointments.cancelled - 1);
      assert.equal(corrupt.slots.recovered, 1); assert.equal(corrupt.offers.sent, 5);
      await prisma.appointment.update({ where: { id: recoveredMain.row.id }, data: { professionalId: ids.professionalA } });
      await prisma.reassignment.update({ where: { id: recoveredMain.process.id }, data: { serviceId: ids.serviceB } });
      assert.equal((await get()).body.data.offers.sent, 5);
      await prisma.reassignment.update({ where: { id: recoveredMain.process.id }, data: { serviceId: ids.serviceA } });
      assert.deepEqual((await get()).body.data, total);
    });
    await t.test('cancellation and recovery use their own event dates, not appointment start or offer count', async () => {
      const nextDay = new Date('2025-01-16T12:00:00Z');
      await prisma.cancellation.update({ where: { id: recoveredMain.process.originCancellationId }, data: { cancelledAt: nextDay } });
      const current = (await get({ branchId: ids.branchA1 })).body.data;
      assert.equal(current.appointments.scheduled, main.appointments.scheduled);
      assert.equal(current.appointments.cancelled, 3); assert.equal(current.slots.released, 2);
      assert.equal(current.slots.recovered, 1); assert.equal(current.slots.recoveryRatePct, 50);
      await prisma.cancellation.update({ where: { id: recoveredMain.process.originCancellationId }, data: { cancelledAt: eventAt } });
      await prisma.reassignment.update({ where: { id: recoveredMain.process.id }, data: { finishedAt: nextDay } });
      const later = (await get({ from: '2025-01-16', to: '2025-01-16', branchId: ids.branchA1 })).body.data;
      assert.deepEqual(later.slots, { released: 0, recovered: 1, recoveryRatePct: 0 });
      await prisma.reassignment.update({ where: { id: recoveredMain.process.id }, data: { finishedAt: eventAt } });
      // Completion without the accepted association is insufficient evidence.
      await prisma.appointmentOffer.update({ where: { id: recoveredMain.accepted.id }, data: { status: 'INVALIDATED' } });
      assert.equal((await get({ branchId: ids.branchA1 })).body.data.slots.recovered, 0);
      await prisma.appointmentOffer.update({ where: { id: recoveredMain.accepted.id }, data: { status: 'ACCEPTED' } });
    });
    await t.test('inactive catalogs preserve historical indicators', async () => {
      await prisma.branch.update({ where: { id: ids.branchA2 }, data: { status: 'INACTIVE' } });
      await prisma.service.update({ where: { id: ids.serviceA2 }, data: { active: false } });
      await prisma.professional.update({ where: { id: ids.professionalA2 }, data: { status: 'INACTIVE' } });
      assert.deepEqual((await get({ branchId: ids.branchA2, serviceId: ids.serviceA2, professionalId: ids.professionalA2 })).body.data, single);
    });
    await t.test('GET changes no persisted business rows, including overdue PENDING offers', async () => {
      const snapshot = async () => ({
        appointments: await prisma.appointment.findMany({ where: { id: { in: appointments } }, orderBy: { id: 'asc' } }),
        cancellations: await prisma.cancellation.findMany({ where: { appointmentId: { in: appointments } }, orderBy: { id: 'asc' } }),
        history: await prisma.appointmentHistory.findMany({ where: { appointmentId: { in: appointments } }, orderBy: { id: 'asc' } }),
        slots: await prisma.agendaSlot.findMany({ where: { id: { in: slots } }, orderBy: { id: 'asc' } }),
        reassignments: await prisma.reassignment.findMany({ where: { id: { in: processes } }, orderBy: { id: 'asc' } }),
        offers: await prisma.appointmentOffer.findMany({ where: { reassignmentId: { in: processes } }, orderBy: { id: 'asc' } }),
        candidates: await prisma.reassignmentCandidate.findMany({ where: { reassignmentId: { in: processes } }, orderBy: { id: 'asc' } }),
        waitlist: await prisma.waitlistEntry.findMany({ where: { id: { in: entries } }, orderBy: { id: 'asc' } }),
      });
      const before = await snapshot(); await get(); await get({ branchId: ids.branchA2 }); assert.deepEqual(await snapshot(), before);
      assert.equal((await prisma.appointmentOffer.findUniqueOrThrow({ where: { id: overdueOffer.id } })).status, 'PENDING');
    });
    await t.test('real HU-017 timestamp counts an older appointment and repeated attendance is idempotent', async () => {
      const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
      assert.equal((await get({ from: today, to: today })).body.data.appointments.noShows, 0);
      for (let i = 0; i < 2; i++) assert.equal((await request('POST', `/appointments/${boundary.id}/attendance`, admin.token,
        { status: 'INASISTENCIA' }, headers)).status, 200);
      const events = await prisma.appointmentHistory.findMany({ where: { appointmentId: boundary.id, reason: 'NO_SHOW_RECORDED' } });
      assert.equal(events.length, 1); assert.ok(events[0].occurredAt instanceof Date);
      assert.equal((await get({ from: today, to: today })).body.data.appointments.noShows, 1);
    });
    await t.test('compatible with real booking, cancellation, offer generation, rejection and acceptance', async () => {
      const recipients = [];
      for (let i = 0; i < 2; i++) {
        const user = await register(); recipients.push(user);
        const entry = await request('POST', '/waitlist', user.token, { serviceId: ids.serviceA, branchId: ids.branchA1 });
        assert.equal(entry.status, 201); entries.push(entry.body.data.id);
        assert.equal((await request('PUT', `/waitlist/${entry.body.data.id}/preferences`, user.token, {
          preferredDays: [1, 2, 3, 4, 5, 6, 7], timeRanges: [{ start: '00:00', end: '23:59' }], preferredBranchIds: [],
          allowsOtherBranches: false, acceptsAnyProfessional: true,
        })).status, 200);
      }
      const booking = await request('POST', '/appointments', source.token, { agendaSlotId: ids.slotAvailable });
      assert.equal(booking.status, 201);
      assert.equal((await cancelWithBlockedSlot(prisma, booking.body.data.id, () => request('POST', `/appointments/${booking.body.data.id}/cancel`, source.token))).status, 200);
      const generation = await request('POST', `/reassignments/${ids.slotAvailable}/offers`, admin.token, undefined, headers);
      assert.equal(generation.status, 201); processes.push(generation.body.data.id);
      const pending = await prisma.appointmentOffer.findFirstOrThrow({ where: { reassignmentId: generation.body.data.id, status: 'PENDING' }, include: { candidate: true } });
      const rejector = recipients.find((user) => user.id === pending.candidate.userId);
      assert.equal((await request('POST', `/reassignments/offers/${pending.id}/reject`, rejector.token)).status, 200);
      const next = await prisma.appointmentOffer.findFirstOrThrow({ where: { reassignmentId: generation.body.data.id, status: 'PENDING' }, include: { candidate: true } });
      const acceptor = recipients.find((user) => user.id === next.candidate.userId);
      assert.equal((await request('POST', `/reassignments/offers/${next.id}/accept`, acceptor.token)).status, 200);
      assert.equal((await request('POST', `/reassignments/offers/${next.id}/accept`, acceptor.token)).status, 200);
      const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
      const report = (await get({ from: today, to: today })).body.data;
      assert.deepEqual(report.slots, { released: 1, recovered: 1, recoveryRatePct: 100 });
      assert.equal(report.appointments.cancelled, 1);
      assert.deepEqual(report.offers, { sent: 2, accepted: 1, rejected: 1, expired: 0 });
    });
  } finally {
    try {
      if (prisma && cleanupEnabled) {
        await prisma.appointmentOffer.deleteMany({ where: { reassignmentId: { in: processes } } });
        await prisma.reassignmentCandidate.deleteMany({ where: { reassignmentId: { in: processes } } });
        await prisma.reassignment.deleteMany({ where: { id: { in: processes } } });
        await prisma.waitlistPreferredDay.deleteMany({ where: { preference: { waitlistEntryId: { in: entries } } } });
        await prisma.waitlistTimeRange.deleteMany({ where: { preference: { waitlistEntryId: { in: entries } } } });
        await prisma.waitlistPreferredBranch.deleteMany({ where: { waitlistEntryId: { in: entries } } });
        await prisma.waitlistPreference.deleteMany({ where: { waitlistEntryId: { in: entries } } });
        await prisma.waitlistEntry.deleteMany({ where: { id: { in: entries } } });
        await prisma.cancellation.deleteMany({ where: { appointmentId: { in: appointments } } });
        await prisma.appointmentHistory.deleteMany({ where: { appointmentId: { in: appointments } } });
        await prisma.appointment.deleteMany({ where: { id: { in: appointments } } });
        await prisma.agendaSlot.deleteMany({ where: { id: { in: slots } } });
        await prisma.priority.deleteMany({ where: { institutionId: ids.institutionA, code: 'STANDARD' } });
        await cleanupReportsFixtures(prisma);
        await prisma.permission.deleteMany({ where: { id: { in: ownedPermissions } } });
        await prisma.appointmentStatus.deleteMany({ where: { id: { in: ownedStatuses } } });
        await prisma.waitlistStatus.deleteMany({ where: { id: { in: ownedWaitlistStatuses } } });
        await assertReportsClean(prisma);
      }
    } finally { await app.close(); }
  }
});
