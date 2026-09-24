import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { demo, DevelopmentError } from '../dist/database/development.js';
import { parseDesktopAgendaReaderEmail, seedDesktopAgendaReader } from '../dist/database/desktop-agenda-reader.js';

const options = { connectionString: 'postgresql://local:SECRET@localhost:5432/citajusta_dev', nodeEnv: 'development', email: 'desktop@example.test' };
const codes = ['agenda.read'];
function fixture() {
  const state = { roles: [], permissions: [], links: [], grants: [], institution: { ...demo.institution },
    user: { id: randomUUID(), email: options.email, status: 'ACTIVE', deletedAt: null, passwordHash: 'UNTOUCHED', firstNames: 'Original' },
    database: 'citajusta_dev', transactions: 0, writes: 0, failWrite: false, conflicts: 0, transactionError: null };
  const insert = collection => async ({ data }) => {
    state[collection].push({ ...data }); state.writes++;
    if (state.failWrite && collection === 'links') throw new Error('storage detail');
    return { ...data };
  };
  const match = (row, where) => Object.entries(where).every(([key, value]) => row[key] === value);
  const findMany = collection => async ({ where }) => state[collection].filter(row => where.OR.some(part => match(row, part)));
  const tx = {
    $queryRaw: async () => [{ database: state.database }],
    institution: { findUnique: async ({ where }) => { assert.equal(where.id, demo.institution.id); return state.institution; } },
    user: { findUnique: async ({ where, select }) => {
      assert.equal(where.email, options.email);
      assert.deepEqual(select, { id: true, email: true, status: true, deletedAt: true });
      return state.user;
    } },
    role: { findMany: findMany('roles'), create: insert('roles') },
    permission: { findMany: findMany('permissions'), create: insert('permissions') },
    userRole: { findMany: findMany('grants'), create: insert('grants') },
    rolePermission: {
      findMany: async ({ where }) => state.links.filter(link => link.roleId === where.roleId)
        .map(link => ({ ...link, permission: state.permissions.find(p => p.id === link.permissionId) })),
      create: insert('links'),
    },
  };
  const prisma = { $transaction: async (work, config) => {
    assert.equal(config.isolationLevel, 'Serializable'); state.transactions++;
    const before = structuredClone(state);
    try {
      const result = await work(tx);
      if (state.transactionError) throw state.transactionError;
      if (state.conflicts) { state.conflicts--; throw { code: 'P2034' }; }
      return result;
    } catch (error) {
      for (const key of ['roles', 'permissions', 'links', 'grants', 'writes']) state[key] = before[key];
      throw error;
    }
  } };
  return { state, run: (patch = {}) => seedDesktopAgendaReader(prisma, { ...options, ...patch }) };
}
const controlled = error => error instanceof DevelopmentError && !error.message.includes('SECRET');

