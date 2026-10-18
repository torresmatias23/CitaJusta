import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { NestFactory } from '@nestjs/core';
import { loadApiEnvironment, getE2ePort } from './local-environment.mjs';
import { assertE2EFixtureDatabase } from '../../scripts/e2e-docker-environment.mjs';

test('RF005 global institution administration, real PostgreSQL isolation and provisioning', { timeout: 120_000 }, async t => {
  loadApiEnvironment();
  const [{ AppModule }, { configureApplication }, { PrismaService }, provision] = await Promise.all([
    import('../../dist/app.module.js'), import('../../dist/app.configuration.js'), import('../../dist/database/prisma.service.js'),
    import('../../dist/database/institution-administrator.js'),
  ]);
  const app = await NestFactory.create(AppModule, { logger: false });
  const namespace = `E2E_RF005_${randomUUID()}`, emails = `e2e_rf005+${randomUUID()}-`;
  const users = [], institutions = [], roles = [], permissions = [];
  let prisma, roleOwned = false;
  try {
    prisma = app.get(PrismaService);
    await assertE2EFixtureDatabase(prisma);
    // Fixed provisioning identity is never reused/deleted if it was already present.
    assert.equal(await prisma.role.count({ where: { OR: [{ id: provision.institutionAdministratorRole.id }, { code: provision.institutionAdministratorRole.code }] } }), 0,
      'Dedicated RF005 role already exists; inspect ownership before running this fixture');
    configureApplication(app); await app.listen(getE2ePort(), '127.0.0.1');
    const url = `http://127.0.0.1:${app.getHttpServer().address().port}/api/v1`;
    async function request(method, path, token, body, headers = {}) {
      const response = await fetch(`${url}${path}`, { method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
      return { status: response.status, body: await response.json() };
    }
    async function account(label) {
      const credentials = { email: `${emails}${label}@example.test`, password: `E2e-${randomUUID()}-Aa1!`, firstName: 'RF005', lastName: label };
      const registered = await request('POST', '/auth/register', undefined, credentials); assert.equal(registered.status, 201);
      users.push(registered.body.id);
      const login = await request('POST', '/auth/login', undefined, { email: credentials.email, password: credentials.password }); assert.equal(login.status, 200);
      return { id: registered.body.id, email: credentials.email, token: login.body.accessToken };
    }
    const admin = await account('admin'), ordinary = await account('ordinary'), institutional = await account('institutional'), mixed = await account('mixed');
    const before = await prisma.permission.findMany({ where: { module: 'institutions' }, select: { id: true } });
    await prisma.$transaction(tx => provision.provisionInstitutionAdministrator(tx, { email: admin.email, userId: admin.id }), { isolationLevel: 'Serializable' });
    roleOwned = true;
    roles.push(provision.institutionAdministratorRole.id);
    const allPermissions = await prisma.permission.findMany({ where: { module: 'institutions' } });
    permissions.push(...allPermissions.filter(p => !before.some(row => row.id === p.id)).map(p => p.id));
    const firstInstitution = randomUUID(); institutions.push(firstInstitution);
    await prisma.institution.create({ data: { id: firstInstitution, name: namespace } });
    for (const scope of ['INSTITUTION', 'GLOBAL']) {
      const roleId = randomUUID(); roles.push(roleId);
      await prisma.role.create({ data: { id: roleId, code: `${namespace}_${scope}`, name: namespace, scope } });
      if (scope === 'INSTITUTION') {
        await prisma.rolePermission.createMany({ data: allPermissions.map(p => ({ roleId, permissionId: p.id })) });
        await prisma.userRole.createMany({ data: [institutional, mixed].map(user => ({ id: randomUUID(), userId: user.id, roleId, institutionId: firstInstitution })) });
      } else await prisma.userRole.create({ data: { id: randomUUID(), userId: mixed.id, roleId } });
    }
    const body = suffix => ({ name: `${namespace}_${suffix}`, legalName: 'RF005 Test', taxIdentifier: `RF005-${randomUUID().slice(0, 20)}` });
    const create = async input => {
      const result = await request('POST', '/institutions', admin.token, input);
      if (result.status === 201) institutions.push(result.body.data.id);
      return result;
    };

    await t.test('provision persists, is idempotent, audited once and preserves user credentials', async () => {
      const user = await prisma.user.findUnique({ where: { id: admin.id } });
      const grant = await prisma.userRole.findFirst({ where: { userId: admin.id, roleId: provision.institutionAdministratorRole.id } });
      const events = await prisma.auditEvent.count({ where: { resourceId: grant.id, actionCode: 'INSTITUTION_ADMINISTRATOR_PROVISIONED' } });
      assert.equal(events, 1); assert.equal(grant.institutionId, null); assert.equal(grant.branchId, null);
      const result = await prisma.$transaction(tx => provision.provisionInstitutionAdministrator(tx, { email: admin.email, userId: admin.id }), { isolationLevel: 'Serializable' });
      assert.equal(result.changed, false);
      assert.deepEqual(await prisma.user.findUnique({ where: { id: admin.id } }), user);
      assert.equal(await prisma.auditEvent.count({ where: { resourceId: grant.id, actionCode: 'INSTITUTION_ADMINISTRATOR_PROVISIONED' } }), events);
      const me = await request('GET', '/users/me', admin.token);
      assert.deepEqual(me.body.data.permissions, ['institutions.create','institutions.read','institutions.update']);
      assert.deepEqual(me.body.data.context, {});
    });
    await t.test('public registration rejects GLOBAL/role input', async () => {
      const result = await request('POST', '/auth/register', undefined, { email: `${emails}forged@example.test`, password: 'E2e-test-password-123', firstName: 'A', lastName: 'B', scope: 'GLOBAL', roles: ['INSTITUTION_PLATFORM_ADMINISTRATOR'] });
      assert.equal(result.status, 400);
    });
    await t.test('unauthenticated, ordinary, institutional and GLOBAL-without-permission cannot write/read administration', async () => {
      for (const token of [undefined, ordinary.token, institutional.token, mixed.token]) {
        const expected = token ? 403 : 401;
        assert.equal((await request('POST', '/institutions', token, body('denied'))).status, expected);
        assert.equal((await request('PATCH', `/institutions/${firstInstitution}`, token, { name: 'Denied' })).status, expected);
        assert.equal((await request('GET', '/institutions/administration', token)).status, expected);
      }
    });
    await t.test('institutional permissions cannot be combined with unrelated GLOBAL role or forged headers', async () => {
      for (const user of [institutional, mixed]) {
        const headers = { 'x-institution-id': firstInstitution, 'x-user-id': admin.id, 'x-role': 'GLOBAL' };
        assert.equal((await request('POST', '/institutions', user.token, body('forged'), headers)).status, 403);
        assert.equal((await request('PATCH', `/institutions/${firstInstitution}`, user.token, { name: 'Forged' }, headers)).status, 403);
      }
      assert.equal((await request('POST', '/institutions', admin.token, body('scoped'), { 'x-institution-id': firstInstitution })).status, 403);
    });
    await t.test('strict DTO rejects identity, grants, states, invalid zone, query and empty PATCH', async () => {
      for (const extra of [{ userId: ordinary.id }, { role: 'GLOBAL' }, { institutionId: firstInstitution }, { status: 'INACTIVE' }, { timeZone: 'Invalid/Zone' }]) {
        assert.equal((await create({ ...body('invalid'), ...extra })).status, 400);
      }
      assert.equal((await request('POST', '/institutions?userId=x', admin.token, body('query'))).status, 400);
      assert.equal((await request('PATCH', `/institutions/${firstInstitution}`, admin.token, {})).status, 400);
      assert.equal((await request('PATCH', `/institutions/${firstInstitution}`, admin.token, { timeZone: 'UTC' })).status, 400);
    });
    await t.test('authorized create/update expose only allowlisted fields and audit authenticated actor', async () => {
      const result = await create(body('created')); assert.equal(result.status, 201);
      const row = result.body.data;
      assert.deepEqual(Object.keys(row).sort(), ['id','name','legalName','taxIdentifier','contactEmail','phone','timeZone','status','createdAt','updatedAt'].sort());
      assert.equal(row.status, 'ACTIVE'); assert.equal(row.timeZone, 'America/Santiago'); assert.match(row.createdAt, /Z$/);
      const updated = await request('PATCH', `/institutions/${row.id}`, admin.token, { name: `${namespace}_updated`, contactEmail: 'TEST@EXAMPLE.TEST' });
      assert.equal(updated.status, 200); assert.equal(updated.body.data.contactEmail, 'test@example.test');
      const events = await prisma.auditEvent.findMany({ where: { institutionId: row.id }, orderBy: { occurredAt: 'asc' } });
      assert.deepEqual(events.map(event => event.actionCode), ['INSTITUTION_CREATED','INSTITUTION_UPDATED']);
      assert.ok(events.every(event => event.actorUserId === admin.id));
    });
    await t.test('sequential and concurrent duplicate tax identifier produce controlled conflict and one institution', async () => {
      const input = body('concurrent'); const results = await Promise.all([create(input), create(input)]);
      assert.deepEqual(results.map(row => row.status).sort(), [201, 409]);
      assert.equal(await prisma.institution.count({ where: { taxIdentifier: input.taxIdentifier } }), 1);
      assert.equal((await create(input)).status, 409);
    });
    await t.test('read capabilities require permission in GLOBAL role, not GLOBAL alone', async () => {
      const grant = await prisma.userRole.findFirst({ where: { userId: mixed.id, role: { scope: 'GLOBAL' } } });
      const read = allPermissions.find(p => p.code === 'institutions.read');
      await prisma.rolePermission.create({ data: { roleId: grant.roleId, permissionId: read.id } });
      const result = await request('GET', '/institutions/administration', mixed.token);
      assert.equal(result.status, 200); assert.deepEqual(result.body.permissions, { create: false, update: false });
      assert.equal((await request('POST', '/institutions', mixed.token, body('read-only'))).status, 403);
    });
    await t.test('cross-tenant institutional edits denied; missing/deleted targets 404 without revealing internals', async () => {
      const foreign = await create(body('foreign')); assert.equal(foreign.status, 201);
      assert.equal((await request('PATCH', `/institutions/${foreign.body.data.id}`, institutional.token, { name: 'Denied' }, { 'x-institution-id': firstInstitution })).status, 403);
      assert.equal((await request('PATCH', `/institutions/${randomUUID()}`, admin.token, { name: 'Missing' })).status, 404);
      await prisma.institution.update({ where: { id: foreign.body.data.id }, data: { deletedAt: new Date() } });
      assert.equal((await request('PATCH', `/institutions/${foreign.body.data.id}`, admin.token, { name: 'Deleted' })).status, 404);
      assert.ok(!(await request('GET', '/institutions/administration', admin.token)).body.data.some(row => row.id === foreign.body.data.id));
    });
    await t.test('real audit insert failure rolls back create and update with sanitized errors', async () => {
      const original = prisma.$transaction.bind(prisma);
      prisma.$transaction = (work, options) => original(async tx => {
        const insert = tx.auditEvent.create.bind(tx.auditEvent);
        tx.auditEvent.create = async args => { const result = await insert(args); if (args.data.actionCode.startsWith('INSTITUTION_')) throw new Error('PRIVATE_SQL_TOKEN'); return result; };
        return work(tx);
      }, options);
      try {
        const failed = await create(body('rollback')); assert.equal(failed.status, 500); assert.ok(!JSON.stringify(failed.body).includes('PRIVATE'));
        assert.equal(await prisma.institution.count({ where: { name: `${namespace}_rollback` } }), 0);
        assert.equal((await request('PATCH', `/institutions/${firstInstitution}`, admin.token, { name: 'Rollback update' })).status, 500);
        assert.equal((await prisma.institution.findUnique({ where: { id: firstInstitution } })).name, namespace);
      } finally { prisma.$transaction = original; }
    });
    await t.test('public catalog GET contracts remain authenticated and unchanged; administrative role does not grant other modules', async () => {
      const catalog = await request('GET', '/institutions', ordinary.token); assert.equal(catalog.status, 200);
      assert.deepEqual(Object.keys(catalog.body.data.find(row => row.id === firstInstitution)).sort(), ['id','name','timeZone']);
      const detail = await request('GET', `/institutions/${firstInstitution}`, ordinary.token); assert.equal(detail.status, 200);
      assert.equal((await request('GET', `/institutions/${firstInstitution}/branches`, ordinary.token)).status, 200);
      assert.equal((await request('GET', '/institutions')).status, 401);
      assert.equal((await request('GET', '/agenda', admin.token, undefined, { 'x-institution-id': firstInstitution })).status, 403);
    });
  } finally {
    try {
    if (prisma) {
      await assertE2EFixtureDatabase(prisma);
      const owned = await prisma.institution.findMany({ where: { id: { in: institutions } }, select: { id: true, name: true } });
      assert.ok(owned.every(row => row.name.startsWith(namespace)), 'Fixture ownership mismatch; cleanup stopped');
      const ownedUsers = await prisma.user.findMany({ where: { id: { in: users } }, select: { id: true, email: true } });
      assert.ok(ownedUsers.every(row => row.email.startsWith(emails)), 'User fixture ownership mismatch; cleanup stopped');
      const ownedGrants = await prisma.userRole.findMany({ where: { roleId: { in: roles } }, select: { userId: true } });
      assert.ok(ownedGrants.every(row => users.includes(row.userId)), 'Foreign grant found; cleanup stopped');
      await prisma.auditEvent.deleteMany({ where: { OR: [{ institutionId: { in: institutions } }, { actorUserId: { in: users } },
        ...(roleOwned ? [{ actionCode: 'INSTITUTION_ADMINISTRATOR_PROVISIONED', resourceId: { in: (await prisma.userRole.findMany({ where: { userId: { in: users }, roleId: provision.institutionAdministratorRole.id }, select: { id: true } })).map(row => row.id) } }] : [])] } });
      await prisma.userRole.deleteMany({ where: { userId: { in: users }, roleId: { in: roles } } });
      await prisma.rolePermission.deleteMany({ where: { roleId: { in: roles } } });
      await prisma.role.deleteMany({ where: { id: { in: roles } } });
      await prisma.permission.deleteMany({ where: { id: { in: permissions }, roles: { none: {} } } });
      await prisma.authSession.deleteMany({ where: { userId: { in: users } } });
      await prisma.user.deleteMany({ where: { id: { in: users }, email: { startsWith: emails } } });
      await prisma.institution.deleteMany({ where: { id: { in: institutions } } });
      assert.equal(await prisma.institution.count({ where: { id: { in: institutions } } }), 0);
      assert.equal(await prisma.user.count({ where: { email: { startsWith: emails } } }), 0);
      assert.equal(await prisma.role.count({ where: { id: { in: roles } } }), 0);
    }
    } finally { await app.close(); }
  }
});
