import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { demoAgendaReaderPermissions, demoAgendaReaderRole, demoInstitutionalReaderPermissions, demoInstitutionalReaderRole, demoOperatorPermissions, demoOperatorRole, provisionDockerDemoAdministrator } from '../dist/database/docker-demo-administrator.js';
import { AuthorizationService } from '../dist/authorization/authorization.service.js';
import { institutionAdministratorRole } from '../dist/database/institution-administrator.js';
import { runDockerDemoProvision, reportDemoProvisionFailure } from '../scripts/provision-docker-demo.mjs';
import { prepareDockerDatabase } from '../../../docker/api/migrate.mjs';

const userId = randomUUID(), institutionId = randomUUID();
const password = 'a'.repeat(64);
const environment = { NODE_ENV: 'development', CITAJUSTA_DOCKER: 'development',
  DATABASE_URL: `postgresql://citajusta:${password}@db:5432/citajusta_docker?schema=public`,
  DEMO_ADMIN_EMAIL: 'operator@example.test', DEMO_ADMIN_USER_ID: userId };
const migrations = [{ name: '001_base', checksum: 'fixture-checksum' }];
const confirmation = mode => `citajusta_docker:${mode}:${userId}${mode !== 'platform' ? `:${institutionId}` : ''}`;
const collections = ['roles', 'permissions', 'links', 'grants', 'events'];
function fixture(mode = 'institution') {
  const identity = { database: 'citajusta_docker', username: 'citajusta', version: 180000, marker: 'citajusta-capstone-docker-v1' };
  const state = { roles: [], permissions: [], links: [], grants: [], events: [], identity, preflightIdentity: { ...identity },
    user: { id: userId, email: environment.DEMO_ADMIN_EMAIL, status: 'ACTIVE', deletedAt: null, passwordHash: 'UNTOUCHED' },
    institution: { id: institutionId, status: 'ACTIVE', deletedAt: null }, locked: true,
    appointments: [{ id: randomUUID(), institutionId, status: 'AGENDADA', attendanceConfirmed: true }],
    queries: [], transactions: 0, userReads: 0, institutionReads: 0, createdClients: 0, disconnected: 0,
    preflightConnected: 0, preflightClosed: 0, failAt: null, commitError: null, conflicts: 0, afterConflict: null, pending: false, logs: [] };
  const matches = (row, where) => Object.entries(where).every(([key, value]) => row[key] === value);
  const many = collection => async ({ where }) => state[collection].filter(row => where.OR ? where.OR.some(part => matches(row, part)) : matches(row, where));
  const create = collection => async ({ data }) => {
    state[collection].push({ ...data });
    if (state.failAt === collection) throw new Error('PRIVATE SQL password token');
    return { ...data };
  };
  const tx = {
    $queryRaw: async strings => {
      const sql = strings.join('?'); state.queries.push(sql);
      if (sql.includes('FROM pg_database')) return state.identity ? [state.identity] : [];
      assert.match(sql, /pg_try_advisory_xact_lock\(186, 1\)/); return [{ acquired: state.locked }];
    },
    user: { findUnique: async ({ where, select }) => {
      state.userReads++; assert.deepEqual(select, { id: true, status: true, deletedAt: true });
      return state.user?.email === where.email ? state.user : null;
    } },
    institution: { findUnique: async ({ where }) => { state.institutionReads++; return state.institution?.id === where.id ? state.institution : null; } },
    role: { findMany: many('roles'), create: create('roles') },
    permission: { findMany: many('permissions'), create: create('permissions') },
    userRole: { findMany: many('grants'), create: create('grants') },
    rolePermission: { findMany: async ({ where }) => state.links.filter(link => link.roleId === where.roleId)
      .map(link => ({ ...link, permission: state.permissions.find(p => p.id === link.permissionId) })), create: create('links') },
    auditEvent: { create: create('events') },
  };
  const prisma = {
    $transaction: async (work, config) => {
      assert.deepEqual(config, { isolationLevel: 'Serializable', maxWait: 5000, timeout: 15000 }); state.transactions++;
      const before = Object.fromEntries(collections.map(key => [key, structuredClone(state[key])]));
      try {
        const result = await work(tx);
        if (state.commitError) throw state.commitError;
        if (state.conflicts > 0) { state.conflicts--; throw { code: 'P2034' }; }
        return result;
      } catch (error) {
        for (const key of collections) state[key] = before[key];
        if (error.code === 'P2034') state.afterConflict?.();
        throw error;
      }
    },
    $disconnect: async () => { state.disconnected++; },
  };
  const request = { mode, email: environment.DEMO_ADMIN_EMAIL, userId, confirmation: confirmation(mode),
    ...(mode !== 'platform' ? { institutionId } : {}) };
  const dependencies = {
    verify: (env, options) => {
      assert.deepEqual(options, { deploy: false });
      return prepareDockerDatabase(env, { ...options, manifest: async () => state.pending
        ? [...migrations, { name: '002_pending', checksum: 'pending-checksum' }] : migrations,
        client: () => ({ connect: async () => { state.preflightConnected++; }, end: async () => { state.preflightClosed++; },
          query: async sql => {
            assert.match(sql, /^(SELECT|BEGIN READ ONLY|ROLLBACK)/);
            if (sql.includes('FROM pg_database')) return { rows: state.preflightIdentity ? [state.preflightIdentity] : [] };
            if (sql.includes('pg_tables')) return { rows: [{ tablename: '_prisma_migrations' }, { tablename: 'usuarios' }] };
            if (sql.includes('SELECT migration_name')) return { rows: [{ migration_name: '001_base', checksum: 'fixture-checksum', finished_at: new Date(), rolled_back_at: null }] };
            return { rows: [] };
          } }),
        run: () => { assert.fail('Administrative provisioning must never execute migrations or subprocesses'); },
      });
    },
    createPrisma: url => { assert.equal(url, environment.DATABASE_URL); state.createdClients++; return prisma; },
    log: value => state.logs.push(value),
  };
  const run = (patch = {}, args = [mode]) => runDockerDemoProvision(args, { ...environment,
    DEMO_PROVISION_CONFIRM: request.confirmation, ...(mode !== 'platform' ? { DEMO_INSTITUTION_ID: institutionId } : {}), ...patch }, dependencies);
  return { state, run, transaction: patch => provisionDockerDemoAdministrator(prisma, { ...request, ...patch }) };
}
const snapshot = state => structuredClone(Object.fromEntries([...collections, 'user', 'institution', 'appointments'].map(key => [key, state[key]])));
const empty = state => { for (const key of collections) assert.deepEqual(state[key], []); };