test('email absent/invalid rejected and normalization matches Auth', async () => {
  for (const email of [undefined, '', 'invalid', 'a@', 'x'.repeat(255) + '@example.test']) {
    const f = fixture(); await assert.rejects(f.run({ email }), controlled); assert.equal(f.state.transactions, 0);
  }
  assert.equal(parseDesktopAgendaReaderEmail(' Desktop@Example.Test '), options.email);
});
test('unsafe destinations and missing/other NODE_ENV fail before database access', async () => {
  for (const patch of [
    ...[undefined, '', 'test', 'production'].map(nodeEnv => ({ nodeEnv })),
    ...[undefined, 'postgresql://local:SECRET@remote/citajusta_dev', 'postgresql://local:SECRET@localhost/citajusta_shadow',
      'postgresql://local:SECRET@localhost/production', `${options.connectionString}?host=remote`,
      `${options.connectionString}?schema=other`, `${options.connectionString}#secret`, 'mysql://localhost/citajusta_dev'].map(connectionString => ({ connectionString })),
  ]) {
    const f = fixture(); await assert.rejects(f.run(patch), controlled); assert.equal(f.state.transactions, 0);
  }
  const f = fixture(); f.state.database = 'citajusta_dev_test';
  await f.run({ connectionString: `${options.connectionString}_test?schema=public` });
});
test('real database name and demo institution identity are verified', async () => {
  for (const change of [s => { s.database = 'production'; }, s => { s.institution = null; },
    s => { s.institution.name = 'Foreign'; }, s => { s.institution.status = 'INACTIVE'; }, s => { s.institution.deletedAt = new Date(); }]) {
    const f = fixture(); change(f.state); await assert.rejects(f.run(), controlled); assert.equal(f.state.writes, 0);
  }
});
test('missing/inactive/deleted users are never created or updated', async () => {
  for (const user of [null, { status: 'INACTIVE', deletedAt: null }, { status: 'SUSPENDED', deletedAt: null }, { status: 'ACTIVE', deletedAt: new Date() }]) {
    const f = fixture(); f.state.user = user;
    await assert.rejects(f.run(), controlled); assert.equal(f.state.writes, 0);
  }
});
test('creates exactly agenda.read and institutional grant; replay preserves user and all RBAC rows', async () => {
  const f = fixture(); const userBefore = structuredClone(f.state.user);
  const result = await f.run();
  assert.deepEqual(result.permissions, codes);
  assert.deepEqual(f.state.permissions.map(p => p.code), codes);
  assert.equal(f.state.roles.length, 1);
  const role = f.state.roles[0];
  assert.equal(role.code, 'DEMO_DESKTOP_AGENDA_READER'); assert.equal(role.scope, 'INSTITUTION'); assert.equal(role.active, true);
  assert.equal(f.state.links.length, 1);
  assert.deepEqual(f.state.grants[0], { id: f.state.grants[0].id, userId: f.state.user.id, roleId: role.id,
    institutionId: demo.institution.id, branchId: null, active: true, validFrom: null, validTo: null });
  for (const permission of f.state.permissions) assert.equal(permission.code, `${permission.module}.${permission.action}`);
  const before = structuredClone(f.state);
  await f.run({ email: ' Desktop@Example.Test ' });
  for (const key of ['roles', 'permissions', 'links', 'grants', 'writes']) assert.deepEqual(f.state[key], before[key]);
  assert.deepEqual(f.state.user, userBefore);
});
test('compatible existing permissions reused; unrelated user roles untouched', async () => {
  const f = fixture();
  const permission = { id: randomUUID(), code: 'agenda.read', module: 'agenda', action: 'read' };
  const unrelated = { id: randomUUID(), userId: f.state.user.id, roleId: randomUUID(), institutionId: randomUUID(), branchId: null, active: true };
  f.state.permissions.push(permission); f.state.grants.push(unrelated);
  await f.run();
  assert.equal(f.state.permissions.length, 1);
  assert.deepEqual(f.state.permissions[0], permission);
  assert.deepEqual(f.state.grants[0], unrelated);
});
test('role identity/scope/marker collisions abort without overwriting', async () => {
  for (const patch of [{ id: randomUUID() }, { code: 'FOREIGN' }, { scope: 'GLOBAL' }, { active: false }, { description: 'foreign' }, { name: 'Foreign' }]) {
    const f = fixture(); await f.run(); Object.assign(f.state.roles[0], patch);
    const before = structuredClone(f.state);
    await assert.rejects(f.run(), controlled);
    assert.deepEqual(f.state.roles, before.roles); assert.equal(f.state.writes, before.writes);
  }
});

test('coexists with HU-029 without changing its six permissions, role or grant', async () => {
  const f = fixture();
  const catalogCodes = ['branches.read', 'branches.create', 'branches.update', 'services.read', 'services.create', 'services.update'];
  const role = { id: randomUUID(), code: 'DEMO_DESKTOP_CATALOG_ADMIN', scope: 'INSTITUTION', active: true };
  f.state.roles.push(role);
  for (const code of catalogCodes) {
    const [module, action] = code.split('.');
    const permission = { id: randomUUID(), code, module, action };
    f.state.permissions.push(permission);
    f.state.links.push({ roleId: role.id, permissionId: permission.id });
  }
  f.state.grants.push({ id: randomUUID(), userId: f.state.user.id, roleId: role.id,
    institutionId: demo.institution.id, branchId: null, active: true });
  const before = structuredClone(f.state);
  await f.run();
  assert.deepEqual(f.state.roles[0], before.roles[0]);
  assert.deepEqual(f.state.grants[0], before.grants[0]);
  assert.deepEqual(f.state.permissions.slice(0, 6), before.permissions);
  assert.deepEqual(f.state.links.filter(link => link.roleId === role.id), before.links);
  assert.equal(f.state.permissions.length, 7);
  const professionalRole = f.state.roles[1];
  assert.notEqual(professionalRole.id, role.id);
  assert.deepEqual(f.state.links.filter(link => link.roleId === professionalRole.id)
    .map(link => f.state.permissions.find(permission => permission.id === link.permissionId).code), codes);
  const complete = structuredClone(f.state);
  await f.run();
  for (const key of ['roles', 'permissions', 'links', 'grants', 'writes']) assert.deepEqual(f.state[key], complete[key]);
});

