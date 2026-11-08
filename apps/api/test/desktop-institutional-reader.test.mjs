import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { demo, DevelopmentError } from '../dist/database/development.js';
import { parseDesktopInstitutionalReaderEmail, seedDesktopInstitutionalReader } from '../dist/database/desktop-institutional-reader.js';
import { AuthorizationService } from '../dist/authorization/authorization.service.js';

const options = { connectionString: 'postgresql://local:SECRET@localhost:5432/citajusta_dev', nodeEnv: 'development', email: 'matias.desktop.test@example.test' };
const codes = ['users.read', 'waitlist.read'];
const controlled = error => error instanceof DevelopmentError && !error.message.includes('SECRET');
const rbacKeys = ['roles', 'permissions', 'links', 'grants', 'user'];
function fixture() {
  const state = { database: 'citajusta_dev', institution: { ...demo.institution },
    user: { id: randomUUID(), email: options.email, status: 'ACTIVE', deletedAt: null, passwordHash: 'UNCHANGED' },
    roles: [], permissions: codes.map(code => ({ id: randomUUID(), code, module: code.split('.')[0], action: 'read' })),
    links: [], grants: [], transactions: 0, writes: 0, readOnlyChecks: 0, failCollection: null, conflicts: 0, error: null };
  let readOnly = false;
  const matches = (row, where) => Object.entries(where).every(([key, value]) => row[key] === value);
  const find = collection => async ({ where }) => state[collection].filter(row => where.OR ? where.OR.some(part => matches(row, part)) : matches(row, where));
  const insert = collection => async ({ data }) => {
    assert.equal(readOnly, false, 'check must never write');
    state[collection].push({ ...data }); state.writes++;
    if (state.failCollection === collection) throw new Error('private storage detail');
    return { ...data };
  };
  const tx = {
    $executeRaw: async strings => { assert.equal(strings.join(''), 'SET TRANSACTION READ ONLY'); readOnly = true; state.readOnlyChecks++; },
    $queryRaw: async strings => { assert.equal(strings.join(''), 'SELECT current_database() AS database'); return [{ database: state.database }]; },
    institution: { findUnique: async ({ where }) => { assert.equal(where.id, demo.institution.id); return state.institution; } },
    user: { findUnique: async ({ where, select }) => {
      assert.equal(where.email, options.email);
      assert.deepEqual(select, { id: true, email: true, status: true, deletedAt: true });
      return state.user;
    } },
    permission: { findMany: find('permissions'), create: insert('permissions') },
    role: { findMany: find('roles'), create: insert('roles') },
    rolePermission: { findMany: find('links'), create: insert('links') },
    userRole: { findMany: find('grants'), create: insert('grants') },
  };
  const prisma = { $transaction: async (work, config) => {
    assert.deepEqual(config, { isolationLevel: 'Serializable' });
    state.transactions++; readOnly = false;
    const before = structuredClone(state);
    try {
      const result = await work(tx);
      if (state.error) throw state.error;
      if (state.conflicts) { state.conflicts--; throw { code: 'P2034' }; }
      return result;
    } catch (error) {
      for (const key of [...rbacKeys, 'writes']) state[key] = before[key];
      throw error;
    }
  } };
  return { state, run: (patch = {}) => seedDesktopInstitutionalReader(prisma, { ...options, ...patch }) };
}
const snapshot = state => Object.fromEntries(rbacKeys.map(key => [key, structuredClone(state[key])]));