test('platform reuses existing primitive: exactly three GLOBAL rights, audit and no credential changes', async () => {
  const f = fixture('platform'), user = structuredClone(f.state.user);
  await f.run();
  assert.deepEqual(f.state.roles, [institutionAdministratorRole]);
  assert.deepEqual(f.state.permissions.map(p => p.code), ['institutions.read', 'institutions.create', 'institutions.update']);
  assert.equal(f.state.grants[0].institutionId, null); assert.equal(f.state.grants[0].branchId, null);
  assert.equal(f.state.grants[0].userId, userId);
  assert.equal(f.state.events[0].actionCode, 'INSTITUTION_ADMINISTRATOR_PROVISIONED');
  assert.equal(f.state.events[0].resourceId, f.state.grants[0].id); assert.equal(f.state.events[0].actorType, 'SYSTEM');
  assert.deepEqual(f.state.user, user); assert.equal(f.state.institutionReads, 0);
});
test('institution provisions exactly eight read/create rights, institution-only scope and audit', async () => {
  const f = fixture(), before = structuredClone(f.state.user); await f.run();
  assert.deepEqual(f.state.roles, [demoOperatorRole]);
  assert.equal(f.state.roles[0].isSystem, false);
  assert.deepEqual([...demoOperatorPermissions], ['branches.read', 'branches.create', 'services.read', 'services.create',
    'professionals.read', 'professionals.create', 'availability.read', 'availability.create']);
  assert.deepEqual(f.state.permissions.map(p => p.code), [...demoOperatorPermissions]);
  assert.equal(f.state.links.length, 8); assert.equal(f.state.grants.length, 1);
  assert.equal(f.state.grants[0].institutionId, institutionId); assert.equal(f.state.grants[0].branchId, null);
  assert.equal(f.state.grants[0].userId, userId); assert.equal(f.state.roles[0].scope, 'INSTITUTION');
  assert.equal(f.state.events.length, 1); assert.equal(f.state.events[0].actionCode, 'INSTITUTION_ADMINISTRATOR_PROVISIONED');
  assert.equal(f.state.events[0].institutionId, institutionId); assert.equal(f.state.events[0].resourceType, 'USER_ROLE');
  assert.equal(f.state.events[0].resourceId, f.state.grants[0].id); assert.equal(f.state.events[0].actorType, 'SYSTEM');
  assert.deepEqual(f.state.user, before);
});
test('operator rejects an existing system role without repairing it or changing other records', async () => {
  const f = fixture(); await f.run();
  f.state.roles[0].isSystem = true;
  const before = snapshot(f.state);
  await assert.rejects(f.run(), /incompatible; no se sobrescribe/);
  assert.deepEqual(snapshot(f.state), before);
  assert.equal(f.state.roles[0].isSystem, true);
});
for (const mode of ['platform', 'institution', 'agenda-reader', 'institutional-reader']) {
  test(`${mode}: second run is a strict no-op, including audit`, async () => {
    const f = fixture(mode); assert.equal((await f.run()).changed, true); const before = snapshot(f.state);
    assert.equal(f.state.events[0].actionCode, mode === 'institutional-reader' ? 'INSTITUTIONAL_READER_PROVISIONED'
      : mode === 'agenda-reader' ? 'AGENDA_READER_PROVISIONED' : 'INSTITUTION_ADMINISTRATOR_PROVISIONED');
    assert.equal((await f.run()).changed, false); assert.deepEqual(snapshot(f.state), before);
  });
  test(`${mode}: preserves existing credentials, roles, permissions and unrelated grants`, async () => {
    const f = fixture(mode);
    const role = { id: randomUUID(), code: 'EXTERNAL_ROLE', scope: 'INSTITUTION' };
    const permission = { id: randomUUID(), code: 'external.read', module: 'external', action: 'read' };
    const link = { roleId: role.id, permissionId: permission.id };
    const grant = { id: randomUUID(), userId, roleId: role.id, institutionId: randomUUID(), branchId: null };
    f.state.roles.push(role); f.state.permissions.push(permission); f.state.links.push(link); f.state.grants.push(grant);
    const user = structuredClone(f.state.user); await f.run();
    assert.deepEqual(f.state.roles[0], role); assert.deepEqual(f.state.permissions[0], permission);
    assert.deepEqual(f.state.links[0], link); assert.deepEqual(f.state.grants[0], grant); assert.deepEqual(f.state.user, user);
  });
  test(`${mode}: missing/mismatched/inactive/deleted accounts cannot receive rights`, async () => {
    for (const patch of [null, { id: randomUUID() }, { email: 'different@example.test' }, { status: 'PENDING' }, { status: 'INACTIVE' }, { deletedAt: new Date() }]) {
      const f = fixture(mode); f.state.user = patch === null ? null : { ...f.state.user, ...patch };
      await assert.rejects(f.run(), /cuenta|account/i); empty(f.state); assert.equal(f.state.disconnected, 1);
    }
  });
  test(`${mode}: audit failure rolls back all RBAC writes`, async () => {
    const f = fixture(mode); f.state.failAt = 'events'; const before = snapshot(f.state);
    await assert.rejects(f.run(), /PRIVATE SQL/); assert.deepEqual(snapshot(f.state), before);
  });
  test(`${mode}: first intermediate write failure rolls back without touching users`, async () => {
    const f = fixture(mode); f.state.failAt = 'links'; const before = snapshot(f.state);
    await assert.rejects(f.run(), /PRIVATE SQL/); assert.deepEqual(snapshot(f.state), before);
  });
  test(`${mode}: serializable conflict retries complete checks once, never duplicates audit`, async () => {
    const f = fixture(mode); f.state.conflicts = 1; await f.run();
    assert.equal(f.state.transactions, 2); assert.equal(f.state.userReads, 2);
    assert.equal(f.state.events.length, 1); assert.equal(f.state.grants.length, 1);
  });
  test(`${mode}: retry rechecks account eligibility rather than reusing prior authorization`, async () => {
    const f = fixture(mode); f.state.conflicts = 1; f.state.afterConflict = () => { f.state.user.status = 'INACTIVE'; };
    await assert.rejects(f.run(), /cuenta|account/i); assert.equal(f.state.userReads, 2); empty(f.state);
  });
}
test('rejects DEV, E2E, production, foreign hosts/ports/users and URL overrides before connecting', async () => {
  for (const patch of [
    { NODE_ENV: 'production' }, { NODE_ENV: 'test' }, { NODE_ENV: undefined }, { CITAJUSTA_DOCKER: undefined },
    ...['citajusta_dev', 'citajusta_e2e', 'production'].map(db => ({ DATABASE_URL: environment.DATABASE_URL.replace('citajusta_docker', db) })),
    ...['localhost', '127.0.0.1', 'host.docker.internal', 'remote.example'].map(host => ({ DATABASE_URL: environment.DATABASE_URL.replace('@db:', `@${host}:`) })),
    { DATABASE_URL: environment.DATABASE_URL.replace(':5432/', ':15432/') },
    { DATABASE_URL: environment.DATABASE_URL.replace('//citajusta:', '//postgres:') },
    { DATABASE_URL: `${environment.DATABASE_URL}&host=remote` }, { DATABASE_URL: `${environment.DATABASE_URL}#private` },
    { DATABASE_URL: undefined },
  ]) {
    const f = fixture(); await assert.rejects(f.run(patch));
    assert.equal(f.state.preflightConnected, 0); assert.equal(f.state.createdClients, 0); empty(f.state);
  }
});
test('requires action/account/institution-bound confirmation and valid identity before connecting', async () => {
  for (const patch of [{ DEMO_PROVISION_CONFIRM: undefined }, { DEMO_PROVISION_CONFIRM: 'yes' },
    { DEMO_PROVISION_CONFIRM: confirmation('platform') }, { DEMO_ADMIN_USER_ID: randomUUID() },
    { DEMO_INSTITUTION_ID: randomUUID() }, { DEMO_INSTITUTION_ID: undefined },
    { DEMO_ADMIN_EMAIL: 'bad-email' }, { DEMO_ADMIN_USER_ID: 'invalid' }]) {
    const f = fixture(); await assert.rejects(f.run(patch)); assert.equal(f.state.preflightConnected, 0); assert.equal(f.state.createdClients, 0);
  }
  const f = fixture('platform'); await assert.rejects(f.run({ DEMO_INSTITUTION_ID: institutionId }));
  for (const args of [[], ['unknown'], ['platform', 'extra']]) await assert.rejects(f.run({}, args));
  assert.equal(f.state.createdClients, 0);
});
test('internal primitive also rejects missing confirmation before transaction', async () => {
  const f = fixture(); await assert.rejects(f.transaction({ confirmation: undefined })); assert.equal(f.state.transactions, 0);
});
test('read-only preflight rejects mismatched/absent marker, actual name, user and version before Prisma', async () => {
  for (const patch of [{ marker: null }, { marker: 'foreign' }, { database: 'citajusta_dev' }, { database: 'citajusta_e2e' },
    { username: 'postgres' }, { version: 170000 }, { version: 190000 }]) {
    const f = fixture(); Object.assign(f.state.preflightIdentity, patch); await assert.rejects(f.run(), /identity\/marker/);
    assert.equal(f.state.preflightClosed, 1); assert.equal(f.state.createdClients, 0); empty(f.state);
  }
});
test('pending migrations refuse provisioning and are never deployed', async () => {
  const f = fixture(); f.state.pending = true; await assert.rejects(f.run(), /Docker migrations pending/);
  assert.equal(f.state.createdClients, 0); empty(f.state);
});
test('writing connection repeats real identity verification before any account lookup or write', async () => {
  for (const patch of [null, { database: 'citajusta_dev' }, { database: 'citajusta_e2e' }, { username: 'other' },
    { marker: null }, { marker: 'foreign' }, { version: 170000 }, { version: 190000 }, { version: undefined }, { version: NaN }]) {
    const f = fixture(); f.state.identity = patch === null ? null : { ...f.state.identity, ...patch };
    await assert.rejects(f.run(), /identidad PostgreSQL/); empty(f.state);
    assert.equal(f.state.userReads, 0); assert.equal(f.state.disconnected, 1);
  }
});
test('an existing incompatible/inactive/deleted institution is never adopted or repaired', async () => {
  for (const patch of [null, { id: randomUUID() }, { status: 'INACTIVE' }, { deletedAt: new Date() }]) {
    const f = fixture(); f.state.institution = patch === null ? null : { ...f.state.institution, ...patch };
    await assert.rejects(f.run(), /institución debe existir/); empty(f.state);
  }
});
test('operator reuses compatible permission IDs without modifying their fields', async () => {
  const f = fixture(), permission = { id: randomUUID(), code: 'availability.create', module: 'availability', action: 'create' };
  f.state.permissions.push(permission); await f.run();
  assert.deepEqual(f.state.permissions[0], permission); assert.equal(f.state.permissions.length, 8);
  assert.ok(f.state.links.some(link => link.permissionId === permission.id));
});
test('operator rejects incompatible roles, permissions, grants and extra rights without repairs', async () => {
  for (const mutate of [
    s => { s.roles[0].scope = 'GLOBAL'; }, s => { s.roles[0].active = false; }, s => { s.roles[0].description = 'foreign'; },
    s => { s.permissions[0].module = 'foreign'; }, s => { s.grants[0].institutionId = null; },
    s => { s.grants[0].branchId = randomUUID(); }, s => { s.grants[0].active = false; },
    s => { s.grants[0].validTo = new Date(); }, s => { s.grants[0].userId = randomUUID(); },
    s => { const p = { id: randomUUID(), code: 'reassignments.generate', module: 'reassignments', action: 'generate' };
      s.permissions.push(p); s.links.push({ roleId: demoOperatorRole.id, permissionId: p.id }); },
    s => { s.grants.push({ ...s.grants[0], id: randomUUID() }); },
    s => { s.roles.push({ ...s.roles[0], id: randomUUID() }); },
  ]) {
    const f = fixture(); await f.run(); mutate(f.state); const before = snapshot(f.state);
    await assert.rejects(f.run(), /incompatible|ajen|alcance|duplicad|colisión/i); assert.deepEqual(snapshot(f.state), before);
  }
});
test('operator never repairs role links if that would expand another account or institution rights', async () => {
  for (const patch of [{ userId: randomUUID() }, { institutionId: randomUUID() }]) {
    const f = fixture(); await f.run();
    f.state.links.pop(); Object.assign(f.state.grants[0], patch);
    const before = snapshot(f.state); await assert.rejects(f.run(), /asignación ajena/);
    assert.deepEqual(snapshot(f.state), before);
  }
});
test('operator rejects code/module-action collisions before creating any RBAC records', async () => {
  const f = fixture(); f.state.permissions.push({ id: randomUUID(), code: 'alien', module: 'branches', action: 'read' });
  const before = snapshot(f.state); await assert.rejects(f.run(), /incompatible/); assert.deepEqual(snapshot(f.state), before);
});
test('busy administrative lock fails quickly without writes', async () => {
  const f = fixture(); f.state.locked = false; await assert.rejects(f.run(), /otra provisión/);
  assert.equal(f.state.userReads, 0); assert.equal(f.state.transactions, 1); empty(f.state);
});
test('retry is bounded and does not classify SQL constraint/programming errors as serializable', async () => {
  for (const error of [{ code: '23505' }, { code: 'P2002' }, new TypeError('PRIVATE SQL'), { code: 'P2034' }]) {
    const f = fixture(); f.state.commitError = error; await assert.rejects(f.run());
    assert.equal(f.state.transactions, error.code === 'P2034' ? 2 : 1); empty(f.state);
  }
});
test('persistent recognized adapter conflict retries once and rolls back all effects', async () => {
  const f = fixture();
  const error = { name: 'DriverAdapterError', cause: { kind: 'TransactionWriteConflict', originalCode: '40001' } };
  f.state.commitError = error;
  await assert.rejects(f.run()); assert.equal(f.state.transactions, 2); empty(f.state);
});
test('CLI logs omit identity, credentials and provider details on success/failure', async () => {
  const f = fixture(); await f.run();
  for (const secret of [password, userId, institutionId, environment.DEMO_ADMIN_EMAIL, 'UNTOUCHED']) {
    assert.ok(!f.state.logs.join('\n').includes(secret));
  }
  const logs = []; reportDemoProvisionFailure(new Error(`PRIVATE SQL ${environment.DATABASE_URL} token`), value => logs.push(value));
  assert.ok(!logs.join('').includes('PRIVATE SQL')); assert.ok(!logs.join('').includes(password));
  assert.match(logs[0], /Detalles del proveedor omitidos/);
  assert.equal(f.state.preflightClosed, 1); assert.equal(f.state.disconnected, 1);
});

