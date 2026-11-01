import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { NestFactory } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { loadApiEnvironment, assertSafeLocalDatabaseUrl, getE2ePort } from './local-environment.mjs';
import { assertE2EFixtureDatabase } from '../../scripts/e2e-docker-environment.mjs';
import { FIXTURE_EMAIL_PREFIX, ids, cleanupCheckpointFixtures, createCheckpointFixtures, assertCheckpointIsClean } from './fixture.mjs';
import { provisionFixtureWaitlist } from './waitlist-catalog.fixture.mjs';

// Real NestJS/guards, Prisma joins and PostgreSQL. Only the verified E2E runner may execute this file.
test('RF-038 institutional search on isolated PostgreSQL', { timeout: 120_000 }, async t => {
  loadApiEnvironment(); assertSafeLocalDatabaseUrl(process.env.DATABASE_URL);
  const [{ AppModule }, { configureApplication }, { PrismaService }, { encodeInstitutionalCursor }] = await Promise.all([
    import('../../dist/app.module.js'), import('../../dist/app.configuration.js'),
    import('../../dist/database/prisma.service.js'), import('../../dist/common/institutional-listing.schemas.js'),
  ]);
  const app = await NestFactory.create(AppModule, { logger: false });
  let prisma, cleanupEnabled = false;
  const ownedPermissions = [], ownedStatuses = [], priorityIds = [], entryIds = [];
  try {
    configureApplication(app); await app.listen(getE2ePort(), '127.0.0.1');
    prisma = app.get(PrismaService);
    await cleanupCheckpointFixtures(prisma); cleanupEnabled = true;
    const base = `http://127.0.0.1:${app.getHttpServer().address().port}/api/v1`;
    const scope = { 'x-institution-id': ids.institutionA };
    async function person(lastNames, firstNames = 'Rfsearch') {
      const id = randomUUID(), sid = randomUUID();
      await prisma.user.create({ data: { id, email: `${FIXTURE_EMAIL_PREFIX}${id}@example.test`,
        firstNames, lastNames, status: 'ACTIVE', phone: 'private-phone', passwordHash: 'unused-fixture-hash' } });
      await prisma.authSession.create({ data: { id: sid, userId: id, refreshTokenHash: 'unused-fixture-refresh-hash', expiresAt: new Date(Date.now() + 300_000) } });
      const token = new JwtService().sign({ sub: id, sid }, { secret: process.env.JWT_ACCESS_SECRET, algorithm: 'HS256', expiresIn: 300 });
      return { id, token };
    }
    const admin = await person('Admin', 'Operator');
    await createCheckpointFixtures(prisma, admin.id);
    await prisma.serviceBranch.create({ data: { serviceId: ids.serviceA, branchId: ids.branchA2 } });
    const officer = await person('Branch', 'Operator'), foreignOfficer = await person('Foreign', 'Operator');
    const a = await person('Alpha'), b = await person('Beta'), unassigned = await person('Unassigned');
    const foreign = await person('Foreign'), orphan = await person('Orphan'), expired = await person('Expired');
    const roleOnly = await person('Role'), deleted = await person('Deleted'), corrupt = await person('Corrupt');
    const wildcard = await person('Literal%_');
    const appointmentOnly = await person('Appointment');
    for (const code of ['users.read', 'waitlist.read']) {
      let permission = await prisma.permission.findUnique({ where: { code } });
      if (!permission) {
        permission = await prisma.permission.create({ data: { id: randomUUID(), code, module: code.split('.')[0], action: 'read' } });
        ownedPermissions.push(permission.id);
      }
      assert.equal(permission.module, code.split('.')[0]); assert.equal(permission.action, 'read');
      await prisma.rolePermission.createMany({ data: [ids.roleInstitution, ids.roleBranch].map(roleId => ({ roleId, permissionId: permission.id })) });
    }
    await prisma.userRole.createMany({ data: [
      { id: randomUUID(), userId: officer.id, roleId: ids.roleBranch, institutionId: ids.institutionA, branchId: ids.branchA1 },
      { id: randomUUID(), userId: foreignOfficer.id, roleId: ids.roleInstitution, institutionId: ids.institutionB },
      { id: randomUUID(), userId: roleOnly.id, roleId: ids.roleBranch, institutionId: null, branchId: ids.branchA2 },
      { id: randomUUID(), userId: expired.id, roleId: ids.roleInstitution, institutionId: ids.institutionA, validTo: new Date('2000-01-01') },
    ] });
    for (const institutionId of [ids.institutionA, ids.institutionB]) {
      await provisionFixtureWaitlist(prisma, institutionId, ownedStatuses);
      priorityIds.push((await prisma.priority.findUniqueOrThrow({ where: { institutionId_code: { institutionId, code: 'STANDARD' } } })).id);
    }
    const active = await prisma.waitlistStatus.findUniqueOrThrow({ where: { code: 'ACTIVE' } });
    const withdrawn = await prisma.waitlistStatus.findUniqueOrThrow({ where: { code: 'WITHDRAWN' } });
    async function wait(userId, extra = {}) {
      const row = await prisma.waitlistEntry.create({ data: { id: randomUUID(), userId,
        institutionId: ids.institutionA, serviceId: ids.serviceA, branchId: ids.branchA1,
        priorityId: priorityIds[0], statusId: active.id, enteredAt: new Date('2026-11-01T12:00:00Z'),
        operationalNote: 'private operational note', ...extra } });
      entryIds.push(row.id); return row;
    }
    const wa = await wait(a.id), wb = await wait(b.id, { branchId: ids.branchA2, statusId: withdrawn.id, allowsOtherBranches: true });
    const wn = await wait(unassigned.id, { branchId: null, allowsOtherBranches: true });
    await prisma.waitlistPreferredBranch.createMany({ data: [wb, wn].map(row => ({
      waitlistEntryId: row.id, branchId: ids.branchA1, preferenceOrder: 1,
    })) });
    const wf = await wait(foreign.id, { institutionId: ids.institutionB, serviceId: ids.serviceB, branchId: ids.branchB1, priorityId: priorityIds[1] });
    await wait(deleted.id); await prisma.user.update({ where: { id: deleted.id }, data: { deletedAt: new Date() } });
    await wait(corrupt.id, { serviceId: ids.serviceB });
    await wait(wildcard.id, { deletedAt: new Date() });
    // Give the literal-name user a coherent role, without making the deleted wait visible.
    await prisma.userRole.create({ data: { id: randomUUID(), userId: wildcard.id, roleId: ids.roleInstitution, institutionId: ids.institutionA } });
    const scheduled = await prisma.appointmentStatus.findUniqueOrThrow({ where: { code: 'AGENDADA' } });
    const slot = await prisma.agendaSlot.findUniqueOrThrow({ where: { id: ids.slotAvailable } });
    await prisma.appointment.create({ data: { id: randomUUID(), userId: appointmentOnly.id, institutionId: ids.institutionA,
      branchId: ids.branchA1, serviceId: ids.serviceA, professionalId: ids.professionalA, agendaSlotId: slot.id,
      statusId: scheduled.id, origin: 'WEB', startsAt: slot.startsAt, endsAt: slot.endsAt } });
    const read = async (resource, query = {}, token = admin.token, headers = scope) => {
      const response = await fetch(`${base}/${resource}?${new URLSearchParams(query)}`, {
        headers: { ...headers, ...(token ? { authorization: `Bearer ${token}` } : {}) }, signal: AbortSignal.timeout(5000),
      });
      return { status: response.status, body: await response.json() };
    };
    const users = (query = {}, ...rest) => read('users/administration', { q: 'Rfsearch', ...query }, ...rest);
    const waits = (query = {}, ...rest) => read('waitlist/administration', query, ...rest);
    const idsOf = result => result.body.data.map(row => row.id);
    const branchScope = { ...scope, 'x-branch-id': ids.branchA1 };

    await t.test('real guards reject unauthenticated, unprivileged, expired grants and wrong context', async () => {
      for (const readListing of [users, waits]) {
        assert.equal((await readListing({}, null)).status, 401);
        assert.equal((await readListing({}, orphan.token)).status, 403);
        assert.equal((await readListing({}, expired.token)).status, 403);
        assert.equal((await readListing({}, officer.token, scope)).status, 403);
        assert.equal((await readListing({}, foreignOfficer.token, scope)).status, 403);
        assert.equal((await readListing({}, admin.token, {})).status, 403);
        assert.equal((await readListing({}, officer.token, { ...scope, 'x-branch-id': ids.branchB1 })).status, 400);
      }
    });
    await t.test('strict queries reject tenant injection, repeated values and invalid limits', async () => {
      for (const readListing of [users, waits]) {
        for (const query of [{ institutionId: ids.institutionB }, { limit: '101' }, { limit: '0' }, { branchId: 'bad' }, { cursor: 'bad!' }]) {
          assert.equal((await readListing(query)).status, 400);
        }
      }
      assert.equal((await users({ email: 'foreign@example.test' })).status, 400);
      const duplicate = await fetch(`${base}/users/administration?q=Alpha&q=Foreign`, { headers: { ...scope, authorization: `Bearer ${admin.token}` } });
      assert.equal(duplicate.status, 400);
    });
    await t.test('users include coherent appointments/waits/roles, exclude foreign/orphan/deleted/expired/incoherent', async () => {
      const response = await users(); assert.equal(response.status, 200);
      assert.deepEqual(idsOf(response), [a.id, b.id, unassigned.id, roleOnly.id, wildcard.id, appointmentOnly.id].sort());
      const all = await read('users/administration');
      assert.ok(idsOf(all).includes(ids.professionalA2User));
      assert.ok(!idsOf(all).includes(ids.professionalBUser));
      assert.deepEqual(idsOf(await users({}, foreignOfficer.token, { 'x-institution-id': ids.institutionB })), [foreign.id]);
    });
    await t.test('branch searches exclude other branches and branchless entries even with preferences', async () => {
      assert.deepEqual(idsOf(await users({}, officer.token, branchScope)), [a.id, appointmentOnly.id].sort());
      assert.deepEqual(idsOf(await waits({}, officer.token, branchScope)), [wa.id]);
      for (const readListing of [users, waits]) {
        assert.equal((await readListing({ branchId: ids.branchA2 }, officer.token, branchScope)).status, 404);
        assert.equal((await readListing({ branchId: ids.branchB1 })).status, 404);
      }
      assert.deepEqual(idsOf(await users({ branchId: ids.branchA2 })), [b.id, roleOnly.id].sort());
    });
    await t.test('name terms are case-insensitive literal text and cannot widen tenant visibility', async () => {
      assert.deepEqual(idsOf(await users({ q: 'rfSEARCH alpha' })), [a.id]);
      assert.deepEqual(idsOf(await users({ q: '%_' })), [wildcard.id]);
      assert.deepEqual(idsOf(await users({ q: 'Foreign' })), []);
    });
    await t.test('waitlist catalog status, service, user and branch filters compose without user enumeration', async () => {
      assert.deepEqual(idsOf(await waits({ status: 'WITHDRAWN', serviceId: ids.serviceA, userId: b.id, branchId: ids.branchA2 })), [wb.id]);
      assert.deepEqual(idsOf(await waits({ status: 'UNKNOWN' })), []);
      assert.deepEqual(idsOf(await waits({ userId: foreign.id })), []);
      assert.deepEqual(idsOf(await waits({ userId: randomUUID() })), []);
      assert.equal((await waits({ serviceId: ids.serviceB })).status, 404);
      assert.deepEqual(idsOf(await waits()).sort(), [wa.id, wb.id, wn.id].sort());
    });
    await t.test('permissions are independent; GLOBAL still requires an explicit institution', async () => {
      const userPermission = await prisma.permission.findUniqueOrThrow({ where: { code: 'users.read' } });
      const waitPermission = await prisma.permission.findUniqueOrThrow({ where: { code: 'waitlist.read' } });
      await prisma.rolePermission.delete({ where: { roleId_permissionId: { roleId: ids.roleBranch, permissionId: waitPermission.id } } });
      try {
        assert.equal((await users({}, officer.token, branchScope)).status, 200);
        assert.equal((await waits({}, officer.token, branchScope)).status, 403);
      } finally {
        await prisma.rolePermission.create({ data: { roleId: ids.roleBranch, permissionId: waitPermission.id } });
      }
      await prisma.rolePermission.create({ data: { roleId: ids.roleGlobal, permissionId: userPermission.id } });
      try {
        assert.equal((await users({}, admin.token, {})).status, 400);
        assert.deepEqual(idsOf(await users({}, admin.token, { 'x-institution-id': ids.institutionB })), [foreign.id]);
      } finally {
        await prisma.rolePermission.delete({ where: { roleId_permissionId: { roleId: ids.roleGlobal, permissionId: userPermission.id } } });
      }
    });
    await t.test('stable cursor pagination has no duplicates with tied timestamps', async () => {
      for (const [resource, readListing, expected] of [
        ['users', users, [a.id, b.id, unassigned.id, roleOnly.id, wildcard.id, appointmentOnly.id].sort()],
        ['waitlist', waits, [wa.id, wb.id, wn.id].sort().reverse()],
      ]) {
        let cursor; const seen = [];
        do {
          const response = await readListing({ limit: '1', ...(cursor ? { cursor } : {}) });
          assert.equal(response.status, 200); assert.equal(response.body.data.length, 1);
          seen.push(...idsOf(response)); cursor = response.body.page.nextCursor;
          assert.ok(seen.length <= expected.length);
        } while (cursor);
        assert.deepEqual(seen, expected);
        const foreignCursor = encodeInstitutionalCursor(resource, resource === 'users' ? foreign.id : wf.id);
        assert.equal((await readListing({ cursor: foreignCursor })).status, 404);
        assert.equal((await readListing({ cursor: encodeInstitutionalCursor(resource, randomUUID()) })).status, 404);
      }
      assert.equal((await users({ q: 'Alpha', cursor: encodeInstitutionalCursor('users', b.id) })).status, 404);
      assert.equal((await waits({ status: 'ACTIVE', cursor: encodeInstitutionalCursor('waitlist', wb.id) })).status, 404);
      assert.equal((await waits({ cursor: encodeInstitutionalCursor('waitlist', wn.id) }, officer.token, branchScope)).status, 404);
    });
    await t.test('minimal DTOs exclude credentials, contacts, observations and ranking internals', async () => {
      const userRows = await users(), waitRows = await waits();
      for (const row of userRows.body.data) assert.deepEqual(Object.keys(row).sort(), ['firstNames', 'id', 'lastNames']);
      for (const row of waitRows.body.data) {
        assert.deepEqual(Object.keys(row).sort(), ['branch', 'enteredAt', 'id', 'service', 'status', 'user']);
        assert.deepEqual(Object.keys(row.user).sort(), ['firstNames', 'id', 'lastNames']);
      }
      assert.equal(waitRows.body.data.find(row => row.id === wn.id).branch, null);
      const text = JSON.stringify([userRows.body, waitRows.body]);
      for (const secret of ['private-phone', 'private operational note', 'unused-fixture', '@example.test']) assert.ok(!text.includes(secret));
    });
    await t.test('new GETs do not mutate domain, sessions, timestamps or audit', async () => {
      const snapshot = async () => ({
        users: await prisma.user.findMany({ where: { email: { startsWith: FIXTURE_EMAIL_PREFIX } }, orderBy: { id: 'asc' } }),
        entries: await prisma.waitlistEntry.findMany({ where: { id: { in: entryIds } }, orderBy: { id: 'asc' } }),
        slots: await prisma.agendaSlot.findMany({ where: { availability: { branch: { institutionId: ids.institutionA } } }, orderBy: { id: 'asc' } }),
        appointments: await prisma.appointment.findMany({ where: { institutionId: ids.institutionA }, orderBy: { id: 'asc' } }),
        sessions: await prisma.authSession.findMany({ where: { user: { email: { startsWith: FIXTURE_EMAIL_PREFIX } } }, orderBy: { id: 'asc' } }),
        history: await prisma.appointmentHistory.count(), offers: await prisma.appointmentOffer.count(),
        reassignments: await prisma.reassignment.count(), audit: await prisma.auditEvent.count(),
      });
      const before = await snapshot(); await users(); await waits(); await waits({ status: 'WITHDRAWN' });
      assert.deepEqual(await snapshot(), before);
    });
    await t.test('own users and waitlist routes retain authentication and existing contracts', async () => {
      assert.equal((await read('users/me', {}, a.token, {})).status, 200);
      const mine = await read('waitlist', {}, a.token, {});
      assert.equal(mine.status, 200); assert.deepEqual(idsOf(mine), [wa.id]);
      assert.equal((await read('waitlist', { status: 'ACTIVE' }, a.token, {})).status, 400);
      assert.equal((await read(`waitlist/${wa.id}/preferences`, {}, a.token, {})).status, 200);
      assert.equal((await read(`waitlist/${wa.id}/preferences`, {}, foreign.token, {})).status, 404);
    });
  } finally {
    try {
      if (prisma && cleanupEnabled) {
        await assertE2EFixtureDatabase(prisma);
        await prisma.waitlistPreferredBranch.deleteMany({ where: {
          waitlistEntryId: { in: entryIds },
          waitlistEntry: { user: { email: { startsWith: FIXTURE_EMAIL_PREFIX } } },
        } });
        await prisma.waitlistEntry.deleteMany({ where: { id: { in: entryIds }, user: { email: { startsWith: FIXTURE_EMAIL_PREFIX } } } });
        await prisma.priority.deleteMany({ where: { id: { in: priorityIds }, institutionId: { in: [ids.institutionA, ids.institutionB] } } });
        await cleanupCheckpointFixtures(prisma);
        await prisma.permission.deleteMany({ where: { id: { in: ownedPermissions } } });
        await prisma.waitlistStatus.deleteMany({ where: { id: { in: ownedStatuses } } });
        await assertCheckpointIsClean(prisma);
        assert.equal(await prisma.waitlistEntry.count({ where: { id: { in: entryIds } } }), 0);
      }
    } finally { await app.close(); }
  }
});
