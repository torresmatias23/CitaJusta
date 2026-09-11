import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { NestFactory } from '@nestjs/core';
import { loadApiEnvironment, assertSafeLocalDatabaseUrl, getE2ePort } from './local-environment.mjs';
import { FIXTURE_EMAIL_PREFIX, ids, cleanupCheckpointFixtures, createCheckpointFixtures, assertCheckpointIsClean } from './fixture.mjs';

test('HU-009/HU-010/HU-011 real HTTP and PostgreSQL reassignment flow', { timeout: 120_000 }, async (t) => {
  loadApiEnvironment(); assertSafeLocalDatabaseUrl(process.env.DATABASE_URL); process.env.NODE_ENV = 'test';
  process.env.WAITLIST_OFFER_TTL_MINUTES = '10';
  const [{ AppModule }, { configureApplication }, { PrismaService }, { bootstrapWaitlist }, { bootstrapAppointmentStatus }] = await Promise.all([
    import('../../dist/app.module.js'), import('../../dist/app.configuration.js'), import('../../dist/database/prisma.service.js'),
    import('../../dist/database/waitlist.bootstrap.js'), import('../../dist/database/appointment-status.bootstrap.js'),
  ]);
  const app = await NestFactory.create(AppModule, { logger: false });
  let prisma; let cleanupEnabled = false; let ownedPermission;
  const users = []; const statusIds = []; const appointmentStatusIds = [];
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
      return { id: result.body.id, token: login.body.accessToken };
    }
    const admin = await register(); const source = await register();
    await createCheckpointFixtures(prisma, admin.id);
    const existingPermission = await prisma.permission.findUnique({ where: { code: permissionCode } });
    const permission = existingPermission ?? await prisma.permission.create({ data: { id: randomUUID(), code: permissionCode, module: 'reassignments', action: 'generate' } });
    if (!existingPermission) ownedPermission = permission.id;
    await prisma.rolePermission.create({ data: { roleId: ids.roleInstitution, permissionId: permission.id } });
    const originalStates = await prisma.waitlistStatus.findMany({ where: { code: { in: ['ACTIVE', 'WITHDRAWN', 'FULFILLED'] } }, select: { id: true } });
    await bootstrapWaitlist(prisma, ids.institutionA);
    const waitlistStates = await prisma.waitlistStatus.findMany({ where: { code: { in: ['ACTIVE', 'WITHDRAWN', 'FULFILLED'] } } });
    statusIds.push(...waitlistStates.filter((s) => !originalStates.some((old) => old.id === s.id)).map((s) => s.id));
    const originalAppointments = await prisma.appointmentStatus.findMany({ where: { code: { in: ['AGENDADA', 'CANCELADA'] } }, select: { id: true } });
    await bootstrapAppointmentStatus(prisma);
    const appointmentStates = await prisma.appointmentStatus.findMany({ where: { code: { in: ['AGENDADA', 'CANCELADA'] } } });
    appointmentStatusIds.push(...appointmentStates.filter((s) => !originalAppointments.some((old) => old.id === s.id)).map((s) => s.id));
    const headers = { 'x-institution-id': ids.institutionA };
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
    assert.equal((await request('POST', `/api/v1/appointments/${appointmentId}/cancel`, source.token)).status, 200);
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
    });
    await t.test('no eligible candidate persists EXHAUSTED evaluation without an offer or new appointment', async () => {
      assert.equal((await request('PUT', `/api/v1/waitlist/${otherService.entryId}/preferences`, otherService.token,
        { ...preferences, acceptsAnyProfessional: false })).status, 200);
      const reserved = await request('POST', '/api/v1/appointments', source.token, { agendaSlotId: ids.slotOtherContext });
      assert.equal(reserved.status, 201);
      assert.equal((await request('POST', `/api/v1/appointments/${reserved.body.data.id}/cancel`, source.token)).status, 200);
      const response = await generate(ids.slotOtherContext);
      assert.equal(response.status, 201); assert.equal(response.body.data.status, 'EXHAUSTED'); assert.equal(response.body.data.offer, null);
      const process = await prisma.reassignment.findUniqueOrThrow({ where: { id: response.body.data.id }, include: { candidates: true } });
      assert.equal(process.closureReasonCode, 'NO_ELIGIBLE_CANDIDATES'); assert.ok(process.finishedAt);
      assert.equal(process.candidates.length, 1); assert.equal(process.candidates[0].exclusionReasonCode, 'SPECIFIC_PROFESSIONAL_UNDEFINED');
      assert.equal(await prisma.appointmentOffer.count({ where: { agendaSlotId: ids.slotOtherContext } }), 0);
      assert.equal(await prisma.appointment.count({ where: { agendaSlotId: ids.slotOtherContext } }), 1);
      assert.equal((await generate(ids.slotOtherContext)).status, 409);
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
    });
  } finally {
    try {
      if (prisma && cleanupEnabled) {
        await prisma.$transaction([
          prisma.appointmentOffer.deleteMany({ where: { agendaSlotId: { in: [ids.slotAvailable, ids.slotOtherContext] }, reassignment: { sourceUserId: { in: users } } } }),
          prisma.reassignmentCandidate.deleteMany({ where: { reassignment: { agendaSlotId: { in: [ids.slotAvailable, ids.slotOtherContext] }, sourceUserId: { in: users } } } }),
          prisma.reassignment.deleteMany({ where: { agendaSlotId: { in: [ids.slotAvailable, ids.slotOtherContext] }, sourceUserId: { in: users } } }),
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
        await prisma.appointmentStatus.deleteMany({ where: { id: { in: appointmentStatusIds } } });
        await assertCheckpointIsClean(prisma);
      }
    } finally { await app.close(); }
  }
});