test('institutional-reader preserves the exclusive Agenda role and requires its own confirmation', async () => {
  const f = fixture('institutional-reader');
  await f.run({ DEMO_PROVISION_CONFIRM: confirmation('agenda-reader') }, ['agenda-reader']);
  const before = snapshot(f.state);
  await assert.rejects(f.run({ DEMO_PROVISION_CONFIRM: confirmation('agenda-reader') }));
  assert.deepEqual(snapshot(f.state), before);
  await f.run();
  assert.deepEqual(f.state.roles.filter(role => role.id === demoAgendaReaderRole.id), before.roles);
  assert.deepEqual(f.state.grants.filter(grant => grant.roleId === demoAgendaReaderRole.id), before.grants);
  assert.deepEqual(f.state.links.filter(link => link.roleId === demoAgendaReaderRole.id), before.links);
  assert.deepEqual(f.state.permissions.filter(p => p.code === 'agenda.read'), before.permissions);
  assert.deepEqual(f.state.user, before.user); assert.deepEqual(f.state.appointments, before.appointments);
});

test('institutional-reader rejects every forbidden write link and never expands another owner', async () => {
  for (const code of ['reassignments.generate', 'reassignments.policy.update', 'appointments.attendance']) {
    const f = fixture('institutional-reader'); await f.run();
    const permission = { id: randomUUID(), code, module: code.slice(0, code.lastIndexOf('.')), action: code.split('.').at(-1) };
    f.state.permissions.push(permission); f.state.links.push({ roleId: demoInstitutionalReaderRole.id, permissionId: permission.id });
    const before = snapshot(f.state); await assert.rejects(f.run(), /permisos ajenos/); assert.deepEqual(snapshot(f.state), before);
  }
  const f = fixture('institutional-reader'); await f.run(); f.state.links.pop(); f.state.grants[0].userId = randomUUID();
  const before = snapshot(f.state); await assert.rejects(f.run(), /asignación ajena/); assert.deepEqual(snapshot(f.state), before);
});