test('repairs missing dedicated links without broadening permissions', async () => {
  const f = fixture(); await f.run();
  f.state.links.splice(0, 1);
  await f.run();
  assert.equal(f.state.permissions.length, 1);
  assert.equal(f.state.grants.length, 1);
  assert.deepEqual(f.state.links.map(link => f.state.permissions.find(p => p.id === link.permissionId).code).sort(), [...codes].sort());
});
test('foreign permissions and incompatible permission identity abort', async () => {
  for (const mutate of [
    s => { const p = { id: randomUUID(), code: 'users.delete', module: 'users', action: 'delete' }; s.permissions.push(p); s.links.push({ roleId: s.roles[0].id, permissionId: p.id }); },
    s => { s.permissions[0].module = 'foreign'; },
    s => { s.permissions[0].code = 'foreign.read'; s.links = []; },
    s => { s.permissions.push({ ...s.permissions[0], id: randomUUID() }); },
  ]) {
    const f = fixture(); await f.run(); mutate(f.state); const before = structuredClone(f.state);
    await assert.rejects(f.run(), controlled); assert.equal(f.state.writes, before.writes);
    assert.deepEqual(f.state.permissions, before.permissions);
  }
});
test('foreign or incompatible grants are rejected, including inactive/dated/duplicate grants', async () => {
  for (const patch of [{ userId: randomUUID() }, { institutionId: randomUUID() }, { branchId: randomUUID() },
    { active: false }, { validFrom: new Date() }, { validTo: new Date() }, { id: randomUUID() }, { roleId: randomUUID() }]) {
    const f = fixture(); await f.run(); Object.assign(f.state.grants[0], patch); const before = structuredClone(f.state);
    await assert.rejects(f.run(), controlled); assert.deepEqual(f.state.grants, before.grants); assert.equal(f.state.writes, before.writes);
  }
  const f = fixture(); await f.run(); f.state.grants.push({ ...f.state.grants[0], id: randomUUID() });
  await assert.rejects(f.run(), controlled);
});
test('transaction rolls back partial writes and retries only recognized conflict once', async () => {
  const f = fixture(); f.state.failWrite = true;
  await assert.rejects(f.run()); assert.equal(f.state.roles.length + f.state.permissions.length + f.state.links.length + f.state.grants.length, 0);
  f.state.failWrite = false; f.state.conflicts = 1;
  await f.run(); assert.equal(f.state.transactions, 3); assert.equal(f.state.links.length, 1);
  const repeated = fixture(); repeated.state.conflicts = 2;
  await assert.rejects(repeated.run()); assert.equal(repeated.state.transactions, 2); assert.equal(repeated.state.writes, 0);
});

test('preserves HU-029 and HU-030 roles/grants together, without changing unrelated RBAC', async () => {
  const f = fixture();
  for (const code of ['DEMO_DESKTOP_CATALOG_ADMIN', 'DEMO_DESKTOP_PROFESSIONAL_ADMIN']) {
    const role = { id: randomUUID(), code, scope: 'INSTITUTION', active: true };
    const permission = { id: randomUUID(), code: `${code}.existing`, module: code, action: 'existing' };
    f.state.roles.push(role); f.state.permissions.push(permission);
    f.state.links.push({ roleId: role.id, permissionId: permission.id });
    f.state.grants.push({ id: randomUUID(), userId: f.state.user.id, roleId: role.id, institutionId: demo.institution.id, branchId: null, active: true });
  }
  const before = structuredClone(f.state);
  await f.run(); await f.run();
  for (const key of ['roles', 'permissions', 'links', 'grants']) assert.deepEqual(f.state[key].slice(0, 2), before[key]);
  assert.equal(f.state.roles.length, 3); assert.equal(f.state.permissions.length, 3);
  assert.equal(f.state.permissions[2].code, 'agenda.read');
  assert.deepEqual(f.state.user, before.user);
});

test('only recognized adapter conflicts retry; arbitrary SQL/unique/programming errors never retry', async () => {
  for (const originalCode of ['40001', '40P01']) {
    const f = fixture(); f.state.transactionError = { name: 'DriverAdapterError', cause: { kind: 'TransactionWriteConflict', originalCode } };
    await assert.rejects(f.run()); assert.equal(f.state.transactions, 2); assert.equal(f.state.writes, 0);
  }
  for (const error of [new TypeError('programming error'), { code: 'P2002' }, { code: '40001' },
    { name: 'DriverAdapterError', cause: { kind: 'TransactionWriteConflict', originalCode: '23505' } },
    { name: 'DriverAdapterError', cause: { kind: 'Other', originalCode: '40001' } }]) {
    const f = fixture(); f.state.transactionError = error;
    await assert.rejects(f.run()); assert.equal(f.state.transactions, 1); assert.equal(f.state.writes, 0);
  }
});
