import { cancelWithBlockedSlot } from './manual-release.fixture.mjs';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { NestFactory } from '@nestjs/core';
import { createAuthSession, createHttpClient } from '@citajusta/client-core';
import { createReassignmentModel } from '../../../desktop/src/reassignments/reassignment-model.ts';
import { createMemorySessionStorage } from '../../../desktop/src/auth/memory-session-storage.ts';
import { loadApiEnvironment, assertSafeLocalDatabaseUrl, getE2ePort } from './local-environment.mjs';
import { FIXTURE_EMAIL_PREFIX, ids, cleanupCheckpointFixtures, createCheckpointFixtures, assertCheckpointIsClean } from './fixture.mjs';

test('HU-009/HU-010/HU-011/HU-016 real HTTP and PostgreSQL reassignment flow', { timeout: 120_000 }, async (t) => {
  loadApiEnvironment(); assertSafeLocalDatabaseUrl(process.env.DATABASE_URL); process.env.NODE_ENV = 'test';
  process.env.WAITLIST_OFFER_TTL_MINUTES = '10';
  const [{ AppModule }, { configureApplication }, { PrismaService }, { bootstrapWaitlist }, { bootstrapAppointmentStatus }] = await Promise.all([
    import('../../dist/app.module.js'), import('../../dist/app.configuration.js'), import('../../dist/database/prisma.service.js'),
    import('../../dist/database/waitlist.bootstrap.js'), import('../../dist/database/appointment-status.bootstrap.js'),
  ]);
  const app = await NestFactory.create(AppModule, { logger: false });
  let prisma; let cleanupEnabled = false; let ownedPermission; let ownedSupervisionPermission;
  const users = []; const statusIds = []; const appointmentStatusIds = [];
  const listingFixture = { slots: [], appointments: [], cancellations: [], reassignments: [], rows: [] };
  const permissionCode = 'reassignments.generate';
  try {
    configureApplication(app); await app.listen(getE2ePort(), '127.0.0.1');
    prisma = app.get(PrismaService); await cleanupCheckpointFixtures(prisma); cleanupEnabled = true;
    const base = `http://127.0.0.1:${app.getHttpServer().address().port}`;
    async function request(method, path, token, body, headers = {}) {
      const response = await fetch(`${base}${path}`, { method,
        headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      return { status: response.status, body: await response.json() };
    }
    async function register() {
      const credentials = { email: `${FIXTURE_EMAIL_PREFIX}${randomUUID()}@example.com`, password: `Test-${randomUUID()}-Aa1!` };
      const result = await request('POST', '/api/v1/auth/register', undefined, { ...credentials, firstName: 'Offers', lastName: 'Fixture' });
      assert.equal(result.status, 201); users.push(result.body.id);
      const login = await request('POST', '/api/v1/auth/login', undefined, credentials); assert.equal(login.status, 200);
      return { id: result.body.id, token: login.body.accessToken, credentials };
    }
    const admin = await register(); const source = await register();
    await createCheckpointFixtures(prisma, admin.id);
    const existingPermission = await prisma.permission.findUnique({ where: { code: permissionCode } });
    const permission = existingPermission ?? await prisma.permission.create({ data: { id: randomUUID(), code: permissionCode, module: 'reassignments', action: 'generate' } });
    if (!existingPermission) ownedPermission = permission.id;
    await prisma.rolePermission.create({ data: { roleId: ids.roleInstitution, permissionId: permission.id } });
    const existingReadPermission = await prisma.permission.findUnique({ where: { code: 'reassignments.read' } });
    const readPermission = existingReadPermission ?? await prisma.permission.create({ data: {
      id: randomUUID(), code: 'reassignments.read', module: 'reassignments', action: 'read',
    } });
    if (!existingReadPermission) ownedSupervisionPermission = readPermission.id;
    await prisma.rolePermission.create({ data: { roleId: ids.roleInstitution, permissionId: readPermission.id } });
    const otherOfficer = await register();
    await prisma.userRole.create({ data: { id: randomUUID(), userId: otherOfficer.id, roleId: ids.roleInstitution, institutionId: ids.institutionB } });
    const originalStates = await prisma.waitlistStatus.findMany({ where: { code: { in: ['ACTIVE', 'WITHDRAWN', 'FULFILLED'] } }, select: { id: true } });
    await bootstrapWaitlist(prisma, ids.institutionA);
    const waitlistStates = await prisma.waitlistStatus.findMany({ where: { code: { in: ['ACTIVE', 'WITHDRAWN', 'FULFILLED'] } } });
    statusIds.push(...waitlistStates.filter((s) => !originalStates.some((old) => old.id === s.id)).map((s) => s.id));
    const originalAppointments = await prisma.appointmentStatus.findMany({ where: { code: { in: ['AGENDADA', 'CANCELADA'] } }, select: { id: true } });
    await bootstrapAppointmentStatus(prisma);
    const appointmentStates = await prisma.appointmentStatus.findMany({ where: { code: { in: ['AGENDADA', 'CANCELADA'] } } });
    appointmentStatusIds.push(...appointmentStates.filter((s) => !originalAppointments.some((old) => old.id === s.id)).map((s) => s.id));
    async function createListingFixtures() {
      const cancelledStatus = appointmentStates.find((status) => status.code === 'CANCELADA');
      assert.ok(cancelledStatus);
      const [mainAvailability, otherAvailability] = await Promise.all([
        prisma.availability.findUniqueOrThrow({ where: { id: ids.availabilityMain }, include: { branch: true } }),
        prisma.availability.findUniqueOrThrow({ where: { id: ids.availabilityOtherContext }, include: { branch: true } }),
      ]);
      const rows = [];
      const add = (status, detectedAt, availability = mainAvailability, precision, appointmentBranchId = availability.branchId) => {
        const id = randomUUID(); const slotId = randomUUID(); const appointmentId = randomUUID(); const cancellationId = randomUUID();
        const offset = rows.length * 3_600_000;
        const startsAt = new Date(Date.UTC(2040, 0, 1, 8, 0, 0, 0) + offset);
        const terminal = ['COMPLETED', 'EXHAUSTED', 'CANCELLED', 'FAILED'].includes(status);
        rows.push({ id, slotId, appointmentId, cancellationId, status, detectedAt, availability, startsAt, precision, appointmentBranchId, terminal });
        listingFixture.slots.push(slotId); listingFixture.appointments.push(appointmentId);
        listingFixture.cancellations.push(cancellationId); listingFixture.reassignments.push(id);
      };

      add('PENDING', new Date('2030-01-01T00:00:00.000Z'));
      add('PENDING', new Date('2030-01-01T00:00:01.000Z'), mainAvailability, undefined, ids.branchA2);
      add('EVALUATING', new Date('2030-01-01T00:00:01.000Z'));
      add('OFFERING', new Date('2030-01-01T00:00:02.000Z'));
      add('COMPLETED', new Date('2045-01-01T00:00:00.000Z'));
      add('COMPLETED', new Date('2045-01-01T00:00:00.000Z'));
      add('EXHAUSTED', new Date('2044-01-01T00:00:00.000Z'), mainAvailability, '2044-01-01 00:00:00.123456');
      add('EXHAUSTED', new Date('2044-01-01T00:00:00.000Z'), mainAvailability, '2044-01-01 00:00:00.123454');
      add('EXHAUSTED', new Date('2044-01-01T00:00:00.000Z'), mainAvailability, '2044-01-01 00:00:00.123457', ids.branchA2);
      add('EXHAUSTED', new Date('2044-01-01T00:00:00.000Z'), mainAvailability, '2044-01-01 00:00:00.123455', ids.branchA2);
      add('EXHAUSTED', new Date('2043-01-01T00:00:00.000Z'), otherAvailability);
      add('CANCELLED', new Date('2030-01-01T00:00:03.000Z'));
      for (let index = 0; index < 51; index += 1) add('FAILED', new Date(Date.UTC(2031, 0, 1, 0, 0, index)));
      // Multiple fully inconsistent batches, mixed page boundaries and an inconsistent tail.
      for (const [index, consistent] of [false, false, false, false, true, false, true, false, true, false, false].entries()) {
        add('CANCELLED', new Date(Date.UTC(2046, 0, 1, 0, 0, 30 - index)), mainAvailability, undefined,
          consistent ? ids.branchA1 : ids.branchA2);
      }
      // This branch/status scope has only inconsistent records and must end with an empty page.
      for (let index = 0; index < 4; index += 1) {
        add('EVALUATING', new Date(Date.UTC(2046, 0, 2, 0, 0, index)), otherAvailability, undefined, ids.branchA1);
      }

      await prisma.agendaSlot.createMany({ data: rows.map((row) => ({
        id: row.slotId, availabilityId: row.availability.id, startsAt: row.startsAt,
        endsAt: new Date(row.startsAt.getTime() + 30 * 60_000), status: 'AVAILABLE',
      })) });
      await prisma.appointment.createMany({ data: rows.map((row) => ({
        id: row.appointmentId, institutionId: row.availability.branch.institutionId, branchId: row.appointmentBranchId,
        serviceId: row.availability.serviceId, professionalId: row.availability.professionalId,
        attentionPointId: row.availability.attentionPointId, agendaSlotId: row.slotId, userId: source.id,
        statusId: cancelledStatus.id, origin: 'WEB', startsAt: row.startsAt,
        endsAt: new Date(row.startsAt.getTime() + 30 * 60_000), createdByUserId: source.id,
      })) });
      await prisma.cancellation.createMany({ data: rows.map((row) => ({
        id: row.cancellationId, appointmentId: row.appointmentId, cancelledByUserId: source.id,
        releasesSlot: true, cancelledAt: row.startsAt,
      })) });
      await prisma.reassignment.createMany({ data: rows.map((row) => ({
        id: row.id, institutionId: row.availability.branch.institutionId, originCancellationId: row.cancellationId,
        appointmentId: row.appointmentId, agendaSlotId: row.slotId, serviceId: row.availability.serviceId,
        sourceUserId: source.id, status: row.status, initialSlotVersion: 0, ruleCode: 'PRIORITY_FIFO_V1',
        scoringVersion: 'priority-level-asc-fifo-v1', criteriaSnapshot: { fixture: 'rf038-listing' },
        detectedAt: row.detectedAt, ...(row.terminal ? { startedAt: row.detectedAt, finishedAt: row.detectedAt, closureReasonCode: 'E2E_FIXTURE' } : {}),
      })) });
      for (const row of rows.filter((item) => item.precision)) {
        // Schema and migration define this as "reasignaciones"."detectada_at" TIMESTAMP(6).
        // The fixed SQL and UUID bind variables can only target records created immediately above.
        await prisma.$executeRawUnsafe(
          'UPDATE "reasignaciones" SET "detectada_at" = $1::timestamp(6) WHERE "id" = $2::uuid',
          row.precision,
          row.id,
        );
      }
      listingFixture.rows.push(...rows);
      return rows;
    }
    const listingSnapshot = async () => ({
      processes: await prisma.reassignment.findMany({ where: { id: { in: listingFixture.reassignments } }, orderBy: { id: 'asc' } }),
      slots: await prisma.agendaSlot.findMany({ where: { id: { in: listingFixture.slots } }, orderBy: { id: 'asc' } }),
      appointments: await prisma.appointment.findMany({ where: { id: { in: listingFixture.appointments } }, orderBy: { id: 'asc' } }),
      cancellations: await prisma.cancellation.findMany({ where: { id: { in: listingFixture.cancellations } }, orderBy: { id: 'asc' } }),
    });
    const headers = { 'x-institution-id': ids.institutionA };
    const supervise = (id, token = admin.token, scope = headers) => request('GET', `/api/v1/reassignments/${id}`, token, undefined, scope);
    const list = (query = '', token = admin.token, scope = headers) => request('GET', `/api/v1/reassignments${query}`, token, undefined, scope);
    const generate = (slotId = ids.slotAvailable, token = admin.token, extra = headers, body) => request('POST', `/api/v1/reassignments/${slotId}/offers`, token, body, extra);
    const preferences = { preferredDays: [1, 2, 3, 4, 5, 6, 7], timeRanges: [{ start: '00:00', end: '23:59' }], preferredBranchIds: [], allowsOtherBranches: false, acceptsAnyProfessional: true };
    async function enroll(patch = {}, serviceId = ids.serviceA) {
      const user = await register();
      const response = await request('POST', '/api/v1/waitlist', user.token, { serviceId, branchId: serviceId === ids.serviceA ? ids.branchA1 : ids.branchA2 });
      assert.equal(response.status, 201);
      const entryId = response.body.data.id;
      const saved = await request('PUT', `/api/v1/waitlist/${entryId}/preferences`, user.token, { ...preferences, ...patch });
      assert.equal(saved.status, 200);
      return { ...user, entryId };
    }
    const a = await enroll(); const b = await enroll();
    const excluded = await enroll({ acceptsAnyProfessional: false });
    const withdrawn = await enroll(); const otherService = await enroll({}, ids.serviceA2);
    assert.equal((await request('POST', `/api/v1/waitlist/${withdrawn.entryId}/withdraw`, withdrawn.token)).status, 200);
    const deleted = await enroll(); await prisma.waitlistEntry.update({ where: { id: deleted.entryId }, data: { deletedAt: new Date() } });
    const tiedAt = new Date('2026-01-01T12:00:00Z');
    await prisma.waitlistEntry.updateMany({ where: { id: { in: [a.entryId, b.entryId] } }, data: { enteredAt: tiedAt } });
    const expectedWinner = [a.entryId, b.entryId].sort()[0];
    const winnerUser = a.entryId === expectedWinner ? a : b;
    const nonWinner = a.entryId === expectedWinner ? b : a;
    const mine = (token, headers = {}) => request('GET', '/api/v1/reassignments/offers/me', token, undefined, headers);
    await t.test('HU-022 own offers require auth, reject query and return empty without institutional role', async () => {
      assert.equal((await mine(null)).status, 401);
      assert.deepEqual(await mine(winnerUser.token), { status: 200, body: { data: [] } });
      assert.equal((await request('GET', `/api/v1/reassignments/offers/me?userId=${source.id}`, winnerUser.token)).status, 400);
      assert.equal((await request('GET', `/api/v1/reassignments/offers/me?institutionId=${ids.institutionA}`, winnerUser.token)).status, 400);
    });
    const beforeEntries = await prisma.waitlistEntry.findMany({ where: { userId: { in: users } }, orderBy: { id: 'asc' } });

    await t.test('generation requires explicit permission and institutional scope, rejects arbitrary inputs', async () => {
      assert.equal((await generate(ids.slotAvailable, null)).status, 401);
      assert.equal((await generate(ids.slotAvailable, source.token)).status, 403);
      assert.equal((await generate(ids.slotAvailable, admin.token, { 'x-institution-id': ids.institutionB })).status, 403);
      assert.equal((await generate(ids.slotAvailable, admin.token, {})).status, 403);
      assert.equal((await generate(ids.slotAvailable, admin.token, headers, { userId: source.id })).status, 400);
      assert.equal((await request('POST', `/api/v1/reassignments/${ids.slotAvailable}/offers?ttl=1`, admin.token, undefined, headers)).status, 400);
      assert.equal((await generate('bad')).status, 400);
      assert.equal((await generate(randomUUID())).status, 404);
      assert.equal((await generate(ids.slotOtherContext, admin.token, { ...headers, 'x-branch-id': ids.branchA1 })).status, 404);
      assert.equal((await generate()).status, 409);
    });
    const booking = await request('POST', '/api/v1/appointments', source.token, { agendaSlotId: ids.slotAvailable });
    assert.equal(booking.status, 201);
    const appointmentId = booking.body.data.id;
    // Owned historical fixture: actual offer acceptance below must not transfer this intent.
    const previousConfirmation = await prisma.confirmation.create({ data: { id: randomUUID(), appointmentId, userId: source.id, confirmed: true } });
    assert.equal((await cancelWithBlockedSlot(prisma, appointmentId, () => request('POST', `/api/v1/appointments/${appointmentId}/cancel`, source.token))).status, 200);
    const appointmentBefore = await prisma.appointment.findUniqueOrThrow({ where: { id: appointmentId }, include: { historyEntries: true, cancellations: true } });
    const slotBefore = await prisma.agendaSlot.findUniqueOrThrow({ where: { id: ids.slotAvailable } });

    await t.test('rollback after real offer INSERT restores slot, process, candidates and offer', async () => {
      const originalTransaction = prisma.$transaction.bind(prisma); let inserted = false;
      prisma.$transaction = (fn, options) => originalTransaction((tx) => fn(new Proxy(tx, {
        get(target, key) {
          if (key !== 'appointmentOffer') return target[key];
          return new Proxy(target.appointmentOffer, { get(delegate, property) {
            if (property !== 'create') return delegate[property];
            return async (args) => { await delegate.create(args); inserted = true; throw new Error('private injected storage failure'); };
          } });
        },
      })), options);
      try {
        const result = await generate(); assert.equal(result.status, 500); assert.ok(inserted);
        assert.ok(!JSON.stringify(result.body).includes('private injected'));
      } finally { prisma.$transaction = originalTransaction; }
      assert.deepEqual(await prisma.agendaSlot.findUniqueOrThrow({ where: { id: ids.slotAvailable } }), slotBefore);
      assert.equal(await prisma.reassignment.count({ where: { agendaSlotId: ids.slotAvailable } }), 0);
      assert.equal(await prisma.reassignmentCandidate.count({ where: { userId: { in: users } } }), 0);
      assert.equal(await prisma.appointmentOffer.count({ where: { agendaSlotId: ids.slotAvailable } }), 0);
    });
    let generation;
    await t.test('two concurrent requests produce one 201, one 409, one process/offer and one slot version increment', async () => {
      const originalTransaction = prisma.$transaction.bind(prisma);
      let reads = 0; let release;
      const barrier = new Promise((resolve) => { release = resolve; }); const timer = setTimeout(release, 5000);
      prisma.$transaction = (fn, options) => originalTransaction((tx) => fn(new Proxy(tx, {
        get(target, key) {
          if (key !== 'agendaSlot') return target[key];
          return new Proxy(target.agendaSlot, { get(delegate, property) {
            if (property !== 'findFirst') return delegate[property];
            return async (args) => { const result = await delegate.findFirst(args); if (++reads <= 2) { if (reads === 2) release(); await barrier; } return result; };
          } });
        },
      })), options);
      try {
        const results = await Promise.all([generate(), generate()]);
        assert.deepEqual(results.map((r) => r.status).sort(), [201, 409]); assert.equal(reads, 3);
        generation = results.find((result) => result.status === 201).body.data;
      } finally { clearTimeout(timer); prisma.$transaction = originalTransaction; }
      assert.equal(await prisma.reassignment.count({ where: { agendaSlotId: ids.slotAvailable } }), 1);
      assert.equal(await prisma.appointmentOffer.count({ where: { agendaSlotId: ids.slotAvailable } }), 1);
      const current = await prisma.agendaSlot.findUniqueOrThrow({ where: { id: ids.slotAvailable } });
      assert.equal(current.lockVersion, slotBefore.lockVersion + 1); assert.equal(current.status, 'RELEASED');
      assert.equal((await generate()).status, 409);
    });
    await t.test('HU-022 recipient reads only own public offer, not another account, regardless of identity headers', async () => {
      const before = await prisma.appointmentOffer.findUniqueOrThrow({ where: { id: generation.offer.id } });
      const result = await mine(winnerUser.token);
      assert.equal(result.status, 200); assert.equal(result.body.data.length, 1);
      const offered = result.body.data[0];
      const slot = await prisma.agendaSlot.findUniqueOrThrow({ where: { id: ids.slotAvailable }, include: { availability: { include: { service: true, branch: true, professional: { include: { user: true } } } } } });
      assert.deepEqual(offered, {
        id: before.id, status: 'PENDING', createdAt: before.createdAt.toISOString(), expiresAt: before.expiresAt.toISOString(), respondedAt: null,
        startsAt: slot.startsAt.toISOString(), endsAt: slot.endsAt.toISOString(),
        service: { id: slot.availability.service.id, name: slot.availability.service.name },
        branch: { id: slot.availability.branch.id, name: slot.availability.branch.name },
        professional: { id: slot.availability.professional.id, firstNames: slot.availability.professional.user.firstNames, lastNames: slot.availability.professional.user.lastNames },
      });
      assert.deepEqual((await mine(nonWinner.token)).body, { data: [] });
      assert.deepEqual((await mine(source.token, { 'x-user-id': winnerUser.id, 'x-institution-id': ids.institutionA })).body, { data: [] });
      assert.deepEqual((await mine(winnerUser.token, { 'x-institution-id': ids.institutionB })).body, result.body);
      assert.deepEqual(await prisma.appointmentOffer.findUniqueOrThrow({ where: { id: before.id } }), before);
    });
    await t.test('HU-016 authenticated officers see candidates and pending offer only within authorized scope', async () => {
      const response = await supervise(generation.id);
      assert.equal(response.status, 200);
      assert.equal(response.body.data.status, 'OFFERING');
      assert.equal(response.body.data.activeOfferId, generation.offer.id);
      assert.equal(response.body.data.pendingOfferId, generation.offer.id);
      assert.equal(response.body.data.candidates.length, 3);
      assert.equal(response.body.data.offers.length, 1);
      assert.equal(response.body.data.evaluation.initiation.kind, 'AUTHORIZED_REQUEST');
      assert.equal(response.body.data.evaluation.initiation.actorUserId, admin.id);
      assert.equal(response.body.data.candidates[2].exclusionReasonCode, 'SPECIFIC_PROFESSIONAL_UNDEFINED');
      assert.equal((await supervise(generation.id, null)).status, 401);
      assert.equal((await supervise(generation.id, source.token)).status, 403);
      assert.equal((await supervise(generation.id, otherOfficer.token)).status, 403);
      const foreign = await supervise(generation.id, otherOfficer.token, { 'x-institution-id': ids.institutionB });
      const missing = await supervise(randomUUID(), otherOfficer.token, { 'x-institution-id': ids.institutionB });
      assert.equal(foreign.status, 404); assert.deepEqual(foreign.body, missing.body);
      assert.equal((await supervise(generation.id, admin.token, { ...headers, 'x-branch-id': ids.branchA2 })).status, 404);
      assert.equal((await supervise('bad')).status, 400);
      assert.equal((await request('GET', `/api/v1/reassignments/${generation.id}?userId=${source.id}`, admin.token, undefined, headers)).status, 400);
    });
    await t.test('persisted candidates have deterministic ranking, exclusion and complete independent snapshots', async () => {
      const candidates = await prisma.reassignmentCandidate.findMany({ where: { reassignmentId: generation.id }, orderBy: { rankingPosition: 'asc' } });
      assert.equal(candidates.length, 3);
      assert.equal(candidates[0].waitlistEntryId, expectedWinner); assert.equal(candidates[0].rankingPosition, 1);
      assert.equal(candidates[1].rankingPosition, 2);
      for (const candidate of candidates.slice(0, 2)) {
        assert.equal(candidate.evaluationStatus, 'ELIGIBLE'); assert.equal(candidate.totalScore.toNumber(), 0);
        const entry = beforeEntries.find((e) => e.id === candidate.waitlistEntryId);
        assert.deepEqual(candidate.entryUpdatedAtSnapshot, entry.updatedAt); assert.equal(candidate.priorityId, entry.priorityId);
        assert.equal(candidate.evaluationContext.enteredAt, entry.enteredAt.toISOString());
        assert.equal(candidate.evaluationContext.statusCode, 'ACTIVE'); assert.equal(candidate.priorityLevelSnapshot, 0);
      }
      const rejected = candidates.find((candidate) => candidate.waitlistEntryId === excluded.entryId);
      assert.equal(rejected.evaluationStatus, 'EXCLUDED'); assert.equal(rejected.exclusionReasonCode, 'SPECIFIC_PROFESSIONAL_UNDEFINED');
      assert.equal(rejected.rankingPosition, null);
      assert.ok(!candidates.some((c) => [withdrawn.entryId, deleted.entryId, otherService.entryId].includes(c.waitlistEntryId)));
      const offer = await prisma.appointmentOffer.findUniqueOrThrow({ where: { id: generation.offer.id } });
      assert.equal(offer.candidateId, candidates[0].id); assert.equal(offer.status, 'PENDING');
      assert.equal(offer.expiresAt.getTime() - offer.createdAt.getTime(), 600_000);
      assert.equal(offer.expectedSlotVersion, slotBefore.lockVersion + 1);
      assert.deepEqual(Object.keys(generation.offer).sort(), ['agendaSlotId', 'createdAt', 'expiresAt', 'id', 'status']);
      assert.equal((await request('PUT', `/api/v1/waitlist/${nonWinner.entryId}/preferences`, nonWinner.token, { ...preferences, preferredDays: [1] })).status, 200);
      assert.deepEqual(await prisma.reassignmentCandidate.findMany({ where: { reassignmentId: generation.id }, orderBy: { rankingPosition: 'asc' } }), candidates);

      // This test intentionally mutates the runner-up after candidate evaluation. Restore both
      // preferences and updatedAt so the later HU-011 continuation tests start from the exact
      // snapshot that was evaluated by HU-009 instead of leaking state between subtests.
      const runnerUpSnapshot = candidates.find((candidate) => candidate.waitlistEntryId === nonWinner.entryId);
      assert.ok(runnerUpSnapshot);
      assert.equal((await request('PUT', `/api/v1/waitlist/${nonWinner.entryId}/preferences`, nonWinner.token, preferences)).status, 200);
      await prisma.waitlistEntry.update({
        where: { id: nonWinner.entryId },
        data: { updatedAt: runnerUpSnapshot.entryUpdatedAtSnapshot },
      });
    });
    await t.test('existing appointment stays unique, cancelled and unchanged; no transfer or history writes', async () => {
      assert.equal(await prisma.appointment.count({ where: { agendaSlotId: ids.slotAvailable } }), 1);
      assert.deepEqual(await prisma.appointment.findUniqueOrThrow({ where: { id: appointmentId }, include: { historyEntries: true, cancellations: true } }), appointmentBefore);
    });
    await t.test('expired timestamp alone does not auto-expire, regenerate or accept an offer', async () => {
      const createdAt = new Date(Date.now() - 120000); const expiresAt = new Date(Date.now() - 60000);
      await prisma.appointmentOffer.update({ where: { id: generation.offer.id }, data: { createdAt, expiresAt } });
      assert.equal((await generate()).status, 409);
      assert.equal((await request('POST', `/api/v1/reassignments/offers/${generation.offer.id}/accept`, winnerUser.token)).status, 409);
      assert.equal((await prisma.appointmentOffer.findUniqueOrThrow({ where: { id: generation.offer.id } })).status, 'PENDING');
      const supervision = await supervise(generation.id);
      assert.equal(supervision.body.data.pendingOfferId, generation.offer.id);
      assert.equal(supervision.body.data.activeOfferId, null);
      assert.equal(supervision.body.data.offers[0].status, 'PENDING');
    });
    await t.test('no eligible candidate persists EXHAUSTED evaluation without an offer or new appointment', async () => {
      assert.equal((await request('PUT', `/api/v1/waitlist/${otherService.entryId}/preferences`, otherService.token,
        { ...preferences, acceptsAnyProfessional: false })).status, 200);
      const reserved = await request('POST', '/api/v1/appointments', source.token, { agendaSlotId: ids.slotOtherContext });
      assert.equal(reserved.status, 201);
      assert.equal((await cancelWithBlockedSlot(prisma, reserved.body.data.id, () => request('POST', `/api/v1/appointments/${reserved.body.data.id}/cancel`, source.token))).status, 200);
      const response = await generate(ids.slotOtherContext);
      assert.equal(response.status, 201); assert.equal(response.body.data.status, 'EXHAUSTED'); assert.equal(response.body.data.offer, null);
      const process = await prisma.reassignment.findUniqueOrThrow({ where: { id: response.body.data.id }, include: { candidates: true } });
      assert.equal(process.closureReasonCode, 'NO_ELIGIBLE_CANDIDATES'); assert.ok(process.finishedAt);
      assert.equal(process.candidates.length, 1); assert.equal(process.candidates[0].exclusionReasonCode, 'SPECIFIC_PROFESSIONAL_UNDEFINED');
      assert.equal(await prisma.appointmentOffer.count({ where: { agendaSlotId: ids.slotOtherContext } }), 0);
      assert.equal(await prisma.appointment.count({ where: { agendaSlotId: ids.slotOtherContext } }), 1);
      assert.equal((await generate(ids.slotOtherContext)).status, 409);
      const supervision = await supervise(process.id);
      assert.equal(supervision.status, 200); assert.equal(supervision.body.data.status, 'EXHAUSTED');
      assert.equal(supervision.body.data.activeOfferId, null); assert.deepEqual(supervision.body.data.offers, []);
    });


    let acceptanceOfferId = generation.offer.id;
    let acceptanceUser = winnerUser;

    await t.test('rejection requires recipient identity, rejects arbitrary input and keeps expired offers pending', async () => {
      const future = new Date(Date.now() + 600_000);
      await prisma.appointmentOffer.update({
        where: { id: generation.offer.id },
        data: { createdAt: new Date(), expiresAt: future },
      });
      assert.equal((await request('POST', `/api/v1/reassignments/offers/${generation.offer.id}/reject`, null)).status, 401);
      assert.equal((await request('POST', `/api/v1/reassignments/offers/${generation.offer.id}/reject`, source.token)).status, 404);
      assert.equal((await request('POST', `/api/v1/reassignments/offers/${generation.offer.id}/reject?userId=${winnerUser.id}`, winnerUser.token)).status, 400);
      assert.equal((await request('POST', `/api/v1/reassignments/offers/${generation.offer.id}/reject`, winnerUser.token, { userId: winnerUser.id })).status, 400);
      assert.equal((await request('POST', '/api/v1/reassignments/offers/bad/reject', winnerUser.token)).status, 400);
      assert.equal((await request('POST', `/api/v1/reassignments/offers/${randomUUID()}/reject`, winnerUser.token)).status, 404);

      const expiredCreatedAt = new Date(Date.now() - 120_000);
      const expiredAt = new Date(Date.now() - 60_000);
      await prisma.appointmentOffer.update({
        where: { id: generation.offer.id },
        data: { createdAt: expiredCreatedAt, expiresAt: expiredAt },
      });
      assert.equal((await request('POST', `/api/v1/reassignments/offers/${generation.offer.id}/reject`, winnerUser.token)).status, 409);
      assert.equal((await prisma.appointmentOffer.findUniqueOrThrow({ where: { id: generation.offer.id } })).status, 'PENDING');
      await prisma.appointmentOffer.update({
        where: { id: generation.offer.id },
        data: { createdAt: new Date(), expiresAt: new Date(Date.now() + 600_000) },
      });
    });

    await t.test('rejection rollback restores current offer when next offer persistence fails', async () => {
      const offerBeforeReject = await prisma.appointmentOffer.findUniqueOrThrow({ where: { id: generation.offer.id } });
      const slotBeforeReject = await prisma.agendaSlot.findUniqueOrThrow({ where: { id: ids.slotAvailable } });
      const appointmentBeforeReject = await prisma.appointment.findUniqueOrThrow({ where: { id: appointmentId } });
      const processBeforeReject = await prisma.reassignment.findUniqueOrThrow({ where: { id: generation.id } });
      const originalTransaction = prisma.$transaction.bind(prisma); let inserted = false;
      prisma.$transaction = (fn, options) => originalTransaction((tx) => fn(new Proxy(tx, {
        get(target, key) {
          if (key !== 'appointmentOffer') return target[key];
          return new Proxy(target.appointmentOffer, { get(delegate, property) {
            if (property !== 'create') return delegate[property];
            return async (args) => { await delegate.create(args); inserted = true; throw new Error('private rejection storage failure'); };
          } });
        },
      })), options);
      try {
        const response = await request('POST', `/api/v1/reassignments/offers/${generation.offer.id}/reject`, winnerUser.token);
        assert.equal(response.status, 500); assert.ok(inserted);
        assert.ok(!JSON.stringify(response.body).includes('private rejection'));
      } finally { prisma.$transaction = originalTransaction; }
      assert.deepEqual(await prisma.appointmentOffer.findUniqueOrThrow({ where: { id: generation.offer.id } }), offerBeforeReject);
      assert.deepEqual(await prisma.agendaSlot.findUniqueOrThrow({ where: { id: ids.slotAvailable } }), slotBeforeReject);
      assert.deepEqual(await prisma.appointment.findUniqueOrThrow({ where: { id: appointmentId } }), appointmentBeforeReject);
      assert.deepEqual(await prisma.reassignment.findUniqueOrThrow({ where: { id: generation.id } }), processBeforeReject);
      assert.equal(await prisma.appointmentOffer.count({ where: { reassignmentId: generation.id } }), 1);
    });

    await t.test('concurrent rejection resolves once and continues with the next valid candidate', async () => {
      const slotBeforeReject = await prisma.agendaSlot.findUniqueOrThrow({ where: { id: ids.slotAvailable } });
      const appointmentBeforeReject = await prisma.appointment.findUniqueOrThrow({ where: { id: appointmentId } });
      const winnerEntryBeforeReject = await prisma.waitlistEntry.findUniqueOrThrow({ where: { id: winnerUser.entryId } });

      const results = await Promise.all([
        request('POST', `/api/v1/reassignments/offers/${generation.offer.id}/reject`, winnerUser.token),
        request('POST', `/api/v1/reassignments/offers/${generation.offer.id}/reject`, winnerUser.token),
      ]);
      assert.ok(results.some((result) => result.status === 200));
      assert.ok(results.every((result) => result.status === 200 || result.status === 409));

      const replay = await request('POST', `/api/v1/reassignments/offers/${generation.offer.id}/reject`, winnerUser.token);
      assert.equal(replay.status, 200);
      assert.equal(replay.body.data.offer.status, 'REJECTED');
      assert.equal(replay.body.data.reassignment.status, 'OFFERING');
      assert.ok(replay.body.data.nextOffer);

      const offers = await prisma.appointmentOffer.findMany({
        where: { reassignmentId: generation.id },
        orderBy: { attemptNumber: 'asc' },
      });
      assert.equal(offers.length, 2);
      assert.equal(offers[0].status, 'REJECTED');
      assert.equal(offers[0].respondedByUserId, winnerUser.id);
      assert.equal(offers[0].resolutionReasonCode, 'REJECTED_BY_RECIPIENT');
      assert.equal(offers[0].attemptNumber, 1);
      assert.equal(offers[1].status, 'PENDING');
      assert.equal(offers[1].attemptNumber, 2);
      assert.equal(offers[1].expectedSlotVersion, offers[0].expectedSlotVersion);
      assert.equal(offers[1].expiresAt.getTime() - offers[1].createdAt.getTime(), 600_000);

      const nextCandidate = await prisma.reassignmentCandidate.findUniqueOrThrow({ where: { id: offers[1].candidateId } });
      assert.equal(nextCandidate.waitlistEntryId, nonWinner.entryId);
      assert.deepEqual(await prisma.agendaSlot.findUniqueOrThrow({ where: { id: ids.slotAvailable } }), slotBeforeReject);
      assert.deepEqual(await prisma.appointment.findUniqueOrThrow({ where: { id: appointmentId } }), appointmentBeforeReject);
      assert.deepEqual(await prisma.waitlistEntry.findUniqueOrThrow({ where: { id: winnerUser.entryId } }), winnerEntryBeforeReject);

      acceptanceOfferId = offers[1].id;
      acceptanceUser = nonWinner;
    });

    await t.test('acceptance requires recipient identity and rejects arbitrary input', async () => {
      const future = new Date(Date.now() + 600_000);
      await prisma.appointmentOffer.update({
        where: { id: acceptanceOfferId },
        data: { createdAt: new Date(), expiresAt: future },
      });
      assert.equal((await request('POST', `/api/v1/reassignments/offers/${acceptanceOfferId}/accept`, null)).status, 401);
      assert.equal((await request('POST', `/api/v1/reassignments/offers/${acceptanceOfferId}/accept`, source.token)).status, 404);
      assert.equal((await request('POST', `/api/v1/reassignments/offers/${acceptanceOfferId}/accept?userId=${acceptanceUser.id}`, acceptanceUser.token)).status, 400);
      assert.equal((await request('POST', `/api/v1/reassignments/offers/${acceptanceOfferId}/accept`, acceptanceUser.token, { userId: acceptanceUser.id })).status, 400);
      assert.equal((await request('POST', '/api/v1/reassignments/offers/bad/accept', acceptanceUser.token)).status, 400);
      assert.equal((await request('POST', `/api/v1/reassignments/offers/${randomUUID()}/accept`, acceptanceUser.token)).status, 404);
    });

    await t.test('acceptance rollback restores every write when history persistence fails', async () => {
      const offerBefore = await prisma.appointmentOffer.findUniqueOrThrow({ where: { id: acceptanceOfferId } });
      const slotBeforeAccept = await prisma.agendaSlot.findUniqueOrThrow({ where: { id: ids.slotAvailable } });
      const appointmentBeforeAccept = await prisma.appointment.findUniqueOrThrow({ where: { id: appointmentId } });
      const entryBeforeAccept = await prisma.waitlistEntry.findUniqueOrThrow({ where: { id: acceptanceUser.entryId } });
      const processBeforeAccept = await prisma.reassignment.findUniqueOrThrow({ where: { id: generation.id } });
      const historyCount = await prisma.appointmentHistory.count({ where: { appointmentId } });
      const originalTransaction = prisma.$transaction.bind(prisma); let inserted = false;
      prisma.$transaction = (fn, options) => originalTransaction((tx) => fn(new Proxy(tx, {
        get(target, key) {
          if (key !== 'appointmentHistory') return target[key];
          return new Proxy(target.appointmentHistory, { get(delegate, property) {
            if (property !== 'create') return delegate[property];
            return async (args) => { await delegate.create(args); inserted = true; throw new Error('private acceptance storage failure'); };
          } });
        },
      })), options);
      try {
        const response = await request('POST', `/api/v1/reassignments/offers/${acceptanceOfferId}/accept`, acceptanceUser.token);
        assert.equal(response.status, 500); assert.ok(inserted);
        assert.ok(!JSON.stringify(response.body).includes('private acceptance'));
      } finally { prisma.$transaction = originalTransaction; }
      assert.deepEqual(await prisma.appointmentOffer.findUniqueOrThrow({ where: { id: acceptanceOfferId } }), offerBefore);
      assert.deepEqual(await prisma.agendaSlot.findUniqueOrThrow({ where: { id: ids.slotAvailable } }), slotBeforeAccept);
      assert.deepEqual(await prisma.appointment.findUniqueOrThrow({ where: { id: appointmentId } }), appointmentBeforeAccept);
      assert.deepEqual(await prisma.waitlistEntry.findUniqueOrThrow({ where: { id: acceptanceUser.entryId } }), entryBeforeAccept);
      assert.deepEqual(await prisma.reassignment.findUniqueOrThrow({ where: { id: generation.id } }), processBeforeAccept);
      assert.equal(await prisma.appointmentHistory.count({ where: { appointmentId } }), historyCount);
    });

    await t.test('concurrent acceptance transfers the existing appointment exactly once and replay is idempotent', async () => {
      const historyBefore = await prisma.appointmentHistory.count({ where: { appointmentId } });
      const results = await Promise.all([
        request('POST', `/api/v1/reassignments/offers/${acceptanceOfferId}/accept`, acceptanceUser.token),
        request('POST', `/api/v1/reassignments/offers/${acceptanceOfferId}/accept`, acceptanceUser.token),
      ]);
      assert.ok(results.some((result) => result.status === 200));
      assert.ok(results.every((result) => result.status === 200 || result.status === 409));

      const replay = await request('POST', `/api/v1/reassignments/offers/${acceptanceOfferId}/accept`, acceptanceUser.token);
      assert.equal(replay.status, 200);
      assert.equal(replay.body.data.offer.status, 'ACCEPTED');
      assert.equal(replay.body.data.appointment.status, 'AGENDADA');
      assert.equal(replay.body.data.reassignment.status, 'COMPLETED');

      const offer = await prisma.appointmentOffer.findUniqueOrThrow({ where: { id: acceptanceOfferId } });
      const currentSlot = await prisma.agendaSlot.findUniqueOrThrow({ where: { id: ids.slotAvailable } });
      const currentAppointment = await prisma.appointment.findUniqueOrThrow({
        where: { id: appointmentId }, include: { status: true, historyEntries: { orderBy: { occurredAt: 'asc' } } },
      });
      const currentEntry = await prisma.waitlistEntry.findUniqueOrThrow({
        where: { id: acceptanceUser.entryId }, include: { status: true, preference: true, preferredBranches: true },
      });
      const process = await prisma.reassignment.findUniqueOrThrow({ where: { id: generation.id } });

      assert.equal(await prisma.appointment.count({ where: { agendaSlotId: ids.slotAvailable } }), 1);
      assert.equal(offer.status, 'ACCEPTED'); assert.equal(offer.respondedByUserId, acceptanceUser.id);
      assert.ok(offer.respondedAt); assert.ok(offer.resolvedAt); assert.equal(offer.lockVersion, 1);
      assert.equal(currentSlot.status, 'RESERVED'); assert.equal(currentSlot.lockVersion, slotBefore.lockVersion + 2);
      assert.equal(currentAppointment.userId, acceptanceUser.id); assert.equal(currentAppointment.status.code, 'AGENDADA');
      assert.equal(currentAppointment.origin, 'REASSIGNMENT'); assert.equal(currentAppointment.agendaSlotId, ids.slotAvailable);
      assert.equal(currentEntry.status.code, 'FULFILLED'); assert.equal(currentEntry.status.isFinal, true);
      assert.ok(currentEntry.preference); assert.equal(process.status, 'COMPLETED');
      assert.equal(process.closureReasonCode, 'OFFER_ACCEPTED'); assert.ok(process.finishedAt); assert.equal(process.lockVersion, 1);
      assert.equal(await prisma.appointmentHistory.count({ where: { appointmentId } }), historyBefore + 1);
      const transferHistory = currentAppointment.historyEntries.filter((history) => history.reason === 'REASSIGNMENT_ACCEPTED');
      assert.equal(transferHistory.length, 1);
      assert.equal(transferHistory[0].previousUserId, source.id); assert.equal(transferHistory[0].newUserId, acceptanceUser.id);
      const own = await request('GET', '/api/v1/appointments/me', acceptanceUser.token);
      assert.equal(own.status, 200); assert.equal(own.body.data.find(row => row.id === appointmentId).attendanceConfirmation.confirmed, false);
      assert.deepEqual(await prisma.confirmation.findUniqueOrThrow({ where: { id: previousConfirmation.id } }), previousConfirmation);
    });
    await t.test('HU-016 supervision reconstructs rejection then acceptance with deterministic order and zero writes', async () => {
      const snapshot = async () => ({
        process: await prisma.reassignment.findUniqueOrThrow({ where: { id: generation.id }, include: { candidates: { orderBy: { id: 'asc' } }, offers: { orderBy: { attemptNumber: 'asc' } } } }),
        slot: await prisma.agendaSlot.findUniqueOrThrow({ where: { id: ids.slotAvailable } }),
        appointment: await prisma.appointment.findUniqueOrThrow({ where: { id: appointmentId }, include: { historyEntries: { orderBy: { id: 'asc' } } } }),
        entries: await prisma.waitlistEntry.findMany({ where: { userId: { in: users } }, orderBy: { id: 'asc' } }),
      });
      const before = await snapshot();
      const response = await supervise(generation.id); assert.equal(response.status, 200);
      const detail = response.body.data;
      assert.equal(detail.status, 'COMPLETED'); assert.equal(detail.closureReasonCode, 'OFFER_ACCEPTED');
      assert.equal(detail.appointment.id, appointmentId); assert.equal(detail.appointment.status, 'AGENDADA');
      assert.equal(detail.appointment.currentUserId, acceptanceUser.id); assert.equal(detail.agendaSlot.status, 'RESERVED');
      assert.deepEqual(detail.offers.map((offer) => offer.attemptNumber), [1, 2]);
      assert.deepEqual(detail.offers.map((offer) => offer.status), ['REJECTED', 'ACCEPTED']);
      assert.deepEqual(detail.offers.map((offer) => offer.recipient.id), [winnerUser.id, nonWinner.id]);
      assert.ok(detail.offers.every((offer) => offer.resolvedAt && offer.respondedAt));
      assert.equal(detail.activeOfferId, null); assert.equal(detail.pendingOfferId, null);
      assert.deepEqual(detail.candidates.map((candidate) => candidate.rankingPosition), [1, 2, null]);
      assert.ok(detail.candidates.every((candidate) => candidate.snapshot.entryUpdatedAt.endsWith('Z')));
      assert.equal(detail.evaluation.ruleCode, 'PRIORITY_FIFO_V1');
      assert.ok(!JSON.stringify(detail).includes('passwordHash')); assert.ok(!JSON.stringify(detail).includes('@example.com'));
      const again = (await supervise(generation.id)).body.data;
      assert.deepEqual(again.candidates, detail.candidates); assert.deepEqual(again.offers, detail.offers);
      assert.deepEqual(await snapshot(), before);
    });
    await t.test('HU-016 shows EXHAUSTED after the only eligible recipient rejects', async () => {
      assert.equal((await request('PUT', `/api/v1/waitlist/${winnerUser.entryId}/preferences`, winnerUser.token, preferences)).status, 200);
      await prisma.agendaSlot.update({ where: { id: ids.slotBlocked }, data: { status: 'AVAILABLE', blockedUntilAt: null } });
      const booked = await request('POST', '/api/v1/appointments', source.token, { agendaSlotId: ids.slotBlocked });
      assert.equal(booked.status, 201);
      assert.equal((await cancelWithBlockedSlot(prisma, booked.body.data.id, () => request('POST', `/api/v1/appointments/${booked.body.data.id}/cancel`, source.token))).status, 200);
      const generated = await generate(ids.slotBlocked); assert.equal(generated.status, 201);
      assert.ok(generated.body.data.offer);
      const rejected = await request('POST', `/api/v1/reassignments/offers/${generated.body.data.offer.id}/reject`, winnerUser.token);
      assert.equal(rejected.status, 200); assert.equal(rejected.body.data.reassignment.status, 'EXHAUSTED');
      const detail = (await supervise(generated.body.data.id)).body.data;
      assert.equal(detail.status, 'EXHAUSTED'); assert.equal(detail.activeOfferId, null);
      assert.deepEqual(detail.offers.map((offer) => offer.status), ['REJECTED']);
      assert.ok(detail.finishedAt); assert.equal(detail.agendaSlot.status, 'RELEASED'); assert.equal(detail.appointment.status, 'CANCELADA');
    });
    await t.test('RF-038 lists only authorized, consistent institutional reassignments with stable cursor pages', async () => {
      const rows = await createListingFixtures();
      const byStatus = (status) => rows.filter((row) => row.status === status);
      const before = await listingSnapshot();

      assert.equal((await list('', null)).status, 401);
      assert.equal((await list('', source.token)).status, 403);
      // An institution-scoped grant has no effective permission without a selected institution.
      assert.equal((await list('', admin.token, {})).status, 403);
      assert.equal((await list('?unknown=value')).status, 400);
      for (const invalid of ['0', '01', '101']) assert.equal((await list(`?limit=${invalid}`)).status, 400);
      assert.equal((await list('?cursor=not-a-cursor')).status, 400);
      const missingCursor = Buffer.from(JSON.stringify({ v: 1, id: randomUUID() })).toString('base64url');
      assert.equal((await list(`?cursor=${missingCursor}`)).status, 404);
      const institutionB = await list('', otherOfficer.token, { 'x-institution-id': ids.institutionB });
      assert.equal(institutionB.status, 200); assert.deepEqual(institutionB.body, { data: [], page: { nextCursor: null } });

      for (const status of ['PENDING', 'EVALUATING', 'OFFERING', 'COMPLETED', 'EXHAUSTED', 'CANCELLED', 'FAILED']) {
        const response = await list(`?status=${status}&limit=100`);
        assert.equal(response.status, 200);
        assert.ok(response.body.data.every((row) => row.status === status));
        for (const row of byStatus(status).filter((item) => item.appointmentBranchId === item.availability.branchId)) {
          assert.ok(response.body.data.some((item) => item.id === row.id));
        }
      }

      const pending = await list('?status=PENDING&limit=100');
      const inconsistent = byStatus('PENDING').find((row) => row.appointmentBranchId !== row.availability.branchId);
      assert.ok(inconsistent);
      assert.equal(pending.body.data.some((row) => row.id === inconsistent.id), false);

      const failed = await list('?status=FAILED');
      assert.equal(failed.status, 200); assert.equal(failed.body.data.length, 50);
      assert.ok(failed.body.page.nextCursor);
      const failedSecond = await list(`?status=FAILED&cursor=${encodeURIComponent(failed.body.page.nextCursor)}`);
      assert.equal(failedSecond.status, 200); assert.equal(failedSecond.body.data.length, 1);
      assert.equal(failedSecond.body.page.nextCursor, null);
      assert.equal(new Set([...failed.body.data, ...failedSecond.body.data].map((row) => row.id)).size, 51);
      const failedMaximum = await list('?status=FAILED&limit=100');
      assert.equal(failedMaximum.status, 200); assert.equal(failedMaximum.body.data.length, 51);
      assert.equal(failedMaximum.body.page.nextCursor, null);

      const completedRows = byStatus('COMPLETED').sort((left, right) => right.id.localeCompare(left.id));
      const completedFirst = await list('?status=COMPLETED&limit=1');
      assert.equal(completedFirst.status, 200); assert.equal(completedFirst.body.data[0].id, completedRows[0].id);
      const completedSecond = await list(`?status=COMPLETED&limit=1&cursor=${encodeURIComponent(completedFirst.body.page.nextCursor)}`);
      assert.equal(completedSecond.status, 200); assert.equal(completedSecond.body.data[0].id, completedRows[1].id);

      const precisionRows = byStatus('EXHAUSTED').filter((row) => row.precision);
      const microsecondRows = precisionRows.filter((row) => row.appointmentBranchId === row.availability.branchId)
        .sort((left, right) => right.precision.localeCompare(left.precision));
      for (const row of precisionRows) {
        const stored = await prisma.$queryRawUnsafe(
          'SELECT to_char("detectada_at", \'YYYY-MM-DD HH24:MI:SS.US\') AS "detectedAt" FROM "reasignaciones" WHERE "id" = $1::uuid',
          row.id,
        );
        assert.equal(stored[0]?.detectedAt, row.precision);
      }
      const microsecondFirst = await list('?status=EXHAUSTED&limit=1', admin.token, { ...headers, 'x-branch-id': ids.branchA1 });
      assert.equal(microsecondFirst.status, 200); assert.equal(microsecondFirst.body.data[0].id, microsecondRows[0].id);
      const microsecondSecond = await list(`?status=EXHAUSTED&limit=1&cursor=${encodeURIComponent(microsecondFirst.body.page.nextCursor)}`,
        admin.token, { ...headers, 'x-branch-id': ids.branchA1 });
      assert.equal(microsecondSecond.status, 200); assert.equal(microsecondSecond.body.data[0].id, microsecondRows[1].id);
      // Older EXHAUSTED processes from the preceding flow still follow the precision fixtures.
      assert.ok(microsecondSecond.body.page.nextCursor);
      const microsecondThird = await list(`?status=EXHAUSTED&limit=1&cursor=${encodeURIComponent(microsecondSecond.body.page.nextCursor)}`,
        admin.token, { ...headers, 'x-branch-id': ids.branchA1 });
      assert.equal(microsecondThird.status, 200); assert.equal(microsecondThird.body.data.length, 1);
      assert.equal(precisionRows.some((row) => row.id === microsecondThird.body.data[0].id), false);

      const otherBranch = byStatus('EXHAUSTED').find((row) => row.availability.branchId === ids.branchA2);
      assert.ok(otherBranch);
      const branchA1 = await list('?status=EXHAUSTED&limit=100', admin.token, { ...headers, 'x-branch-id': ids.branchA1 });
      const branchA2 = await list('?status=EXHAUSTED&limit=100', admin.token, { ...headers, 'x-branch-id': ids.branchA2 });
      assert.equal(branchA1.body.data.some((row) => row.id === otherBranch.id), false);
      assert.equal(branchA2.body.data.some((row) => row.id === otherBranch.id), true);
      assert.equal((await list(`?cursor=${encodeURIComponent(microsecondRows[0].id)}`)).status, 400);
      const foreignCursor = Buffer.from(JSON.stringify({ v: 1, id: microsecondRows[0].id })).toString('base64url');
      assert.equal((await list(`?cursor=${foreignCursor}`, otherOfficer.token, { 'x-institution-id': ids.institutionB })).status, 404);
      assert.equal((await list(`?status=FAILED&cursor=${foreignCursor}`)).status, 404);
      assert.equal((await list(`?cursor=${foreignCursor}`, admin.token, { ...headers, 'x-branch-id': ids.branchA2 })).status, 404);

      const summary = completedFirst.body.data[0];
      assert.deepEqual(Object.keys(summary).sort(), ['agendaSlot', 'branch', 'closureReasonCode', 'detectedAt', 'finishedAt', 'id', 'service', 'startedAt', 'status']);
      const serialized = JSON.stringify(summary);
      for (const forbidden of ['appointmentId', 'originCancellationId', 'sourceUserId', 'candidates', 'offers', 'criteriaSnapshot', 'closureDetails', 'password', 'email']) {
        assert.equal(serialized.includes(forbidden), false);
      }
      const detail = await supervise(summary.id);
      assert.equal(detail.status, 200); assert.equal(detail.body.data.id, summary.id);
      assert.deepEqual(await listingSnapshot(), before);
    });

    await t.test('RF-038 fills valid pages across inconsistent batches, reuses every cursor and exhausts invalid-only scopes', async () => {
      const rows = listingFixture.rows;
      assert.ok(rows.length > 0);
      const before = await listingSnapshot();
      const valid = rows.filter((row) => row.status === 'CANCELLED' && row.appointmentBranchId === row.availability.branchId)
        .sort((left, right) => right.detectedAt.getTime() - left.detectedAt.getTime() || right.id.localeCompare(left.id));
      assert.equal(valid.length, 4);
      for (const limit of [1, 2]) {
        let cursor; const seen = []; const cursors = new Set();
        for (let offset = 0; offset < valid.length; offset += limit) {
          const response = await list(`?status=CANCELLED&limit=${limit}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
          assert.equal(response.status, 200);
          assert.deepEqual(response.body.data.map((row) => row.id), valid.slice(offset, offset + limit).map((row) => row.id));
          seen.push(...response.body.data.map((row) => row.id));
          cursor = response.body.page.nextCursor;
          if (offset + limit < valid.length) {
            assert.ok(cursor); assert.equal(cursors.has(cursor), false); cursors.add(cursor);
            assert.equal(JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')).id, response.body.data.at(-1).id);
          } else assert.equal(cursor, null);
        }
        assert.deepEqual(seen, valid.map((row) => row.id)); assert.equal(new Set(seen).size, valid.length);
      }
      const empty = await list('?status=EVALUATING&limit=1', admin.token, { ...headers, 'x-branch-id': ids.branchA2 });
      assert.equal(empty.status, 200); assert.deepEqual(empty.body, { data: [], page: { nextCursor: null } });
      const invalid = rows.find((row) => row.status === 'CANCELLED' && row.appointmentBranchId !== row.availability.branchId);
      assert.ok(invalid);
      const invalidCursor = Buffer.from(JSON.stringify({ v: 1, id: invalid.id })).toString('base64url');
      assert.equal((await list(`?status=CANCELLED&cursor=${invalidCursor}`)).status, 404);
      assert.deepEqual(await listingSnapshot(), before);
    });

    await t.test('RF-038 real Desktop client/model reads NestJS listing, filters, pages and direct UUID details with isolated PostgreSQL', async () => {
      const sessions = []; const models = [];
      const createDesktop = async (credentials, context) => {
        const baseUrl = `${base}/api/v1`;
        const session = createAuthSession({
          publicApi: createHttpClient({ baseUrl }),
          authenticatedApi: (getAccessToken) => createHttpClient({ baseUrl, getAccessToken }),
          storage: createMemorySessionStorage(),
        });
        sessions.push(session);
        await session.login(credentials);
        if (context) await session.selectContext(context);
        const snapshot = session.getSnapshot();
        assert.equal(snapshot.status, 'authenticated'); assert.ok(snapshot.user);
        const model = createReassignmentModel(session.api, snapshot.user); models.push(model);
        return { session, model, user: snapshot.user };
      };
      try {
        const scope = { institutionId: ids.institutionA, branchId: ids.branchA1 };
        const { session, model, user } = await createDesktop(admin.credentials, scope);
        assert.ok(user.permissions.includes('reassignments.read')); assert.deepEqual(user.context, scope);
        const before = await listingSnapshot();
        await model.consult();
        assert.equal(model.getSnapshot().status, 'ready'); assert.equal(model.getSnapshot().data.length, 50);
        assert.ok(model.getSnapshot().data.every((row) => row.branch.id === ids.branchA1));
        const summary = model.getSnapshot().data[0];
        assert.equal(Object.hasOwn(summary, 'candidates'), false); assert.equal(Object.hasOwn(summary, 'offers'), false);
        await model.openDetail(summary.id);
        assert.equal(model.getSnapshot().detailStatus, 'ready'); assert.equal(model.getSnapshot().detail.id, summary.id);

        await model.setFilter('FAILED');
        assert.equal(model.getSnapshot().status, 'ready'); assert.equal(model.getSnapshot().data.length, 50);
        assert.ok(model.getSnapshot().data.every((row) => row.status === 'FAILED'));
        assert.ok(model.getSnapshot().nextCursor);
        await model.loadMore();
        assert.equal(model.getSnapshot().data.length, 51); assert.equal(model.getSnapshot().nextCursor, null);
        assert.equal(new Set(model.getSnapshot().data.map((row) => row.id)).size, 51);

        const known = listingFixture.rows.find((row) => row.status === 'PENDING' && row.appointmentBranchId === ids.branchA1);
        assert.ok(known); assert.equal(model.getSnapshot().data.some((row) => row.id === known.id), false);
        model.setId(`  ${known.id}  `); await model.consultById();
        assert.equal(model.getSnapshot().detailStatus, 'ready'); assert.equal(model.getSnapshot().detail.id, known.id);
        assert.equal(model.getSnapshot().detail.status, 'PENDING'); assert.equal(model.getSnapshot().filter, 'FAILED');
        await model.consultById(); assert.equal(model.getSnapshot().detailStatus, 'ready');
        model.setId('invalid-uuid'); await model.consultById();
        assert.equal(model.getSnapshot().detailStatus, 'error'); assert.match(model.getSnapshot().detailError, /UUID/);
        assert.equal(model.getSnapshot().detail, null);

        const otherBranch = listingFixture.rows.find((row) => row.status === 'EXHAUSTED' && row.availability.branchId === ids.branchA2);
        assert.ok(otherBranch); model.setId(otherBranch.id); await model.consultById();
        assert.equal(model.getSnapshot().detailStatus, 'error'); assert.match(model.getSnapshot().detailError, /no está disponible en tu contexto/);
        model.dispose();
        await session.selectContext({ institutionId: ids.institutionA, branchId: ids.branchA2 });
        const branchModel = createReassignmentModel(session.api, session.getSnapshot().user); models.push(branchModel);
        assert.equal(branchModel.getSnapshot().id, ''); assert.equal(branchModel.getSnapshot().detail, null);
        await branchModel.consult();
        assert.equal(branchModel.getSnapshot().status, 'ready');
        assert.ok(branchModel.getSnapshot().data.every((row) => row.branch.id === ids.branchA2));
        assert.deepEqual(branchModel.getSnapshot().data.filter((row) => listingFixture.reassignments.includes(row.id)).map((row) => row.id), [otherBranch.id]);
        assert.equal(branchModel.getSnapshot().data.some((row) => row.id === known.id), false);
        branchModel.setId(otherBranch.id); await branchModel.consultById();
        assert.equal(branchModel.getSnapshot().detailStatus, 'ready'); assert.equal(branchModel.getSnapshot().detail.id, otherBranch.id);

        const foreign = await createDesktop(otherOfficer.credentials, { institutionId: ids.institutionB });
        await foreign.model.consult(); assert.equal(foreign.model.getSnapshot().status, 'ready');
        assert.deepEqual(foreign.model.getSnapshot().data, []);
        foreign.model.setId(known.id); await foreign.model.consultById();
        assert.equal(foreign.model.getSnapshot().detailStatus, 'error'); assert.equal(foreign.model.getSnapshot().detail, null);
        assert.match(foreign.model.getSnapshot().detailError, /no está disponible en tu contexto/);
        const denied = await createDesktop(source.credentials);
        await denied.model.consult(); denied.model.setId(known.id); await denied.model.consultById();
        assert.equal(denied.model.getSnapshot().status, 'denied'); assert.equal(denied.model.getSnapshot().detail, null);
        assert.deepEqual(await listingSnapshot(), before);
      } finally {
        for (const model of models) model.dispose();
        for (const session of sessions) await session.logout();
      }
    });
    await t.test('HU-022 history preserves every status/expiry, inactive catalogs and stable order without mutations', async () => {
      const own = await prisma.appointmentOffer.findMany({ where: { candidate: { userId: winnerUser.id } } });
      assert.ok(own.length >= 2);
      const historical = await prisma.appointmentOffer.findFirstOrThrow({ where: { candidate: { userId: winnerUser.id }, reassignment: { status: 'EXHAUSTED' } } });
      const branch = await prisma.branch.findUniqueOrThrow({ where: { id: ids.branchA1 } });
      const service = await prisma.service.findUniqueOrThrow({ where: { id: ids.serviceA } });
      try {
        await prisma.branch.update({ where: { id: branch.id }, data: { status: 'INACTIVE' } });
        await prisma.service.update({ where: { id: service.id }, data: { active: false } });
        const tied = new Date('2026-01-01T12:00:00Z');
        const expiredAt = new Date('2026-01-01T12:07:00Z');
        await prisma.appointmentOffer.updateMany({ where: { id: { in: own.map((o) => o.id) } }, data: { createdAt: tied } });
        for (const status of ['PENDING', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'INVALIDATED', 'CANCELLED']) {
          await prisma.appointmentOffer.update({ where: { id: historical.id }, data: { status, expiresAt: expiredAt } });
          const before = await prisma.appointmentOffer.findMany({ where: { id: { in: own.map((o) => o.id) } }, orderBy: { id: 'desc' } });
          const result = await mine(winnerUser.token);
          assert.equal(result.status, 200);
          assert.deepEqual(result.body.data.map((o) => o.id), before.map((o) => o.id));
          assert.equal(result.body.data.find((o) => o.id === historical.id).status, status);
          assert.equal(result.body.data.find((o) => o.id === historical.id).expiresAt, expiredAt.toISOString());
          assert.deepEqual(await prisma.appointmentOffer.findMany({ where: { id: { in: own.map((o) => o.id) } }, orderBy: { id: 'desc' } }), before);
        }
      } finally {
        for (const row of own) await prisma.appointmentOffer.update({ where: { id: row.id }, data: { status: row.status, expiresAt: row.expiresAt, createdAt: row.createdAt } });
        await prisma.branch.update({ where: { id: branch.id }, data: { status: branch.status, updatedAt: branch.updatedAt } });
        await prisma.service.update({ where: { id: service.id }, data: { active: service.active, updatedAt: service.updatedAt } });
      }
    });
  } finally {
    try {
      if (prisma && cleanupEnabled) {
        await prisma.$transaction([
          prisma.reassignment.deleteMany({ where: { id: { in: listingFixture.reassignments } } }),
          prisma.cancellation.deleteMany({ where: { id: { in: listingFixture.cancellations } } }),
          prisma.appointment.deleteMany({ where: { id: { in: listingFixture.appointments } } }),
          prisma.agendaSlot.deleteMany({ where: { id: { in: listingFixture.slots } } }),
          prisma.appointmentOffer.deleteMany({ where: { agendaSlotId: { in: [ids.slotAvailable, ids.slotOtherContext, ids.slotBlocked] }, reassignment: { sourceUserId: { in: users } } } }),
          prisma.reassignmentCandidate.deleteMany({ where: { reassignment: { agendaSlotId: { in: [ids.slotAvailable, ids.slotOtherContext, ids.slotBlocked] }, sourceUserId: { in: users } } } }),
          prisma.reassignment.deleteMany({ where: { agendaSlotId: { in: [ids.slotAvailable, ids.slotOtherContext, ids.slotBlocked] }, sourceUserId: { in: users } } }),
          prisma.waitlistPreferredDay.deleteMany({ where: { preference: { waitlistEntry: { userId: { in: users } } } } }),
          prisma.waitlistTimeRange.deleteMany({ where: { preference: { waitlistEntry: { userId: { in: users } } } } }),
          prisma.waitlistPreferredBranch.deleteMany({ where: { waitlistEntry: { userId: { in: users } } } }),
          prisma.waitlistPreference.deleteMany({ where: { waitlistEntry: { userId: { in: users } } } }),
          prisma.waitlistEntry.deleteMany({ where: { userId: { in: users } } }),
          prisma.priority.deleteMany({ where: { institutionId: ids.institutionA, code: 'STANDARD' } }),
          prisma.waitlistStatus.deleteMany({ where: { id: { in: statusIds } } }),
        ]);
        await cleanupCheckpointFixtures(prisma);
        if (ownedPermission) await prisma.permission.delete({ where: { id: ownedPermission } });
        if (ownedSupervisionPermission) await prisma.permission.delete({ where: { id: ownedSupervisionPermission } });
        await prisma.appointmentStatus.deleteMany({ where: { id: { in: appointmentStatusIds } } });
        await assertCheckpointIsClean(prisma);
      }
    } finally { await app.close(); }
  }
});