for (const [mode, readerRole, readerPermissions, expectedRoleCode, expectedPermissions, auditAction] of [
  ['agenda-reader', demoAgendaReaderRole, demoAgendaReaderPermissions, 'DEMO_DOCKER_AGENDA_READER', ['agenda.read'], 'AGENDA_READER_PROVISIONED'],
  ['institutional-reader', demoInstitutionalReaderRole, demoInstitutionalReaderPermissions, 'DEMO_DOCKER_INSTITUTIONAL_READER',
    ['reassignments.read', 'reports.read', 'audit.read'], 'INSTITUTIONAL_READER_PROVISIONED'],
]) {
test(`${mode}: provisions exact read permissions with a non-system institutional role and scoped audit`, async () => {
  const f = fixture(mode), before = snapshot(f.state); await f.run();
  assert.deepEqual(f.state.roles, [readerRole]);
  assert.equal(readerRole.code, expectedRoleCode);
  assert.equal(readerRole.scope, 'INSTITUTION'); assert.equal(readerRole.isSystem, false);
  assert.deepEqual([...readerPermissions], expectedPermissions);
  assert.deepEqual(f.state.permissions, expectedPermissions.map((code, index) => ({ id: f.state.permissions[index].id, code, module: code.split('.')[0], action: 'read' })));
  assert.deepEqual(f.state.links, f.state.permissions.map(permission => ({ roleId: readerRole.id, permissionId: permission.id })));
  assert.deepEqual(f.state.grants, [{ id: f.state.grants[0].id, userId, roleId: readerRole.id,
    institutionId, branchId: null, active: true, validFrom: null, validTo: null }]);
  assert.equal(f.state.events.length, 1); const event = f.state.events[0];
  assert.equal(event.actionCode, auditAction); assert.equal(event.actorType, 'SYSTEM');
  assert.equal(event.institutionId, institutionId); assert.equal(event.resourceType, 'USER_ROLE');
  assert.equal(event.resourceId, f.state.grants[0].id);
  for (const key of ['user', 'institution', 'appointments']) assert.deepEqual(f.state[key], before[key]);
});
test(`${mode}: preserves both existing administrative roles and every existing permission/grant`, async () => {
  const f = fixture(mode);
  await f.run({ DEMO_PROVISION_CONFIRM: confirmation('platform'), DEMO_INSTITUTION_ID: undefined }, ['platform']);
  await f.run({ DEMO_PROVISION_CONFIRM: confirmation('institution') }, ['institution']);
  const before = snapshot(f.state); await f.run();
  for (const key of collections) assert.deepEqual(f.state[key].slice(0, before[key].length), before[key]);
  for (const code of expectedPermissions) assert.equal(f.state.permissions.filter(p => p.code === code).length, 1);
  for (const roleId of [demoOperatorRole.id, institutionAdministratorRole.id]) {
    assert.deepEqual(f.state.links.filter(link => link.roleId === roleId), before.links.filter(link => link.roleId === roleId));
  }
  assert.deepEqual(f.state.user, before.user); assert.deepEqual(f.state.appointments, before.appointments);
});
test(`${mode}: rejects missing confirmation, another action or institution before connecting`, async () => {
  for (const patch of [{ DEMO_PROVISION_CONFIRM: undefined }, { DEMO_PROVISION_CONFIRM: 'yes' },
    { DEMO_PROVISION_CONFIRM: confirmation('platform') }, { DEMO_PROVISION_CONFIRM: confirmation('institution') },
    { DEMO_INSTITUTION_ID: undefined }, { DEMO_INSTITUTION_ID: randomUUID() }, { DEMO_ADMIN_USER_ID: randomUUID() },
    { DEMO_ADMIN_EMAIL: undefined }]) {
    const f = fixture(mode); await assert.rejects(f.run(patch));
    assert.equal(f.state.preflightConnected, 0); assert.equal(f.state.createdClients, 0); empty(f.state);
  }
});
test(`${mode}: rejects unsafe targets and both preflight/writing connection identity mismatches`, async () => {
  for (const patch of [{ NODE_ENV: 'production' }, { NODE_ENV: 'test' }, { CITAJUSTA_DOCKER: undefined },
    ...['citajusta_dev', 'citajusta_e2e'].map(name => ({ DATABASE_URL: environment.DATABASE_URL.replace('citajusta_docker', name) })),
    { DATABASE_URL: environment.DATABASE_URL.replace('@db:', '@remote.example:') }]) {
    const f = fixture(mode); await assert.rejects(f.run(patch));
    assert.equal(f.state.preflightConnected, 0); assert.equal(f.state.createdClients, 0); empty(f.state);
  }
  for (const connection of ['preflightIdentity', 'identity']) {
    for (const patch of [{ database: 'citajusta_dev' }, { database: 'citajusta_e2e' }, { marker: null }, { marker: 'foreign' },
      { username: 'postgres' }, { version: 170000 }, { version: 190000 }]) {
      const f = fixture(mode); Object.assign(f.state[connection], patch); await assert.rejects(f.run());
      empty(f.state); assert.equal(f.state.userReads, 0);
    }
  }
  const f = fixture(mode); f.state.pending = true;
  await assert.rejects(f.run(), /migrations pending/); assert.equal(f.state.createdClients, 0); empty(f.state);
});
test(`${mode}: refuses missing, foreign, inactive or deleted institutions`, async () => {
  for (const patch of [null, { id: randomUUID() }, { status: 'INACTIVE' }, { deletedAt: new Date() }]) {
    const f = fixture(mode); f.state.institution = patch === null ? null : { ...f.state.institution, ...patch };
    const before = snapshot(f.state); await assert.rejects(f.run(), /institución debe existir/);
    assert.deepEqual(snapshot(f.state), before);
  }
});
test(`${mode}: reuses a compatible permission and preserves timestamps on replay`, async () => {
  const f = fixture(mode);
  const permissions = expectedPermissions.map(code => ({ id: randomUUID(), code, module: code.split('.')[0], action: 'read', createdAt: new Date('2026-01-01T00:00:00Z') }));
  f.state.permissions.push(...permissions); await f.run();
  assert.deepEqual(f.state.permissions, permissions); assert.deepEqual(f.state.links.map(link => link.permissionId), permissions.map(p => p.id));
  for (const key of ['roles', 'grants']) for (const row of f.state[key]) {
    row.createdAt = new Date('2026-01-01T00:00:00Z'); row.updatedAt = new Date('2026-01-02T00:00:00Z');
  }
  const before = snapshot(f.state); assert.equal((await f.run()).changed, false); assert.deepEqual(snapshot(f.state), before);
});
test(`${mode}: rejects incompatible roles, grants, duplicate identities and extra permissions without repair`, async () => {
  for (const mutate of [
    s => { s.roles[0].isSystem = true; }, s => { s.roles[0].scope = 'GLOBAL'; }, s => { s.roles[0].scope = 'BRANCH'; },
    s => { s.roles[0].active = false; }, s => { s.roles[0].description = 'foreign'; },
    s => { s.roles.push({ ...s.roles[0], id: randomUUID() }); }, s => { s.permissions[0].module = 'foreign'; },
    s => { s.grants[0].institutionId = randomUUID(); }, s => { s.grants[0].institutionId = null; },
    s => { s.grants[0].branchId = randomUUID(); }, s => { s.grants[0].userId = randomUUID(); },
    s => { s.grants[0].active = false; }, s => { s.grants[0].validTo = new Date(); },
    s => { s.grants.push({ ...s.grants[0], id: randomUUID() }); },
    s => { const p = { id: randomUUID(), code: 'appointments.attendance', module: 'appointments', action: 'attendance' };
      s.permissions.push(p); s.links.push({ roleId: readerRole.id, permissionId: p.id }); },
  ]) {
    const f = fixture(mode); await f.run(); mutate(f.state); const before = snapshot(f.state);
    await assert.rejects(f.run(), /incompatible|ajen|alcance|duplicad|colisión/i); assert.deepEqual(snapshot(f.state), before);
  }
});
test(`${mode}: rejects incompatible permission code/module-action collisions before any insert`, async () => {
  for (const fields of [{ code: expectedPermissions[0], module: 'foreign', action: 'read' },
    { code: 'foreign.read', module: expectedPermissions[0].split('.')[0], action: 'read' }]) {
    const f = fixture(mode); f.state.permissions.push({ id: randomUUID(), ...fields }); const before = snapshot(f.state);
    await assert.rejects(f.run(), /incompatible/); assert.deepEqual(snapshot(f.state), before);
  }
});
test(`${mode}: grant is effective only in the authorized tenant through the real AuthorizationService`, async () => {
  const f = fixture(mode); await f.run();
  const foreignInstitutionId = randomUUID(), ownBranchId = randomUUID(), foreignBranchId = randomUUID();
  const authorization = new AuthorizationService({
    institution: { findUnique: async ({ where }) => [institutionId, foreignInstitutionId].includes(where.id) ? { id: where.id } : null },
    branch: { findUnique: async ({ where }) => ({ institutionId: where.id === ownBranchId ? institutionId : foreignInstitutionId }) },
    userRole: { findMany: async ({ where }) => f.state.grants.filter(grant => grant.userId === where.userId).map(grant => ({ ...grant,
      role: { ...f.state.roles.find(role => role.id === grant.roleId), permissions: f.state.links.filter(link => link.roleId === grant.roleId)
        .map(link => ({ permission: f.state.permissions.find(p => p.id === link.permissionId) })) } })) },
  });
  for (const context of [{ institutionId }, { institutionId, branchId: ownBranchId }]) {
    const result = await authorization.resolveForUser(userId, context);
    assert.deepEqual(result.permissions, [...expectedPermissions].sort()); assert.deepEqual(result.roleCodes, [readerRole.code]);
  }
  for (const context of [{}, { institutionId: foreignInstitutionId }, { institutionId: foreignInstitutionId, branchId: foreignBranchId }]) {
    const result = await authorization.resolveForUser(userId, context); assert.deepEqual(result.permissions, []); assert.deepEqual(result.roleCodes, []);
  }
  await assert.rejects(authorization.resolveForUser(userId, { institutionId, branchId: foreignBranchId }), error => error.getStatus?.() === 400);
  assert.deepEqual((await authorization.resolveForUser(randomUUID(), { institutionId })).permissions, []);
});
test(`${mode}: sanitizes failure and success logs and never retries arbitrary SQL/programming errors`, async () => {
  for (const error of [new TypeError('PRIVATE SQL'), { code: '40001' }, { code: 'P2002' },
    { name: 'DriverAdapterError', cause: { kind: 'Other', originalCode: '40001' } }]) {
    const f = fixture(mode); f.state.commitError = error; await assert.rejects(f.run());
    assert.equal(f.state.transactions, 1); empty(f.state);
    const logs = []; reportDemoProvisionFailure(error, message => logs.push(message));
    assert.equal(logs.length, 1); assert.match(logs[0], /Detalles del proveedor omitidos/); assert.ok(!logs[0].includes('PRIVATE SQL'));
  }
  const f = fixture(mode); await f.run();
  for (const secret of [password, userId, institutionId, environment.DEMO_ADMIN_EMAIL, 'UNTOUCHED']) assert.ok(!f.state.logs.join('\n').includes(secret));
});
}
