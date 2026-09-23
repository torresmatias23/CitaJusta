import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { demo, DevelopmentError } from '../dist/database/development.js';
import { parseDesktopCatalogAdminEmail, seedDesktopCatalogAdmin } from '../dist/database/desktop-catalog-admin.js';

const options = { connectionString: 'postgresql://local:SECRET@localhost:5432/citajusta_dev', nodeEnv: 'development', email: 'desktop@example.test' };
const codes = ['branches.read', 'branches.create', 'branches.update', 'services.read', 'services.create', 'services.update'];
function fixture() {
  const state = { roles: [], permissions: [], links: [], grants: [], institution: { ...demo.institution },
    user: { id: randomUUID(), email: options.email, status: 'ACTIVE', deletedAt: null, passwordHash: 'UNTOUCHED', firstNames: 'Original' },
    database: 'citajusta_dev', transactions: 0, writes: 0, failWrite: false, conflicts: 0 };
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
      if (state.conflicts) { state.conflicts--; throw { code: 'P2034' }; }
      return result;
    } catch (error) {
      for (const key of ['roles', 'permissions', 'links', 'grants', 'writes']) state[key] = before[key];
      throw error;
    }
  } };
  return { state, run: (patch = {}) => seedDesktopCatalogAdmin(prisma, { ...options, ...patch }) };
}
const controlled = error => error instanceof DevelopmentError && !error.message.includes('SECRET');

test('email absent/invalid rejected and normalization matches Auth', async () => {
  for (const email of [undefined, '', 'invalid', 'a@', 'x'.repeat(255) + '@example.test']) {
    const f = fixture(); await assert.rejects(f.run({ email }), controlled); assert.equal(f.state.transactions, 0);
  }
  assert.equal(parseDesktopCatalogAdminEmail(' Desktop@Example.Test '), options.email);
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
test('creates exactly six permissions and institutional grant; replay preserves user and all RBAC rows', async () => {
  const f = fixture(); const userBefore = structuredClone(f.state.user);
  const result = await f.run();
  assert.deepEqual(result.permissions, codes);
  assert.deepEqual(f.state.permissions.map(p => p.code), codes);
  assert.equal(f.state.roles.length, 1);
  const role = f.state.roles[0];
  assert.equal(role.code, 'DEMO_DESKTOP_CATALOG_ADMIN'); assert.equal(role.scope, 'INSTITUTION'); assert.equal(role.active, true);
  assert.equal(f.state.links.length, 6);
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
  const permission = { id: randomUUID(), code: 'branches.read', module: 'branches', action: 'read' };
  const unrelated = { id: randomUUID(), userId: f.state.user.id, roleId: randomUUID(), institutionId: randomUUID(), branchId: null, active: true };
  f.state.permissions.push(permission); f.state.grants.push(unrelated);
  await f.run();
  assert.equal(f.state.permissions.length, 6);
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
  await f.run(); assert.equal(f.state.transactions, 3); assert.equal(f.state.links.length, 6);
  const repeated = fixture(); repeated.state.conflicts = 2;
  await assert.rejects(repeated.run()); assert.equal(repeated.state.transactions, 2); assert.equal(repeated.state.writes, 0);
});
