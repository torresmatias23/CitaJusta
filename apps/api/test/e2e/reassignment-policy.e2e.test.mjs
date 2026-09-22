import { cancelWithBlockedSlot } from './manual-release.fixture.mjs';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { NestFactory } from '@nestjs/core';
import { loadApiEnvironment, assertSafeLocalDatabaseUrl, getE2ePort } from './local-environment.mjs';
import { FIXTURE_EMAIL_PREFIX, ids, cleanupCheckpointFixtures, createCheckpointFixtures, assertCheckpointIsClean } from './fixture.mjs';

test('HU-018 versioned institutional policy and frozen PostgreSQL reassignment process', { timeout: 120_000 }, async (t) => {
  loadApiEnvironment(); assertSafeLocalDatabaseUrl(process.env.DATABASE_URL); process.env.NODE_ENV = 'test';
  process.env.WAITLIST_OFFER_TTL_MINUTES = '10';
  const [{ AppModule }, { configureApplication }, { PrismaService }, { bootstrapWaitlist }, { bootstrapAppointmentStatus }] = await Promise.all([
    import('../../dist/app.module.js'), import('../../dist/app.configuration.js'), import('../../dist/database/prisma.service.js'),
    import('../../dist/database/waitlist.bootstrap.js'), import('../../dist/database/appointment-status.bootstrap.js'),
  ]);
  const app = await NestFactory.create(AppModule, { logger: false });
  let prisma; let cleanupEnabled = false;
  const users = []; const permissionsCreated = []; const policyIds = []; const processIds = []; const priorityIds = [];
  try {
    configureApplication(app); await app.listen(getE2ePort(), '127.0.0.1');
    prisma = app.get(PrismaService); await cleanupCheckpointFixtures(prisma); cleanupEnabled = true;
    const base = `http://127.0.0.1:${app.getHttpServer().address().port}/api/v1`;
    async function request(method, path, token, body, headers = {}) {
      const response = await fetch(`${base}${path}`, { method, headers: { ...headers,
        ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
        body: body === undefined ? undefined : JSON.stringify(body) });
      return { status: response.status, body: await response.json() };
    }
    async function register() {
      const credentials = { email: `${FIXTURE_EMAIL_PREFIX}${randomUUID()}@example.com`, password: `E2e-${randomUUID()}-Aa1!` };
      const result = await request('POST', '/auth/register', undefined, { ...credentials, firstName: 'Policy', lastName: 'Fixture' }); assert.equal(result.status, 201); users.push(result.body.id);
      const login = await request('POST', '/auth/login', undefined, credentials); assert.equal(login.status, 200);
      return { id: result.body.id, token: login.body.accessToken };
    }
    const admin = await register(); const source = await register(); const foreign = await register(); const officer = await register();
    await createCheckpointFixtures(prisma, admin.id);
    for (const [module, action] of [['reassignments.policy', 'read'], ['reassignments.policy', 'update'], ['reassignments', 'generate'], ['reassignments', 'read']]) {
      const code = `${module}.${action}`; let permission = await prisma.permission.findUnique({ where: { code } });
      if (!permission) { permission = await prisma.permission.create({ data: { id: randomUUID(), code, module, action } }); permissionsCreated.push(permission.id); }
      await prisma.rolePermission.createMany({ data: [ids.roleInstitution, ids.roleBranch].map((roleId) => ({ roleId, permissionId: permission.id })) });
    }
    await prisma.userRole.createMany({ data: [
      { id: randomUUID(), userId: foreign.id, roleId: ids.roleInstitution, institutionId: ids.institutionB },
      { id: randomUUID(), userId: officer.id, roleId: ids.roleBranch, institutionId: ids.institutionA, branchId: ids.branchA1 },
    ] });
    const scope = { 'x-institution-id': ids.institutionA };
    const get = (token = admin.token, headers = scope) => request('GET', '/reassignment-policy', token, undefined, headers);
    async function configure(body, token = admin.token, headers = scope) {
      const result = await request('POST', '/reassignment-policy', token, body, headers);
      if (result.status === 201) policyIds.push(result.body.data.id);
      return result;
    }
    const priorityFirst = { rankingStrategy: 'PRIORITY_THEN_WAITING', offerTtlMinutes: 7 };
    const waitingFirst = { rankingStrategy: 'WAITING_THEN_PRIORITY', offerTtlMinutes: 3 };
    await t.test('authentication, separate permissions, mandatory institution and forbidden branch scope', async () => {
      assert.equal((await request('GET', '/reassignment-policy', undefined, undefined, scope)).status, 401);
      assert.equal((await request('POST', '/reassignment-policy', undefined, priorityFirst, scope)).status, 401);
      assert.equal((await get(source.token)).status, 403); assert.equal((await configure(priorityFirst, source.token)).status, 403);
      assert.equal((await get(admin.token, {})).status, 403); assert.equal((await configure(priorityFirst, admin.token, {})).status, 403);
      assert.equal((await get(officer.token, { ...scope, 'x-branch-id': ids.branchA1 })).status, 403);
      assert.equal((await configure(priorityFirst, officer.token, { ...scope, 'x-branch-id': ids.branchA1 })).status, 403);
      assert.equal((await configure(priorityFirst, foreign.token)).status, 403);
    });
    await t.test('GET DEFAULT uses effective legacy TTL and has zero persistence side effects', async () => {
      const before = await prisma.institution.findUniqueOrThrow({ where: { id: ids.institutionA } });
      const result = await get(); assert.equal(result.status, 200);
      assert.deepEqual(result.body.data, { source: 'DEFAULT', id: null, version: null, rankingStrategy: 'PRIORITY_THEN_WAITING', offerTtlMinutes: 10 });
      assert.equal(await prisma.reassignmentPolicy.count({ where: { institutionId: ids.institutionA } }), 0);
      assert.deepEqual(await prisma.institution.findUniqueOrThrow({ where: { id: ids.institutionA } }), before);
    });
    await t.test('strict input rejects unsupported strategies, TTL, query and administrative overrides', async () => {
      for (const body of [{}, { ...priorityFirst, rankingStrategy: 'OTHER' }, ...[0, 61, 1.5, '10'].map((offerTtlMinutes) => ({ ...priorityFirst, offerTtlMinutes })),
        ...['institutionId', 'userId', 'createdByUserId', 'version', 'policyId', 'current', 'active'].map((key) => ({ ...priorityFirst, [key]: 'override' }))]) assert.equal((await configure(body)).status, 400);
      assert.equal((await request('GET', '/reassignment-policy?institutionId=x', admin.token, undefined, scope)).status, 400);
    });
    await bootstrapAppointmentStatus(prisma); await bootstrapWaitlist(prisma, ids.institutionA);
    const standard = await prisma.priority.findUniqueOrThrow({ where: { institutionId_code: { institutionId: ids.institutionA, code: 'STANDARD' } } }); priorityIds.push(standard.id);
    const lower = await prisma.priority.create({ data: { id: randomUUID(), institutionId: ids.institutionA, code: 'E2E_POLICY_LOWER', name: 'Test priority', level: 1, active: true } }); priorityIds.push(lower.id);
    async function enroll(specific = false) {
      const user = await register(); const result = await request('POST', '/waitlist', user.token, { serviceId: ids.serviceA, branchId: ids.branchA1 }); assert.equal(result.status, 201);
      const entryId = result.body.data.id;
      const preferences = { preferredDays: [1, 2, 3, 4, 5, 6, 7], timeRanges: [{ start: '00:00', end: '23:59' }], preferredBranchIds: [], allowsOtherBranches: false, acceptsAnyProfessional: !specific };
      assert.equal((await request('PUT', `/waitlist/${entryId}/preferences`, user.token, preferences)).status, 200);
      return { ...user, entryId };
    }
    const high = await enroll(); const old = await enroll(); await enroll(true);
    await prisma.waitlistEntry.update({ where: { id: high.entryId }, data: { enteredAt: new Date('2026-02-01T12:00Z') } });
    await prisma.waitlistEntry.update({ where: { id: old.entryId }, data: { priorityId: lower.id, enteredAt: new Date('2026-01-01T12:00Z') } });
    async function generate(slotId) {
      await prisma.agendaSlot.update({ where: { id: slotId }, data: { status: 'AVAILABLE', blockedUntilAt: null } });
      const booked = await request('POST', '/appointments', source.token, { agendaSlotId: slotId }); assert.equal(booked.status, 201);
      assert.equal((await cancelWithBlockedSlot(prisma, booked.body.data.id, () => request('POST', `/appointments/${booked.body.data.id}/cancel`, source.token))).status, 200);
      const generated = await request('POST', `/reassignments/${slotId}/offers`, admin.token, undefined, scope); assert.equal(generated.status, 201);
      processIds.push(generated.body.data.id); return generated.body.data;
    }
    const snapshot = (id) => prisma.reassignment.findUniqueOrThrow({ where: { id }, include: { candidates: { orderBy: { id: 'asc' } }, offers: { orderBy: { id: 'asc' } } } });
    const detail = (id) => request('GET', `/reassignments/${id}`, admin.token, undefined, scope);
    const ttlOf = (offer) => (new Date(offer.expiresAt) - new Date(offer.createdAt)) / 60000;
    const legacy = await generate(ids.slotAvailable);
    await t.test('legacy process retains null policy, original priority/FIFO ranking and global TTL', async () => {
      const stored = await snapshot(legacy.id); assert.equal(stored.policyId, null);
      assert.equal(stored.candidates.find((c) => c.rankingPosition === 1).waitlistEntryId, high.entryId);
      assert.equal(ttlOf(legacy.offer), 10); assert.equal((await detail(legacy.id)).body.data.policy, null);
    });
    let first; let second; let configured;
    await t.test('first configuration creates version 1; GET and identical POST reuse it without writes', async () => {
      const result = await configure(priorityFirst); assert.equal(result.status, 201); first = result.body.data;
      assert.equal(first.version, 1); assert.equal(first.createdByUserId, admin.id); assert.equal(first.source, 'CONFIGURED');
      assert.deepEqual((await get()).body.data, first);
      const before = await prisma.institution.findUniqueOrThrow({ where: { id: ids.institutionA } });
      const same = await configure(priorityFirst); assert.equal(same.status, 200); assert.deepEqual(same.body.data, first);
      assert.deepEqual(await prisma.institution.findUniqueOrThrow({ where: { id: ids.institutionA } }), before);
    });
    await t.test('configured priority-first preserves legacy ordering and stores policy with configured TTL', async () => {
      const process = await generate(ids.slotReserved); const stored = await snapshot(process.id);
      assert.equal(stored.policyId, first.id); assert.equal(ttlOf(process.offer), 7);
      assert.equal(stored.candidates.find((c) => c.rankingPosition === 1).waitlistEntryId, high.entryId);
      assert.equal(stored.candidates.find((c) => c.evaluationStatus === 'EXCLUDED').exclusionReasonCode, 'SPECIFIC_PROFESSIONAL_UNDEFINED');
    });
    await t.test('version 2 is immutable and waiting-first changes only ordering; supervision exposes the bound policy', async () => {
      const original = await prisma.reassignmentPolicy.findUniqueOrThrow({ where: { id: first.id } });
      const changed = await configure(waitingFirst); assert.equal(changed.status, 201); second = changed.body.data; assert.equal(second.version, 2);
      assert.deepEqual(await prisma.reassignmentPolicy.findUniqueOrThrow({ where: { id: first.id } }), original);
      await assert.rejects(prisma.reassignmentPolicy.update({ where: { id: first.id }, data: { offerTtlMinutes: 6 } }));
      configured = await generate(ids.slotBlocked); const stored = await snapshot(configured.id);
      assert.equal(stored.policyId, second.id); assert.equal(ttlOf(configured.offer), 3);
      assert.equal(stored.candidates.find((c) => c.rankingPosition === 1).waitlistEntryId, old.entryId);
      assert.deepEqual((await detail(configured.id)).body.data.policy, { id: second.id, version: 2, ...waitingFirst });
    });
    await t.test('new current never changes existing processes/snapshots/offers and rejection uses original policy TTL', async () => {
      const before = await snapshot(configured.id); const legacyBefore = await snapshot(legacy.id);
      assert.equal((await configure({ ...priorityFirst, offerTtlMinutes: 60 })).status, 201);
      assert.deepEqual(await snapshot(configured.id), before); assert.deepEqual(await snapshot(legacy.id), legacyBefore);
      const rejected = await request('POST', `/reassignments/offers/${configured.offer.id}/reject`, old.token); assert.equal(rejected.status, 200);
      assert.equal(ttlOf(rejected.body.data.nextOffer), 3);
      const legacyRejected = await request('POST', `/reassignments/offers/${legacy.offer.id}/reject`, high.token); assert.equal(legacyRejected.status, 200);
      assert.equal(ttlOf(legacyRejected.body.data.nextOffer), 10);
      await assert.rejects(prisma.reassignment.update({ where: { id: configured.id }, data: { policyId: first.id } }));
      assert.equal((await snapshot(configured.id)).policyId, second.id);
    });
    await t.test('institutional pointer rejects cross-tenant FK and foreign GET stays DEFAULT', async () => {
      await assert.rejects(prisma.institution.update({ where: { id: ids.institutionB }, data: { currentReassignmentPolicyId: first.id } }));
      assert.equal((await get(foreign.token, { 'x-institution-id': ids.institutionB })).body.data.source, 'DEFAULT');
    });
    async function race(configurations) {
      const transaction = prisma.$transaction.bind(prisma); const barrier = Promise.withResolvers(); let reads = 0;
      prisma.$transaction = (work, options) => typeof work === 'function' ? transaction(async (tx) => work(new Proxy(tx, { get(target, key) {
        if (key !== 'institution') return target[key];
        return new Proxy(target.institution, { get(delegate, method) {
          if (method !== 'findFirst') return delegate[method];
          return async (args) => { const result = await delegate.findFirst(args); if (++reads <= 2) { if (reads === 2) barrier.resolve(); await barrier.promise; } return result; };
        } });
      } })), options) : transaction(work, options);
      try { return await Promise.all(configurations.map((configuration) => configure(configuration))); }
      finally { prisma.$transaction = transaction; }
    }
    await t.test('equivalent simultaneous configuration creates one version and returns 201/200', async () => {
      const before = await prisma.reassignmentPolicy.count({ where: { institutionId: ids.institutionA } });
      const input = { ...waitingFirst, offerTtlMinutes: 1 }; const results = await race([input, input]);
      assert.deepEqual(results.map((r) => r.status).sort(), [200, 201]); assert.equal(results[0].body.data.id, results[1].body.data.id);
      assert.equal(await prisma.reassignmentPolicy.count({ where: { institutionId: ids.institutionA } }), before + 1);
    });
    await t.test('different simultaneous configuration creates monotonic distinct versions and one current pointer', async () => {
      const results = await race([{ ...priorityFirst, offerTtlMinutes: 9 }, { ...waitingFirst, offerTtlMinutes: 11 }]);
      assert.deepEqual(results.map((r) => r.status), [201, 201]);
      const versions = await prisma.reassignmentPolicy.findMany({ where: { institutionId: ids.institutionA }, orderBy: { version: 'asc' } });
      assert.deepEqual(versions.map((v) => v.version), versions.map((_, index) => index + 1));
      assert.equal((await get()).body.data.id, versions.at(-1).id);
    });
    await t.test('failure after policy INSERT and pointer UPDATE rolls back both SQL writes', async () => {
      const before = await prisma.institution.findUniqueOrThrow({ where: { id: ids.institutionA } });
      const count = await prisma.reassignmentPolicy.count({ where: { institutionId: ids.institutionA } });
      const transaction = prisma.$transaction.bind(prisma);
      prisma.$transaction = (work, options) => typeof work === 'function' ? transaction(async (tx) => work(new Proxy(tx, { get(target, key) {
        if (key !== 'institution') return target[key];
        return new Proxy(target.institution, { get(delegate, method) {
          if (method !== 'updateMany') return delegate[method];
          return async (args) => { await delegate.updateMany(args); throw new Error('private policy failure'); };
        } });
      } })), options) : transaction(work, options);
      try { const result = await configure({ ...priorityFirst, offerTtlMinutes: 12 }); assert.equal(result.status, 500); assert.equal(JSON.stringify(result.body).includes('private'), false); }
      finally { prisma.$transaction = transaction; }
      assert.deepEqual(await prisma.institution.findUniqueOrThrow({ where: { id: ids.institutionA } }), before);
      assert.equal(await prisma.reassignmentPolicy.count({ where: { institutionId: ids.institutionA } }), count);
    });
  } finally {
    try {
      if (prisma && cleanupEnabled) {
        await prisma.$transaction([
          prisma.appointmentOffer.deleteMany({ where: { reassignmentId: { in: processIds } } }),
          prisma.reassignmentCandidate.deleteMany({ where: { reassignmentId: { in: processIds } } }),
          prisma.reassignment.deleteMany({ where: { id: { in: processIds } } }),
          prisma.institution.updateMany({ where: { id: ids.institutionA, currentReassignmentPolicyId: { in: policyIds } }, data: { currentReassignmentPolicyId: null } }),
          prisma.reassignmentPolicy.deleteMany({ where: { id: { in: policyIds }, institutionId: ids.institutionA, createdByUserId: { in: users } } }),
          prisma.waitlistPreferredDay.deleteMany({ where: { preference: { waitlistEntry: { userId: { in: users } } } } }),
          prisma.waitlistTimeRange.deleteMany({ where: { preference: { waitlistEntry: { userId: { in: users } } } } }),
          prisma.waitlistPreferredBranch.deleteMany({ where: { waitlistEntry: { userId: { in: users } } } }),
          prisma.waitlistPreference.deleteMany({ where: { waitlistEntry: { userId: { in: users } } } }),
          prisma.waitlistEntry.deleteMany({ where: { userId: { in: users } } }),
          prisma.priority.deleteMany({ where: { id: { in: priorityIds }, institutionId: ids.institutionA } }),
        ]);
        await cleanupCheckpointFixtures(prisma);
        await prisma.permission.deleteMany({ where: { id: { in: permissionsCreated } } });
        await assertCheckpointIsClean(prisma);
      }
    } finally { await app.close(); }
  }
});
