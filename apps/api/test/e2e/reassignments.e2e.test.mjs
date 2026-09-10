import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { NestFactory } from '@nestjs/core';
import { loadApiEnvironment, assertSafeLocalDatabaseUrl, getE2ePort } from './local-environment.mjs';
import { FIXTURE_EMAIL_PREFIX, ids, cleanupCheckpointFixtures, createCheckpointFixtures, assertCheckpointIsClean } from './fixture.mjs';

test('HU-009 real HTTP and PostgreSQL offer generation', { timeout: 120_000 }, async (t) => {
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
    const originalStates = await prisma.waitlistStatus.findMany({ where: { code: { in: ['ACTIVE', 'WITHDRAWN'] } }, select: { id: true } });
    await bootstrapWaitlist(prisma, ids.institutionA);
    const waitlistStates = await prisma.waitlistStatus.findMany({ where: { code: { in: ['ACTIVE', 'WITHDRAWN'] } } });
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
      assert.equal((await request('PUT', `/api/v1/waitlist/${a.entryId}/preferences`, a.token, { ...preferences, preferredDays: [1] })).status, 200);
      assert.deepEqual(await prisma.reassignmentCandidate.findMany({ where: { reassignmentId: generation.id }, orderBy: { rankingPosition: 'asc' } }), candidates);
    });
    await t.test('existing appointment stays unique, cancelled and unchanged; no transfer or history writes', async () => {
      assert.equal(await prisma.appointment.count({ where: { agendaSlotId: ids.slotAvailable } }), 1);
      assert.deepEqual(await prisma.appointment.findUniqueOrThrow({ where: { id: appointmentId }, include: { historyEntries: true, cancellations: true } }), appointmentBefore);
    });
    await t.test('expired timestamp alone does not auto-expire or allow a new offer', async () => {
      const createdAt = new Date(Date.now() - 120000); const expiresAt = new Date(Date.now() - 60000);
      await prisma.appointmentOffer.update({ where: { id: generation.offer.id }, data: { createdAt, expiresAt } });
      assert.equal((await generate()).status, 409);
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