test('only explicitly named account is accepted; email normalization matches Auth', async () => {
  for (const email of [undefined, '', 'invalid', 'another@example.test']) {
    const f = fixture(); await assert.rejects(f.run({ email, apply: true }), controlled); assert.equal(f.state.transactions, 0);
  }
  assert.equal(parseDesktopInstitutionalReaderEmail(' MATIAS.DESKTOP.TEST@EXAMPLE.TEST '), options.email);
});
test('explicit development required before any database access', async () => {
  for (const nodeEnv of [undefined, '', 'test', 'production']) {
    const f = fixture(); await assert.rejects(f.run({ nodeEnv, apply: true }), controlled); assert.equal(f.state.transactions, 0);
  }
});
test('DEV guard rejects DEMO/E2E/remote/shadow databases and alternate connection targets', async () => {
  for (const connectionString of [undefined, 'invalid',
    ...['citajusta_docker', 'citajusta_e2e', 'citajusta_shadow', 'production'].map(name => `postgresql://local:SECRET@127.0.0.1/${name}`),
    'postgresql://local:SECRET@remote/citajusta_dev', 'mysql://localhost/citajusta_dev',
    `${options.connectionString}?host=remote`, `${options.connectionString}?schema=private`, `${options.connectionString}#secret`]) {
    const f = fixture(); await assert.rejects(f.run({ connectionString, apply: true }), controlled); assert.equal(f.state.transactions, 0);
  }
});
test('real database identity must match authorized DEV target', async () => {
  const f = fixture(); f.state.database = 'citajusta_docker';
  await assert.rejects(f.run({ apply: true }), controlled); assert.equal(f.state.writes, 0);
});
test('demo institution must already exist and remain compatible', async () => {
  for (const patch of [null, { ...demo.institution, id: randomUUID() }, { ...demo.institution, name: 'Foreign' },
    { ...demo.institution, status: 'INACTIVE' }, { ...demo.institution, deletedAt: new Date() }]) {
    const f = fixture(); f.state.institution = patch;
    await assert.rejects(f.run({ apply: true }), controlled); assert.equal(f.state.writes, 0);
  }
});
test('existing ACTIVE non-deleted account required; user and credentials never written', async () => {
  for (const patch of [null, { status: 'PENDING' }, { status: 'SUSPENDED' }, { deletedAt: new Date() }, { email: 'other@example.test' }]) {
    const f = fixture(); f.state.user = patch === null ? null : { ...f.state.user, ...patch };
    const before = snapshot(f.state); await assert.rejects(f.run({ apply: true }), controlled);
    assert.deepEqual(snapshot(f.state), before); assert.equal(f.state.writes, 0);
  }
});
test('missing exact permissions are planned in check and created only by explicit apply', async () => {
  for (const code of codes) {
    const f = fixture(); f.state.permissions = f.state.permissions.filter(p => p.code !== code);
    const before = snapshot(f.state); const checked = await f.run();
    assert.deepEqual(checked.missingPermissions, [code]); assert.equal(checked.changes, 5);
    assert.deepEqual(snapshot(f.state), before); assert.equal(f.state.writes, 0);
    await f.run({ apply: true }); assert.deepEqual(f.state.permissions.map(p => p.code).sort(), codes);
    const after = snapshot(f.state); assert.equal((await f.run({ apply: true })).changes, 0); assert.deepEqual(snapshot(f.state), after);
  }
});
test('incompatible module/action fails before RBAC writes', async () => {
  for (const patch of [{ module: 'foreign' }, { action: 'update' }]) {
    const f = fixture(); Object.assign(f.state.permissions[0], patch);
    await assert.rejects(f.run({ apply: true }), controlled); assert.equal(f.state.writes, 0);
  }
});
test('empty permission catalog creates exactly the two requested codes, idempotently', async () => {
  const f = fixture(); f.state.permissions = [];
  const checked = await f.run(); assert.deepEqual(checked.missingPermissions, codes); assert.equal(checked.changes, 6);
  assert.equal(f.state.permissions.length, 0); assert.equal(f.state.writes, 0);
  await f.run({ apply: true }); assert.deepEqual(f.state.permissions.map(p => p.code), codes);
  const before = snapshot(f.state); assert.equal((await f.run({ apply: true })).changes, 0); assert.deepEqual(snapshot(f.state), before);
});
test('permission code, deterministic UUID and module/action collisions fail without repair', async () => {
  for (const mutate of [
    s => { s.permissions[0].code = 'foreign.read'; },
    s => { s.permissions[0].code = 'foreign.read'; s.permissions[0].module = 'foreign'; },
    s => { s.permissions.push({ ...s.permissions[0], id: randomUUID() }); },
    s => { s.permissions.push({ ...s.permissions[0], code: 'foreign.read', id: randomUUID() }); },
  ]) {
    const f = fixture(); f.state.permissions = []; await f.run({ apply: true }); mutate(f.state);
    const before = snapshot(f.state); await assert.rejects(f.run(), controlled); await assert.rejects(f.run({ apply: true }), controlled);
    assert.deepEqual(snapshot(f.state), before);
  }
});
test('default check enforces READ ONLY, reports planned inserts and preserves all data', async () => {
  const f = fixture(); const before = snapshot(f.state);
  const result = await f.run();
  assert.equal(result.applied, false); assert.equal(result.changes, 4); assert.equal(result.existingAssignments, 0);
  assert.equal(f.state.readOnlyChecks, 1); assert.equal(f.state.writes, 0); assert.deepEqual(snapshot(f.state), before);
});
test('explicit apply creates exactly two links, INSTITUTION non-system role and scoped grant', async () => {
  const f = fixture(); const before = snapshot(f.state); const result = await f.run({ apply: true });
  assert.equal(result.applied, true); assert.deepEqual(result.permissions, codes); assert.equal(result.changes, 4);
  assert.equal(f.state.roles.length, 1); assert.equal(f.state.links.length, 2); assert.equal(f.state.grants.length, 1);
  const role = f.state.roles[0];
  assert.equal(role.code, 'DEMO_DESKTOP_INSTITUTIONAL_READER'); assert.equal(role.scope, 'INSTITUTION'); assert.equal(role.isSystem, false);
  assert.deepEqual(f.state.grants[0], { id: f.state.grants[0].id, userId: f.state.user.id, roleId: role.id,
    institutionId: demo.institution.id, branchId: null, assignedByUserId: null, active: true, validFrom: null, validTo: null });
  assert.deepEqual(f.state.links.map(link => f.state.permissions.find(p => p.id === link.permissionId).code), codes);
  assert.deepEqual(f.state.permissions, before.permissions); assert.deepEqual(f.state.user, before.user);
});
test('second apply is a no-op, including timestamps; check reports zero pending changes', async () => {
  const f = fixture(); await f.run({ apply: true });
  for (const rows of [f.state.roles, f.state.links, f.state.grants]) for (const row of rows) row.createdAt = new Date();
  const before = snapshot(f.state), writes = f.state.writes;
  assert.equal((await f.run({ apply: true })).changes, 0); assert.equal((await f.run()).changes, 0);
  assert.deepEqual(snapshot(f.state), before); assert.equal(f.state.writes, writes);
});
test('all eight existing roles, grants and permission links remain intact', async () => {
  const f = fixture();
  for (const name of ['CATALOG_ADMIN', 'PROFESSIONAL_ADMIN', 'AGENDA_READER', 'ATTENDANCE_OPERATOR', 'AVAILABILITY_ADMIN', 'REASSIGNMENT_SUPERVISOR', 'REPORTS_READER', 'AUDIT_READER']) {
    const role = { id: randomUUID(), code: `DEMO_DESKTOP_${name}`, scope: 'INSTITUTION', active: true };
    const permission = { id: randomUUID(), code: `${name.toLowerCase()}.read`, module: name.toLowerCase(), action: 'read' };
    f.state.roles.push(role); f.state.permissions.push(permission);
    f.state.links.push({ roleId: role.id, permissionId: permission.id });
    f.state.grants.push({ id: randomUUID(), roleId: role.id, userId: f.state.user.id, institutionId: demo.institution.id, branchId: null, active: true });
  }
  const before = snapshot(f.state);
  const check = await f.run(); assert.equal(check.existingAssignments, 8); assert.deepEqual(snapshot(f.state), before);
  await f.run({ apply: true }); await f.run({ apply: true });
  assert.deepEqual(f.state.roles.slice(0, 8), before.roles); assert.deepEqual(f.state.grants.slice(0, 8), before.grants);
  assert.deepEqual(f.state.links.slice(0, 8), before.links); assert.deepEqual(f.state.permissions, before.permissions);
  assert.equal(f.state.roles.length, 9); assert.equal(f.state.grants.length, 9); assert.deepEqual(f.state.user, before.user);
});
test('colliding role identity, scope, system flag and metadata are never repaired', async () => {
  for (const patch of [{ id: randomUUID() }, { code: 'FOREIGN' }, { scope: 'GLOBAL' }, { scope: 'BRANCH' }, { isSystem: true },
    { active: false }, { description: 'foreign' }, { name: 'Foreign' }]) {
    const f = fixture(); await f.run({ apply: true }); Object.assign(f.state.roles[0], patch); const before = snapshot(f.state);
    await assert.rejects(f.run(), controlled); await assert.rejects(f.run({ apply: true }), controlled);
    assert.deepEqual(snapshot(f.state), before);
  }
});
test('duplicate dedicated role identities are rejected', async () => {
  const f = fixture(); await f.run({ apply: true }); f.state.roles.push({ ...f.state.roles[0], id: randomUUID() });
  await assert.rejects(f.run({ apply: true }), controlled);
});
test('foreign permissions on dedicated role are rejected, not removed', async () => {
  const f = fixture(); await f.run({ apply: true });
  f.state.links.push({ roleId: f.state.roles[0].id, permissionId: randomUUID() }); const before = snapshot(f.state);
  await assert.rejects(f.run({ apply: true }), controlled); assert.deepEqual(snapshot(f.state), before);
});
test('other users/institutions, GLOBAL-like or incompatible grants cannot reuse the dedicated role', async () => {
  for (const patch of [{ userId: randomUUID() }, { institutionId: randomUUID() }, { institutionId: null }, { branchId: randomUUID() },
    { active: false }, { validFrom: new Date() }, { validTo: new Date() }, { id: randomUUID() }, { roleId: randomUUID() }, { assignedByUserId: randomUUID() }]) {
    const f = fixture(); await f.run({ apply: true }); Object.assign(f.state.grants[0], patch); const before = snapshot(f.state);
    await assert.rejects(f.run({ apply: true }), controlled); assert.deepEqual(snapshot(f.state), before);
  }
});
test('duplicate or additional foreign assignments abort without edits', async () => {
  const f = fixture(); await f.run({ apply: true });
  f.state.grants.push({ ...f.state.grants[0], id: randomUUID(), userId: randomUUID() });
  const before = snapshot(f.state); await assert.rejects(f.run({ apply: true }), controlled); assert.deepEqual(snapshot(f.state), before);
});
test('missing dedicated links can be inserted without changing permissions or prior grants', async () => {
  const f = fixture(); await f.run({ apply: true }); f.state.links.pop(); const before = snapshot(f.state);
  assert.equal((await f.run()).changes, 1); assert.deepEqual(snapshot(f.state), before);
  await f.run({ apply: true }); assert.equal(f.state.links.length, 2);
  for (const key of ['roles', 'permissions', 'grants', 'user']) assert.deepEqual(f.state[key], before[key]);
});
test('every intermediate write failure rolls back the entire operation', async () => {
  for (const failCollection of ['roles', 'permissions', 'links', 'grants']) {
    const f = fixture(); f.state.failCollection = failCollection;
    if (failCollection === 'permissions') f.state.permissions = [];
    const before = snapshot(f.state);
    await assert.rejects(f.run({ apply: true }), /private storage detail/);
    assert.deepEqual(snapshot(f.state), before); assert.equal(f.state.writes, 0); assert.equal(f.state.transactions, 1);
  }
});
test('one recognized serialization conflict retries the whole operation idempotently', async () => {
  const f = fixture(); f.state.conflicts = 1; await f.run({ apply: true });
  assert.equal(f.state.transactions, 2); assert.equal(f.state.writes, 4); assert.equal(f.state.grants.length, 1);
  const persistent = fixture(); persistent.state.conflicts = 2;
  await assert.rejects(persistent.run({ apply: true })); assert.equal(persistent.state.transactions, 2); assert.equal(persistent.state.writes, 0);
});
test('only recognized adapter serialization/deadlock conflicts retry; SQL/unique/programming errors do not', async () => {
  for (const originalCode of ['40001', '40P01']) {
    const f = fixture(); f.state.error = { name: 'DriverAdapterError', cause: { kind: 'TransactionWriteConflict', originalCode } };
    await assert.rejects(f.run({ apply: true })); assert.equal(f.state.transactions, 2); assert.equal(f.state.writes, 0);
  }
  for (const error of [new TypeError('programming'), { code: 'P2002' }, { code: '40001' },
    { name: 'DriverAdapterError', cause: { kind: 'TransactionWriteConflict', originalCode: '23505' } }]) {
    const f = fixture(); f.state.error = error;
    await assert.rejects(f.run({ apply: true })); assert.equal(f.state.transactions, 1); assert.equal(f.state.writes, 0);
  }
});
test('real AuthorizationService resolves these permissions only for the selected institution', async () => {
  const f = fixture(); await f.run({ apply: true });
  const authorization = new AuthorizationService({
    institution: { findUnique: async ({ where }) => ({ id: where.id }) },
    userRole: { findMany: async ({ where }) => f.state.grants.filter(g => g.userId === where.userId).map(g => ({ ...g,
      role: { ...f.state.roles.find(r => r.id === g.roleId), permissions: f.state.links.map(link => ({ permission: f.state.permissions.find(p => p.id === link.permissionId) })) } })) },
  });
  assert.deepEqual((await authorization.resolveForUser(f.state.user.id, { institutionId: demo.institution.id })).permissions, codes);
  assert.deepEqual((await authorization.resolveForUser(f.state.user.id, { institutionId: randomUUID() })).permissions, []);
  assert.deepEqual((await authorization.resolveForUser(f.state.user.id, {})).permissions, []);
  assert.deepEqual((await authorization.resolveForUser(randomUUID(), { institutionId: demo.institution.id })).permissions, []);
});
test('CLI rejects unknown or conflicting flags before any database connection with sanitized output', () => {
  for (const args of [['--unknown'], ['--apply', '--check']]) {
    const result = spawnSync(process.execPath, ['scripts/seed-desktop-institutional-reader.mjs', ...args], {
      cwd: new URL('../', import.meta.url), encoding: 'utf8', env: { ...process.env, DATABASE_URL: options.connectionString },
    });
    assert.equal(result.status, 1); assert.match(result.stderr, /Usa --check/); assert.doesNotMatch(result.stderr, /SECRET|postgresql:\/\//);
  }
});
