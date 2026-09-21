import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test, mock } from 'node:test';
import { NestFactory } from '@nestjs/core';
import { loadApiEnvironment, assertSafeLocalDatabaseUrl, getE2ePort } from './local-environment.mjs';
import { FIXTURE_EMAIL_PREFIX, ids, createExpirationFixtures, cleanupExpirationFixtures, assertExpirationClean } from './offer-expiration.fixture.mjs';

test('HU-023 real PostgreSQL expiration, continuation, invariants, rollback and races', { timeout: 120_000 }, async (t) => {
  loadApiEnvironment(); assertSafeLocalDatabaseUrl(process.env.DATABASE_URL); process.env.NODE_ENV = 'test';
  const [{ AppModule }, { configureApplication }, { PrismaService }, { ReassignmentsService }, { AuditService },
    { bootstrapAppointmentStatus }, { bootstrapWaitlist }] = await Promise.all([
    import('../../dist/app.module.js'), import('../../dist/app.configuration.js'), import('../../dist/database/prisma.service.js'),
    import('../../dist/reassignments/reassignments.service.js'), import('../../dist/audit/audit.service.js'),
    import('../../dist/database/appointment-status.bootstrap.js'), import('../../dist/database/waitlist.bootstrap.js'),
  ]);
  const app = await NestFactory.create(AppModule, { logger: false });
  let prisma; const users = [], ownedPermissions = [], ownedStatuses = [], ownedWaitlistStatuses = [];
  try {
    configureApplication(app); await app.listen(getE2ePort(), '127.0.0.1'); prisma = app.get(PrismaService);
    const service = app.get(ReassignmentsService);
    const base = `http://127.0.0.1:${app.getHttpServer().address().port}/api/v1`;
    async function request(method, path, user, body, scope = {}) {
      const response = await fetch(`${base}${path}`, { method,
        headers: { ...scope, ...(user ? { authorization: `Bearer ${user.token}` } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}) });
      const text = await response.text(); return { status: response.status, body: text ? JSON.parse(text) : null };
    }
    async function register() {
      const credentials = { email: `${FIXTURE_EMAIL_PREFIX}${randomUUID()}@example.com`, password: `Test-${randomUUID()}-Aa1!` };
      const registered = await request('POST', '/auth/register', null, { ...credentials, firstName: 'Expiration', lastName: 'Fixture' });
      assert.equal(registered.status, 201); users.push(registered.body.id);
      const login = await request('POST', '/auth/login', null, credentials); assert.equal(login.status, 200);
      return { id: registered.body.id, token: login.body.accessToken };
    }
    const admin = await register(), source = await register();
    await createExpirationFixtures(prisma, admin.id, source.id);
    let permission = await prisma.permission.findUnique({ where: { code: 'reassignments.generate' } });
    if (!permission) { permission = await prisma.permission.create({ data: { id: randomUUID(), code: 'reassignments.generate', module: 'reassignments', action: 'generate' } }); ownedPermissions.push(permission.id); }
    await prisma.rolePermission.create({ data: { roleId: ids.roleInstitution, permissionId: permission.id } });
    const oldStatuses = await prisma.appointmentStatus.findMany({ select: { id: true } }); await bootstrapAppointmentStatus(prisma);
    ownedStatuses.push(...(await prisma.appointmentStatus.findMany({ select: { id: true } })).filter((r) => !oldStatuses.some((o) => o.id === r.id)).map((r) => r.id));
    const oldWaitlist = await prisma.waitlistStatus.findMany({ select: { id: true } }); await bootstrapWaitlist(prisma, ids.institutionA);
    ownedWaitlistStatuses.push(...(await prisma.waitlistStatus.findMany({ select: { id: true } })).filter((r) => !oldWaitlist.some((o) => o.id === r.id)).map((r) => r.id));
    const recipients = [];
    for (let i = 0; i < 5; i++) {
      const user = await register(); const entry = await request('POST', '/waitlist', user, { serviceId: ids.serviceA, branchId: ids.branchA1 });
      assert.equal(entry.status, 201); user.entryId = entry.body.data.id; recipients.push(user);
      const saved = await request('PUT', `/waitlist/${user.entryId}/preferences`, user, { preferredDays: [1,2,3,4,5,6,7],
        timeRanges: [{ start: '00:00', end: '23:59' }], preferredBranchIds: [], allowsOtherBranches: false, acceptsAnyProfessional: true });
      assert.equal(saved.status, 200);
    }
    const headers = { 'x-institution-id': ids.institutionA }; let sequence = 0;
    const original = await prisma.agendaSlot.findUniqueOrThrow({ where: { id: ids.slotAvailable } });
    async function generate() {
      const startsAt = new Date(+original.startsAt + (++sequence) * 1_800_000);
      const slot = await prisma.agendaSlot.create({ data: { id: randomUUID(), availabilityId: ids.availabilityMain,
        startsAt, endsAt: new Date(+startsAt + 1_800_000), status: 'AVAILABLE' } });
      const booked = await request('POST', '/appointments', source, { agendaSlotId: slot.id }); assert.equal(booked.status, 201);
      assert.equal((await request('POST', `/appointments/${booked.body.data.id}/cancel`, source)).status, 200);
      const result = await request('POST', `/reassignments/${slot.id}/offers`, admin, null, headers); assert.equal(result.status, 201);
      assert.ok(result.body.data.offer); return { ...result.body.data, slotId: slot.id, appointmentId: booked.body.data.id };
    }
    async function due(id) { await prisma.appointmentOffer.update({ where: { id }, data: {
      createdAt: new Date(Date.now() - 120_000), expiresAt: new Date(Date.now() - 60_000) } }); }
    const offers = (id) => prisma.appointmentOffer.findMany({ where: { reassignmentId: id }, orderBy: { attemptNumber: 'asc' } });
    const events = (id) => prisma.auditEvent.findMany({ where: { actionCode: 'OFFER_EXPIRED', resourceId: id } });
    const stored = (id) => prisma.reassignment.findUniqueOrThrow({ where: { id } });

    await t.test('current offer no-op; due equality persists once, keeps bound policy and never transfers appointment', async (st) => {
      const policy = await prisma.reassignmentPolicy.create({ data: { id: randomUUID(), institutionId: ids.institutionA,
        version: 1, rankingStrategy: 'PRIORITY_THEN_WAITING', offerTtlMinutes: 7, createdByUserId: admin.id } });
      await prisma.institution.update({ where: { id: ids.institutionA }, data: { currentReassignmentPolicyId: policy.id } });
      const p = await generate(); const before = await offers(p.id);
      assert.equal((await service.expireOffer(p.offer.id)).status, 'NOT_DUE'); assert.deepEqual(await offers(p.id), before);
      const nextPolicy = await prisma.reassignmentPolicy.create({ data: { id: randomUUID(), institutionId: ids.institutionA,
        version: 2, rankingStrategy: 'WAITING_THEN_PRIORITY', offerTtlMinutes: 3, createdByUserId: admin.id } });
      await prisma.institution.update({ where: { id: ids.institutionA }, data: { currentReassignmentPolicyId: nextPolicy.id } });
      const appointment = await prisma.appointment.findUniqueOrThrow({ where: { id: p.appointmentId } });
      const now = Date.now(); await prisma.appointmentOffer.update({ where: { id: p.offer.id }, data: { createdAt: new Date(now - 1000), expiresAt: new Date(now) } });
      st.mock.timers.enable({ apis: ['Date'], now });
      try { await service.expireOffer(p.offer.id); } finally { st.mock.timers.reset(); }
      const rows = await offers(p.id); assert.equal(rows.length, 2); assert.equal(rows[0].status, 'EXPIRED');
      assert.equal(rows[0].respondedAt, null); assert.equal(rows[0].respondedByUserId, null); assert.equal(+rows[0].resolvedAt, now);
      assert.equal(rows[1].attemptNumber, 2); assert.equal(rows[1].expiresAt - rows[1].createdAt, 420_000);
      assert.deepEqual(await prisma.appointment.findUniqueOrThrow({ where: { id: p.appointmentId } }), appointment);
      await service.expireOffer(p.offer.id); assert.deepEqual(await offers(p.id), rows); assert.equal((await events(p.offer.id)).length, 1);
      const event = (await events(p.offer.id))[0]; assert.equal(event.actorType, 'SYSTEM'); assert.equal(event.actorUserId, null);
      assert.equal(event.institutionId, ids.institutionA); assert.equal(event.branchId, ids.branchA1);
      assert.ok(!JSON.stringify(event).includes(FIXTURE_EMAIL_PREFIX));
    });

    await t.test('SQL candidate selection skips previously used, withdrawn, changed and incompatible entries, then exhausts', async () => {
      const p = await generate(); const ranked = await prisma.reassignmentCandidate.findMany({ where: { reassignmentId: p.id }, orderBy: { rankingPosition: 'asc' } });
      const entries = await prisma.waitlistEntry.findMany({ where: { id: { in: ranked.map((r) => r.waitlistEntryId) } } });
      const withdrawn = await prisma.waitlistStatus.findUniqueOrThrow({ where: { code: 'WITHDRAWN' } });
      const invalidUser = await prisma.user.findUniqueOrThrow({ where: { id: ranked[3].userId } });
      try {
        await prisma.waitlistEntry.update({ where: { id: ranked[1].waitlistEntryId }, data: { statusId: withdrawn.id } });
        await prisma.waitlistEntry.update({ where: { id: ranked[2].waitlistEntryId }, data: { updatedAt: new Date(+ranked[2].entryUpdatedAtSnapshot + 1000) } });
        await prisma.user.update({ where: { id: ranked[3].userId }, data: { status: 'INACTIVE' } });
        await due(p.offer.id); await service.expireOffer(p.offer.id);
        const rows = await offers(p.id); assert.equal(rows.length, 2); assert.equal(rows[1].candidateId, ranked[4].id);
        await due(rows[1].id); await service.expireOffer(rows[1].id);
        assert.equal((await stored(p.id)).status, 'EXHAUSTED'); assert.equal((await offers(p.id)).length, 2);
        assert.equal(await prisma.auditEvent.count({ where: { resourceId: p.id, actionCode: 'REASSIGNMENT_EXHAUSTED' } }), 1);
      } finally {
        for (const entry of entries) await prisma.waitlistEntry.update({ where: { id: entry.id }, data: { statusId: entry.statusId, updatedAt: entry.updatedAt } });
        await prisma.user.update({ where: { id: invalidUser.id }, data: { status: invalidUser.status } });
      }
    });

    await t.test('unusable slots cancel; cross-tenant invariant fails without repairing another institution', async () => {
      for (const change of ['version', 'blocked', 'started', 'inactive', 'foreign']) {
        const p = await generate(); await due(p.offer.id);
        if (change === 'version') await prisma.agendaSlot.update({ where: { id: p.slotId }, data: { lockVersion: { increment: 1 } } });
        if (change === 'blocked') await prisma.agendaSlot.update({ where: { id: p.slotId }, data: { status: 'BLOCKED' } });
        if (change === 'started') await prisma.agendaSlot.update({ where: { id: p.slotId }, data: { startsAt: new Date(Date.now() - 60000) } });
        if (change === 'inactive') await prisma.availability.update({ where: { id: ids.availabilityMain }, data: { active: false } });
        if (change === 'foreign') await prisma.appointment.update({ where: { id: p.appointmentId }, data: { institutionId: ids.institutionB } });
        try {
          await service.expireOffer(p.offer.id); assert.equal((await stored(p.id)).status, change === 'foreign' ? 'FAILED' : 'CANCELLED');
          assert.equal((await offers(p.id)).length, 1); assert.equal((await offers(p.id))[0].status, 'EXPIRED');
          if (change === 'foreign') assert.equal((await prisma.appointment.findUniqueOrThrow({ where: { id: p.appointmentId } })).institutionId, ids.institutionB);
          assert.equal(await prisma.auditEvent.count({ where: { resourceId: p.offer.id, institutionId: ids.institutionB } }), 0);
        } finally { if (change === 'inactive') await prisma.availability.update({ where: { id: ids.availabilityMain }, data: { active: true } }); }
      }
    });

    await t.test('failure after next offer audit INSERT rolls back expiration, next offer and every audit write', async () => {
      const p = await generate(); await due(p.offer.id); const before = await offers(p.id), process = await stored(p.id);
      const record = AuditService.record; let inserted = false;
      const spy = mock.method(AuditService, 'record', async (tx, event) => { await record(tx, event);
        if (event.actionCode === 'OFFER_CREATED') { inserted = true; throw new Error('injected private failure'); } });
      try { await assert.rejects(service.expireOffer(p.offer.id), (e) => e.getStatus() === 500); } finally { spy.mock.restore(); }
      assert.ok(inserted); assert.deepEqual(await offers(p.id), before); assert.deepEqual(await stored(p.id), process);
      assert.equal((await events(p.offer.id)).length, 0);
      await service.expireOffer(p.offer.id); assert.equal((await offers(p.id)).length, 2);
    });

    // Barriers force both transactions to read PENDING before either transition, not merely Promise.all timing.
    async function race(st, human, winner) {
      const p = await generate(); const row = (await offers(p.id))[0];
      const candidate = await prisma.reassignmentCandidate.findUniqueOrThrow({ where: { id: row.candidateId } });
      const now = Date.now();
      await prisma.appointmentOffer.update({ where: { id: row.id }, data: { createdAt: new Date(now - 1000), expiresAt: new Date(now + (human ? 100 : -100)) } });
      st.mock.timers.enable({ apis: ['Date'], now });
      const originalTransaction = prisma.$transaction.bind(prisma);
      let reads = 0, releaseReads, firstRead, releaseWinner;
      const bothRead = new Promise((r) => { releaseReads = r; });
      const first = new Promise((r) => { firstRead = r; });
      const committed = new Promise((r) => { releaseWinner = r; });
      const timeout = setTimeout(() => { releaseReads(); releaseWinner(); }, 5000);
      prisma.$transaction = async (fn, options) => {
        let operation;
        try { return await originalTransaction((tx) => fn(new Proxy(tx, { get(target, key) {
          if (key !== 'appointmentOffer') return target[key];
          return new Proxy(target.appointmentOffer, { get(delegate, property) {
            if (property === 'findUnique') return async (args) => { const result = await delegate.findUnique(args);
              if (++reads <= 2) { if (reads === 1) firstRead(); else releaseReads(); await bothRead; } return result; };
            if (property === 'updateMany') return async (args) => { operation = args.data.status;
              if (winner && operation !== winner) await committed; return delegate.updateMany(args); };
            return delegate[property];
          } });
        } })), options); } finally { if (operation === winner) releaseWinner(); }
      };
      let results;
      try {
        const firstOperation = human ? service[human](row.id, { userId: candidate.userId }) : service.expireOffer(row.id);
        const firstResult = Promise.allSettled([firstOperation]);
        await first; if (human) st.mock.timers.setTime(now + 200);
        const secondResult = Promise.allSettled([service.expireOffer(row.id)]);
        results = [...await firstResult, ...await secondResult];
      } finally { clearTimeout(timeout); releaseReads(); releaseWinner(); prisma.$transaction = originalTransaction; st.mock.timers.reset(); }
      const final = await offers(p.id); const expected = winner ?? 'EXPIRED';
      assert.equal(reads, 3, 'the losing transaction must reread after the PostgreSQL serialization conflict');
      assert.equal(final[0].status, expected); assert.equal(final[0].lockVersion, row.lockVersion + 1);
      assert.equal(final.length, expected === 'ACCEPTED' ? 1 : 2); assert.ok(final.filter((o) => o.status === 'PENDING').length <= 1);
      assert.equal((await events(row.id)).length, expected === 'EXPIRED' ? 1 : 0);
      assert.ok(results.some((r) => r.status === 'fulfilled'));
      if (human && expected === 'EXPIRED') { assert.equal(results[0].status, 'rejected'); assert.equal(results[0].reason.getStatus(), 409); }
      else assert.ok(results.every((r) => r.status === 'fulfilled'));
      assert.equal(await prisma.appointment.count({ where: { agendaSlotId: p.slotId } }), 1);
      await service.expireOffer(row.id); assert.deepEqual(await offers(p.id), final);
      // Keep this recipient eligible for independent subsequent race fixtures.
      if (expected === 'ACCEPTED') {
        const active = await prisma.waitlistStatus.findUniqueOrThrow({ where: { code: 'ACTIVE' } });
        await prisma.waitlistEntry.update({ where: { id: candidate.waitlistEntryId }, data: { statusId: active.id } });
      }
    }
    await t.test('expiry vs expiry creates exactly one next offer and one expiration audit', (st) => race(st));
    for (const [human, state] of [['acceptOffer','ACCEPTED'], ['rejectOffer','REJECTED']]) {
      await t.test(`expiry vs ${human}: expiry wins safely`, (st) => race(st, human, 'EXPIRED'));
      await t.test(`expiry vs ${human}: human transition wins safely`, (st) => race(st, human, state));
    }
  } finally {
    if (prisma) {
      try {
        const scope = { institutionId: { in: [ids.institutionA, ids.institutionB] } };
        await prisma.appointmentOffer.deleteMany({ where: { reassignment: scope } });
        await prisma.reassignmentCandidate.deleteMany({ where: { reassignment: scope } });
        await prisma.reassignment.deleteMany({ where: scope });
        const entry = { userId: { in: users } };
        await prisma.waitlistPreferredDay.deleteMany({ where: { preference: { waitlistEntry: entry } } });
        await prisma.waitlistTimeRange.deleteMany({ where: { preference: { waitlistEntry: entry } } });
        await prisma.waitlistPreferredBranch.deleteMany({ where: { waitlistEntry: entry } });
        await prisma.waitlistPreference.deleteMany({ where: { waitlistEntry: entry } });
        await prisma.waitlistEntry.deleteMany({ where: entry });
        await prisma.priority.deleteMany({ where: { institutionId: ids.institutionA } });
        await cleanupExpirationFixtures(prisma);
        await prisma.permission.deleteMany({ where: { id: { in: ownedPermissions } } });
        await prisma.appointmentStatus.deleteMany({ where: { id: { in: ownedStatuses } } });
        await prisma.waitlistStatus.deleteMany({ where: { id: { in: ownedWaitlistStatuses } } });
        await assertExpirationClean(prisma);
        assert.equal(await prisma.auditEvent.count({ where: { OR: [{ institutionId: scope.institutionId }, { actorUserId: { in: users } }] } }), 0);
      } finally { await app.close(); }
    } else await app.close();
  }
});
