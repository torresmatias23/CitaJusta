import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { test } from 'node:test';
import { NestFactory } from '@nestjs/core';
import { loadApiEnvironment, assertSafeLocalDatabaseUrl, getE2ePort } from './local-environment.mjs';
import { FIXTURE_EMAIL_PREFIX, ids, cleanupCheckpointFixtures, createCheckpointFixtures, assertCheckpointIsClean } from './fixture.mjs';
import { provisionFixtureWaitlist } from './waitlist-catalog.fixture.mjs';

test('HU-007/HU-008 real HTTP and PostgreSQL waitlist', { timeout: 120_000 }, async (t) => {
  loadApiEnvironment();
  assertSafeLocalDatabaseUrl(process.env.DATABASE_URL);
  process.env.NODE_ENV = 'test';
  const [{ AppModule }, { configureApplication }, { PrismaService }, { bootstrapWaitlist }] = await Promise.all([
    import('../../dist/app.module.js'), import('../../dist/app.configuration.js'),
    import('../../dist/database/prisma.service.js'), import('../../dist/database/waitlist.bootstrap.js'),
  ]);
  const app = await NestFactory.create(AppModule, { logger: false });
  const userIds = [];
  const priorityIds = [];
  const statusIds = [];
  let prisma;
  let cleanupEnabled = false;
  try {
    configureApplication(app);
    await app.listen(getE2ePort(), '127.0.0.1');
    prisma = app.get(PrismaService);
    await cleanupCheckpointFixtures(prisma);
    cleanupEnabled = true;
    const base = `http://127.0.0.1:${app.getHttpServer().address().port}`;
    function request(method, path, token, body, extraHeaders = {}) {
      const payload = body === undefined ? undefined : JSON.stringify(body);
      return new Promise((resolve, reject) => {
        const req = httpRequest(`${base}${path}`, {
          method, headers: {
            ...(token ? { authorization: `Bearer ${token}` } : {}),
            ...(payload === undefined ? {} : { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) }),
            ...extraHeaders,
          },
        }, (res) => {
          let text = ''; res.setEncoding('utf8');
          res.on('data', (chunk) => { text += chunk; }); res.on('error', reject);
          res.on('end', () => {
            let body = text;
            try { body = JSON.parse(text); } catch { /* Unmatched routes can return HTML. */ }
            resolve({ status: res.statusCode, body });
          });
        });
        req.on('error', reject); req.end(payload);
      });
    }
    async function register() {
      const credentials = { email: `${FIXTURE_EMAIL_PREFIX}${randomUUID()}@example.com`, password: `E2e-${randomUUID()}-Aa1!` };
      const response = await request('POST', '/api/v1/auth/register', undefined, { ...credentials, firstName: 'Waitlist', lastName: 'Checkpoint' });
      assert.equal(response.status, 201);
      userIds.push(response.body.id);
      const login = await request('POST', '/api/v1/auth/login', undefined, credentials);
      assert.equal(login.status, 200);
      return { id: response.body.id, token: login.body.accessToken };
    }
    const first = await register();
    const second = await register();
    const race = await register();
    const rollbackUser = await register();
    await createCheckpointFixtures(prisma, first.id);
    // Both branches really offer this service; branch changes must still count as duplicates.
    await prisma.serviceBranch.create({ data: { serviceId: ids.serviceA, branchId: ids.branchA2 } });
    await provisionFixtureWaitlist(prisma, ids.institutionA, statusIds);
    priorityIds.push((await prisma.priority.findUniqueOrThrow({ where: { institutionId_code: { institutionId: ids.institutionA, code: 'STANDARD' } } })).id);
    await bootstrapWaitlist(prisma, ids.institutionB);
    priorityIds.push((await prisma.priority.findUniqueOrThrow({ where: { institutionId_code: { institutionId: ids.institutionB, code: 'STANDARD' } } })).id);
    const active = await prisma.waitlistStatus.findUniqueOrThrow({ where: { code: 'ACTIVE' } });
    const final = await prisma.waitlistStatus.create({ data: { id: randomUUID(), code: `E2E_WAITLIST_FINAL_${randomUUID()}`, name: 'Final fixture', isFinal: true } });
    const inactiveOpen = await prisma.waitlistStatus.create({ data: { id: randomUUID(), code: `E2E_WAITLIST_OPEN_${randomUUID()}`, name: 'Open fixture', active: false, isFinal: false } });
    statusIds.push(final.id, inactiveOpen.id);
    const post = (body, user = first, query = '', headers = {}) => request('POST', `/api/v1/waitlist${query}`, user?.token, body, headers);
    const get = (user = first, query = '', body) => request('GET', `/api/v1/waitlist${query}`, user?.token, body);
    const rows = (user = first) => prisma.waitlistEntry.findMany({ where: { userId: user.id }, orderBy: [{ enteredAt: 'asc' }, { id: 'asc' }] });
    const sideEffects = async () => ({
      appointments: await prisma.appointment.findMany({ where: { institutionId: { in: [ids.institutionA, ids.institutionB] } } }),
      slots: await prisma.agendaSlot.findMany({ where: { availability: { serviceId: { in: [ids.serviceA, ids.serviceA2, ids.serviceB] } } }, orderBy: { id: 'asc' } }),
      preferences: await prisma.waitlistPreference.count({ where: { waitlistEntry: { userId: { in: userIds } } } }),
      candidates: await prisma.reassignmentCandidate.count({ where: { userId: { in: userIds } } }),
      offers: await prisma.appointmentOffer.count({ where: { candidate: { userId: { in: userIds } } } }),
      reassignments: await prisma.reassignment.count({ where: { institutionId: { in: [ids.institutionA, ids.institutionB] } } }),
    });
    const before = await sideEffects();
    let firstEntry;
    let secondEntry;

    await t.test('bootstrap repeated and concurrent preserves identifiers and existing settings', async () => {
      const priority = await prisma.priority.findUniqueOrThrow({ where: { id: priorityIds[0] } });
      await prisma.priority.update({ where: { id: priority.id }, data: { level: 17, name: 'Configured fixture' } });
      const configured = await prisma.priority.findUniqueOrThrow({ where: { id: priority.id } });
      await Promise.all([bootstrapWaitlist(prisma, ids.institutionA), bootstrapWaitlist(prisma, ids.institutionA)]);
      assert.deepEqual(await prisma.priority.findUniqueOrThrow({ where: { id: priority.id } }), configured);
      assert.deepEqual(await prisma.waitlistStatus.findUniqueOrThrow({ where: { code: 'ACTIVE' } }), active);
      assert.equal(await prisma.priority.count({ where: { institutionId: ids.institutionA, code: 'STANDARD' } }), 1);
    });
    await t.test('concurrent bootstrap creates exactly one missing institutional STANDARD', async () => {
      await prisma.priority.delete({ where: { id: priorityIds[1] } });
      await Promise.all([bootstrapWaitlist(prisma, ids.institutionB), bootstrapWaitlist(prisma, ids.institutionB)]);
      const priorities = await prisma.priority.findMany({ where: { institutionId: ids.institutionB, code: 'STANDARD' } });
      assert.equal(priorities.length, 1);
      priorityIds.push(priorities[0].id);
    });
    await t.test('GET/POST require authentication, strict inputs and versioned route', async () => {
      assert.equal((await post({ serviceId: ids.serviceA }, null)).status, 401);
      assert.equal((await get(null)).status, 401);
      assert.equal((await request('GET', '/waitlist', first.token)).status, 404);
      for (const body of [{}, { serviceId: 'bad' }, { serviceId: ids.serviceA, branchId: 'bad' },
        ...['userId', 'institutionId', 'statusId', 'status', 'priorityId', 'professionalId', 'score', 'position', 'enteredAt', 'preference', 'offer'].map((key) => ({ serviceId: ids.serviceA, [key]: randomUUID() }))]) {
        assert.equal((await post(body)).status, 400);
      }
      assert.equal((await post({ serviceId: ids.serviceA }, first, '?userId=other')).status, 400);
      assert.equal((await get(first, '?userId=other')).status, 400);
      assert.equal((await get(first, '', { userId: second.id })).status, 400);
      assert.equal((await rows()).length, 0);
    });
    await t.test('real joins reject unavailable services, branches and cross-tenant assignments', async () => {
      for (const body of [
        { serviceId: ids.missing }, { serviceId: ids.serviceInactive },
        { serviceId: ids.serviceA, branchId: ids.missing },
        { serviceId: ids.serviceA, branchId: ids.branchInactive },
        { serviceId: ids.serviceA, branchId: ids.branchB1 },
        { serviceId: ids.serviceA2, branchId: ids.branchA1 },
      ]) assert.equal((await post(body)).status, 404);
      for (const [model, where, data, restore, expected] of [
        ['service', { id: ids.serviceA }, { deletedAt: new Date() }, { deletedAt: null }, 404],
        ['service', { id: ids.serviceA }, { allowsWaitlist: false }, { allowsWaitlist: true }, 409],
        ['institution', { id: ids.institutionA }, { status: 'INACTIVE' }, { status: 'ACTIVE' }, 404],
        ['institution', { id: ids.institutionA }, { deletedAt: new Date() }, { deletedAt: null }, 404],
        ['branch', { id: ids.branchA1 }, { deletedAt: new Date() }, { deletedAt: null }, 404],
        ['branch', { id: ids.branchA1 }, { status: 'INACTIVE' }, { status: 'ACTIVE' }, 404],
        ['serviceBranch', { serviceId_branchId: { serviceId: ids.serviceA, branchId: ids.branchA1 } }, { active: false }, { active: true }, 404],
      ]) {
        await prisma[model].update({ where, data });
        try { assert.equal((await post({ serviceId: ids.serviceA, branchId: ids.branchA1 })).status, expected, model); }
        finally { await prisma[model].update({ where, data: restore }); }
      }
      assert.equal((await rows()).length, 0);
    });
    await t.test('POST without branch derives owner/institution and preserves preference defaults', async () => {
      const response = await post({ serviceId: ids.serviceA }, first, '', { 'x-institution-id': ids.institutionB });
      assert.equal(response.status, 201);
      firstEntry = response.body.data;
      assert.deepEqual(Object.keys(response.body), ['data']);
      assert.deepEqual(Object.keys(firstEntry).sort(), ['id', 'status', 'enteredAt', 'service', 'branch'].sort());
      assert.deepEqual(Object.keys(firstEntry.service).sort(), ['id', 'name']);
      assert.equal(firstEntry.branch, null);
      assert.equal(firstEntry.status, 'ACTIVE');
      assert.equal(new Date(firstEntry.enteredAt).toISOString(), firstEntry.enteredAt);
      const [row] = await rows();
      assert.equal(row.userId, first.id); assert.equal(row.institutionId, ids.institutionA);
      assert.equal(row.serviceId, ids.serviceA); assert.equal(row.branchId, null);
      assert.equal(row.allowsOtherBranches, false); assert.equal(row.minimumNoticeMinutes, 0);
      assert.equal(row.operationalNote, null); assert.equal(row.deadlineDate, null);
      assert.equal(row.statusId, active.id); assert.equal(row.priorityId, priorityIds[0]);
    });
    await t.test('unavailable institutional STANDARD returns 503 instead of falling back or provisioning', async () => {
      for (const [invalid, restore] of [
        [{ active: false }, { active: true }],
        [{ code: 'E2E_TEMP_STANDARD' }, { code: 'STANDARD' }],
      ]) {
        await prisma.priority.update({ where: { id: priorityIds[0] }, data: invalid });
        try { assert.equal((await post({ serviceId: ids.serviceA }, rollbackUser)).status, 503); }
        finally { await prisma.priority.update({ where: { id: priorityIds[0] }, data: restore }); }
      }
      assert.equal((await rows(rollbackUser)).length, 0);
    });
    await t.test('GET isolates users and empty list, POST with a valid branch returns controlled branch', async () => {
      assert.deepEqual((await get(second)).body, { data: [] });
      assert.deepEqual((await get()).body, { data: [firstEntry] });
      const response = await post({ serviceId: ids.serviceA2, branchId: ids.branchA2 });
      assert.equal(response.status, 201); secondEntry = response.body.data;
      assert.equal(secondEntry.branch.id, ids.branchA2);
      assert.deepEqual(Object.keys(secondEntry.branch).sort(), ['id', 'name']);
      assert.deepEqual((await get(second)).body, { data: [] });
    });
    await t.test('sequential duplicates including changed branches return 409', async () => {
      for (const body of [{ serviceId: ids.serviceA }, { serviceId: ids.serviceA, branchId: ids.branchA1 }, { serviceId: ids.serviceA, branchId: ids.branchA2 }]) {
        assert.equal((await post(body)).status, 409);
      }
      assert.equal((await rows()).filter((row) => row.serviceId === ids.serviceA).length, 1);
    });
    await t.test('different users can wait for the same service without seeing each other', async () => {
      const response = await post({ serviceId: ids.serviceA }, second);
      assert.equal(response.status, 201);
      assert.deepEqual((await get(second)).body.data.map((entry) => entry.id), [response.body.data.id]);
      assert.ok(!(await get()).body.data.some((entry) => entry.id === response.body.data.id));
    });
    await t.test('two real transactions read absence concurrently: one 201, one 409, one row', async () => {
      const originalTransaction = prisma.$transaction.bind(prisma);
      let arrivals = 0;
      let release;
      const barrier = new Promise((resolve) => { release = resolve; });
      const timer = setTimeout(release, 5000);
      prisma.$transaction = (fn, options) => originalTransaction((tx) => fn(new Proxy(tx, {
        get(target, property) {
          if (property !== 'waitlistEntry') return target[property];
          return new Proxy(target.waitlistEntry, { get(delegate, key) {
            if (key !== 'findFirst') return delegate[key];
            return async (args) => {
              const result = await delegate.findFirst(args);
              if (args.where.userId === race.id && ++arrivals <= 2) {
                assert.equal(result, null);
                if (arrivals === 2) release();
                await barrier;
              }
              return result;
            };
          } });
        },
      })), options);
      try {
        const responses = await Promise.all([
          post({ serviceId: ids.serviceA, branchId: ids.branchA1 }, race),
          post({ serviceId: ids.serviceA, branchId: ids.branchA2 }, race),
        ]);
        assert.deepEqual(responses.map((r) => r.status).sort(), [201, 409]);
        assert.equal(arrivals, 3, 'two initial predicate reads plus the full transaction retry');
        assert.equal((await rows(race)).length, 1);
      } finally { clearTimeout(timer); prisma.$transaction = originalTransaction; }
    });
    await t.test('actual INSERT rolls back on failure before commit, without leaking storage details', async () => {
      const originalTransaction = prisma.$transaction.bind(prisma);
      let inserted = false;
      prisma.$transaction = (fn, options) => originalTransaction((tx) => fn(new Proxy(tx, {
        get(target, property) {
          if (property !== 'waitlistEntry') return target[property];
          return new Proxy(target.waitlistEntry, { get(delegate, key) {
            if (key !== 'create') return delegate[key];
            return async (args) => {
              await delegate.create(args); inserted = true;
              throw new Error('Sensitive injected storage detail');
            };
          } });
        },
      })), options);
      try {
        const response = await post({ serviceId: ids.serviceA }, rollbackUser);
        assert.equal(response.status, 500); assert.ok(inserted);
        assert.ok(!JSON.stringify(response.body).includes('Sensitive'));
        assert.equal((await rows(rollbackUser)).length, 0);
      } finally { prisma.$transaction = originalTransaction; }
    });
    await t.test('finalized and deleted entries permit new enrollment and are excluded from GET', async () => {
      await prisma.waitlistEntry.update({ where: { id: firstEntry.id }, data: { statusId: final.id } });
      const renewed = await post({ serviceId: ids.serviceA });
      assert.equal(renewed.status, 201);
      await prisma.waitlistEntry.update({ where: { id: renewed.body.data.id }, data: { deletedAt: new Date() } });
      const renewedAgain = await post({ serviceId: ids.serviceA });
      assert.equal(renewedAgain.status, 201);
      const visible = (await get()).body.data.map((entry) => entry.id);
      assert.ok(!visible.includes(firstEntry.id)); assert.ok(!visible.includes(renewed.body.data.id));
      assert.ok(visible.includes(renewedAgain.body.data.id));
    });
    await t.test('open inactive status still blocks duplicates and remains listed', async () => {
      await prisma.waitlistEntry.update({ where: { id: secondEntry.id }, data: { statusId: inactiveOpen.id } });
      assert.equal((await post({ serviceId: ids.serviceA2 })).status, 409);
      assert.ok((await get()).body.data.some((entry) => entry.id === secondEntry.id && entry.status === inactiveOpen.code));
    });
    await t.test('GET ordering is enteredAt ASC then id ASC, including inactive catalogs', async () => {
      const where = { userId: first.id, deletedAt: null, status: { isFinal: false } };
      const open = await prisma.waitlistEntry.findMany({ where, orderBy: { id: 'asc' } });
      const tiedAt = new Date('2026-01-01T12:00:00Z');
      await prisma.waitlistEntry.updateMany({ where, data: { enteredAt: tiedAt } });
      assert.deepEqual((await get()).body.data.map((entry) => entry.id), open.map((entry) => entry.id));
      await prisma.waitlistEntry.update({ where: { id: open[1].id }, data: { enteredAt: new Date('2025-01-01T12:00:00Z') } });
      assert.deepEqual((await get()).body.data.map((entry) => entry.id), [open[1].id, open[0].id]);
      await prisma.service.update({ where: { id: ids.serviceA2 }, data: { active: false } });
      try { assert.equal((await get()).body.data.length, 2); }
      finally { await prisma.service.update({ where: { id: ids.serviceA2 }, data: { active: true } }); }
    });
    await t.test('GET hides incoherent tenant links without leaking catalog data', async () => {
      await prisma.waitlistEntry.update({ where: { id: secondEntry.id }, data: { branchId: ids.branchB1 } });
      try { assert.ok(!(await get()).body.data.some((entry) => entry.id === secondEntry.id)); }
      finally { await prisma.waitlistEntry.update({ where: { id: secondEntry.id }, data: { branchId: ids.branchA2 } }); }
    });
    await t.test('HU-007 has no appointment, slot, preference, candidate or offer side effects', async () => {
      assert.deepEqual(await sideEffects(), before);
    });

    const owner = await register();
    const enrolled = await post({ serviceId: ids.serviceA, branchId: ids.branchA1 }, owner);
    assert.equal(enrolled.status, 201);
    const entryId = enrolled.body.data.id;
    const path = `/api/v1/waitlist/${entryId}/preferences`;
    const withdrawPath = `/api/v1/waitlist/${entryId}/withdraw`;
    const emptyPreferences = { preferredDays: [], timeRanges: [], preferredBranchIds: [], allowsOtherBranches: false, acceptsAnyProfessional: true };
    const preferences = { ...emptyPreferences, preferredDays: [1, 5], timeRanges: [{ start: '08:30', end: '12:00' }], preferredBranchIds: [ids.branchA2, ids.branchA1], allowsOtherBranches: true, acceptsAnyProfessional: false };
    const persisted = () => prisma.waitlistEntry.findUniqueOrThrow({ where: { id: entryId }, include: { preference: { include: { preferredDays: true, timeRanges: true } }, preferredBranches: true } });
    await t.test('HU-008 empty GET, ownership, authentication and strict request boundaries', async () => {
      assert.deepEqual((await request('GET', path, owner.token)).body, { data: emptyPreferences });
      for (const [method, url, body] of [['GET', path], ['PUT', path, preferences], ['POST', withdrawPath]]) {
        assert.equal((await request(method, url, undefined, body)).status, 401);
        assert.equal((await request(method, url, second.token, body)).status, 404);
        assert.equal((await request(method, url.replace(entryId, randomUUID()), owner.token, body)).status, 404);
        assert.equal((await request(method, `${url}?userId=${second.id}`, owner.token, body)).status, 400);
      }
      assert.equal((await request('POST', withdrawPath, owner.token, { userId: owner.id })).status, 400);
      assert.equal((await request('PUT', path, owner.token, { ...preferences, institutionId: ids.institutionA })).status, 400);
    });
    await t.test('HU-008 persists controlled DTO, preserves original branch/enteredAt and advances updatedAt', async () => {
      const old = await persisted();
      const result = await request('PUT', path, owner.token, preferences);
      assert.equal(result.status, 200); assert.deepEqual(result.body, { data: preferences });
      assert.deepEqual((await request('GET', path, owner.token)).body, result.body);
      const current = await persisted();
      assert.equal(current.branchId, old.branchId); assert.deepEqual(current.enteredAt, old.enteredAt);
      assert.ok(current.updatedAt > old.updatedAt);
    });
    await t.test('HU-008 rejects invalid/duplicate/overlapping ranges and invalid branch relationships', async () => {
      for (const patch of [
        { preferredDays: [1, 1] }, { preferredBranchIds: [ids.branchA1, ids.branchA1] },
        { timeRanges: [{ start: '12:00', end: '12:00' }] },
        { timeRanges: [{ start: '08:00', end: '10:00' }, { start: '09:00', end: '11:00' }] },
      ]) assert.equal((await request('PUT', path, owner.token, { ...preferences, ...patch })).status, 400);
      for (const branchId of [ids.branchB1, ids.branchInactive, randomUUID()]) {
        assert.equal((await request('PUT', path, owner.token, { ...preferences, preferredBranchIds: [branchId] })).status, 404);
      }
      await prisma.serviceBranch.update({ where: { serviceId_branchId: { serviceId: ids.serviceA, branchId: ids.branchA2 } }, data: { active: false } });
      try {
        assert.equal((await request('PUT', path, owner.token, preferences)).status, 404);
        assert.deepEqual((await request('GET', path, owner.token)).body.data, preferences);
      } finally { await prisma.serviceBranch.update({ where: { serviceId_branchId: { serviceId: ids.serviceA, branchId: ids.branchA2 } }, data: { active: true } }); }
    });
    await t.test('HU-008 rollback restores parent, all children and timestamps after a real write', async () => {
      const old = await persisted(); const originalTransaction = prisma.$transaction.bind(prisma);
      let wrote = false;
      prisma.$transaction = (fn, options) => originalTransaction((tx) => fn(new Proxy(tx, {
        get(target, property) {
          if (property !== 'waitlistEntry') return target[property];
          return new Proxy(target.waitlistEntry, { get(delegate, key) {
            if (key !== 'update') return delegate[key];
            return async (args) => { await delegate.update(args); wrote = true; throw new Error('private fixture detail'); };
          } });
        },
      })), options);
      try {
        const result = await request('PUT', path, owner.token, emptyPreferences);
        assert.equal(result.status, 500); assert.ok(wrote);
        assert.ok(!JSON.stringify(result.body).includes('private fixture detail'));
      } finally { prisma.$transaction = originalTransaction; }
      assert.deepEqual(await persisted(), old);
    });
    await t.test('HU-008 replacement deletes omitted child rows and supports empty preferences', async () => {
      assert.deepEqual((await request('PUT', path, owner.token, emptyPreferences)).body, { data: emptyPreferences });
      const current = await persisted();
      assert.equal(current.preference.preferredDays.length, 0); assert.equal(current.preference.timeRanges.length, 0);
      assert.equal(current.preferredBranches.length, 0);
      assert.equal((await request('PUT', path, owner.token, preferences)).status, 200);
    });
    await t.test('HU-008 concurrent withdrawal retries whole transaction and has a single effective update', async () => {
      const old = await persisted(); const originalTransaction = prisma.$transaction.bind(prisma);
      let reads = 0; let updates = 0; let release;
      const barrier = new Promise((resolve) => { release = resolve; });
      const timer = setTimeout(release, 5000);
      prisma.$transaction = (fn, options) => originalTransaction((tx) => fn(new Proxy(tx, {
        get(target, property) {
          if (property !== 'waitlistEntry') return target[property];
          return new Proxy(target.waitlistEntry, { get(delegate, key) {
            if (key === 'findFirst') return async (args) => {
              const row = await delegate.findFirst(args);
              if (args.where.id === entryId && ++reads <= 2) { if (reads === 2) release(); await barrier; }
              return row;
            };
            if (key === 'update') return async (args) => { const row = await delegate.update(args); updates++; return row; };
            return delegate[key];
          } });
        },
      })), options);
      try {
        const results = await Promise.all([request('POST', withdrawPath, owner.token), request('POST', withdrawPath, owner.token)]);
        assert.deepEqual(results.map((r) => r.status), [200, 200]);
        assert.equal(reads, 3); assert.equal(updates, 1);
        for (const result of results) assert.deepEqual(result.body, { data: { id: entryId, status: 'WITHDRAWN' } });
      } finally { clearTimeout(timer); prisma.$transaction = originalTransaction; }
      const current = await persisted(); assert.deepEqual(current.preference, old.preference);
      assert.deepEqual(current.preferredBranches, old.preferredBranches); assert.deepEqual(current.enteredAt, old.enteredAt);
      assert.equal(current.branchId, old.branchId); assert.ok(current.updatedAt > old.updatedAt);
      assert.equal((await request('POST', withdrawPath, owner.token)).status, 200);
      assert.deepEqual(await persisted(), current);
      assert.equal((await request('PUT', path, owner.token, preferences)).status, 409);
      assert.deepEqual((await request('GET', path, owner.token)).body.data, preferences);
      assert.ok(!(await get(owner)).body.data.some((row) => row.id === entryId));
    });
    await t.test('HU-008 other final state rejects withdrawal and has no unrelated domain effects', async () => {
      assert.equal((await request('POST', `/api/v1/waitlist/${firstEntry.id}/withdraw`, first.token)).status, 409);
      const { preferences: ignoredBefore, ...domainBefore } = before;
      const { preferences: ignoredAfter, ...domainAfter } = await sideEffects();
      assert.deepEqual(domainAfter, domainBefore);
    });
  } finally {
    try {
      if (prisma && cleanupEnabled) {
        // Only users generated by this run and catalog IDs provisioned for its fixture institutions.
        // FK Restrict deliberately stops cleanup if unexpected downstream data was attached.
        await prisma.$transaction([
          prisma.waitlistPreferredDay.deleteMany({ where: { preference: { waitlistEntry: { userId: { in: userIds } } } } }),
          prisma.waitlistTimeRange.deleteMany({ where: { preference: { waitlistEntry: { userId: { in: userIds } } } } }),
          prisma.waitlistPreferredBranch.deleteMany({ where: { waitlistEntry: { userId: { in: userIds } } } }),
          prisma.waitlistPreference.deleteMany({ where: { waitlistEntry: { userId: { in: userIds } } } }),
          prisma.waitlistEntry.deleteMany({ where: { userId: { in: userIds } } }),
          prisma.priority.deleteMany({ where: { id: { in: priorityIds }, institutionId: { in: [ids.institutionA, ids.institutionB] } } }),
          prisma.waitlistStatus.deleteMany({ where: { id: { in: statusIds } } }),
        ]);
        assert.equal(await prisma.waitlistEntry.count({ where: { userId: { in: userIds } } }), 0);
        assert.equal(await prisma.waitlistStatus.count({ where: { id: { in: statusIds } } }), 0, 'no catalog created by this run remains');
        await cleanupCheckpointFixtures(prisma);
        await assertCheckpointIsClean(prisma);
      }
    } finally { await app.close(); }
  }
});
