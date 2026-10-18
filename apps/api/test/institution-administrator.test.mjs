import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { institutionAdministratorRole, provisionDevelopmentInstitutionAdministrator } from '../dist/database/institution-administrator.js';
import { DevelopmentError } from '../dist/database/development.js';

const userId = randomUUID();
const options = { connectionString: 'postgresql://operator:SECRET@localhost:5432/citajusta_dev', nodeEnv: 'development',
  confirmedDatabase: 'citajusta_dev', email: 'admin@example.test', userId };
function fixture() {
  const state = { roles: [], permissions: [], links: [], grants: [], events: [], database: 'citajusta_dev', version: 180000,
    user: { id: userId, email: options.email, status: 'ACTIVE', deletedAt: null, passwordHash: 'UNTOUCHED' }, transactions: 0, fail: false, conflicts: 0, error: null };
  const matches = (row, where) => Object.entries(where).every(([key, value]) => row[key] === value);
  const many = collection => async ({ where }) => state[collection].filter(row => where.OR ? where.OR.some(part => matches(row, part)) : matches(row, where));
  const create = collection => async ({ data }) => { state[collection].push({ ...data }); return { ...data }; };
  const tx = {
    $queryRaw: async () => [{ database: state.database, version: state.version }], $executeRaw: async () => 1,
    user: { findUnique: async ({ where, select }) => {
      assert.equal(where.email, options.email); assert.deepEqual(select, { id: true, status: true, deletedAt: true }); return state.user;
    } },
    role: { findMany: many('roles'), create: create('roles') }, permission: { findMany: many('permissions'), create: create('permissions') },
    userRole: { findMany: many('grants'), create: create('grants') },
    rolePermission: { findMany: async ({ where }) => state.links.filter(link => link.roleId === where.roleId).map(link => ({ ...link,
      permission: state.permissions.find(p => p.id === link.permissionId) })), create: create('links') },
    auditEvent: { create: async ({ data }) => { if (state.fail) throw new Error('PRIVATE'); state.events.push(data); return { id: data.id }; } },
  };
  const prisma = { $transaction: async (work, config) => {
    assert.equal(config.isolationLevel, 'Serializable'); state.transactions++;
    const before = structuredClone(state);
    try { const result = await work(tx); if (state.error) throw state.error; if (state.conflicts-- > 0) throw { code: 'P2034' }; return result; }
    catch (error) { for (const key of ['roles','permissions','links','grants','events']) state[key] = before[key]; throw error; }
  } };
  return { state, run: (patch = {}) => provisionDevelopmentInstitutionAdministrator(prisma, { ...options, ...patch }) };
}
const controlled = error => error instanceof DevelopmentError && !error.message.includes('SECRET');

test('provision rejects unsafe environments, URLs and missing explicit database confirmation before access', async () => {
  for (const patch of [
    ...[undefined, 'test', 'production'].map(nodeEnv => ({ nodeEnv })), { confirmedDatabase: undefined }, { confirmedDatabase: 'other' },
    ...['postgresql://operator:SECRET@remote/citajusta_dev', 'postgresql://operator:SECRET@localhost/citajusta_docker',
      'postgresql://operator:SECRET@127.0.0.1:15432/citajusta_e2e', `${options.connectionString}?host=remote`].map(connectionString => ({ connectionString })),
    { email: 'invalid' }, { userId: 'invalid' },
  ]) { const f = fixture(); await assert.rejects(f.run(patch), controlled); assert.equal(f.state.transactions, 0); }
});
test('provision verifies real database name/version before writes', async () => {
  for (const patch of [{ database: 'other' }, { version: 170000 }, { version: 190000 }, { version: undefined }]) {
    const f = fixture(); Object.assign(f.state, patch); await assert.rejects(f.run(), controlled); assert.equal(f.state.roles.length, 0);
  }
});
test('provision requires matching existing ACTIVE identity and never changes credentials', async () => {
  for (const user of [null, { id: randomUUID(), status: 'ACTIVE', deletedAt: null }, { id: userId, status: 'INACTIVE', deletedAt: null },
    { id: userId, status: 'ACTIVE', deletedAt: new Date() }]) {
    const f = fixture(); f.state.user = user; await assert.rejects(f.run(), controlled); assert.equal(f.state.roles.length, 0);
  }
  const f = fixture(), before = structuredClone(f.state.user); await f.run(); assert.deepEqual(f.state.user, before);
});
test('provision persists exactly three GLOBAL permissions and unscoped grant; repeat makes no changes', async () => {
  const f = fixture(); const first = await f.run(); assert.equal(first.changed, true);
  assert.deepEqual(f.state.roles, [institutionAdministratorRole]);
  assert.deepEqual(f.state.permissions.map(p => p.code), ['institutions.read','institutions.create','institutions.update']);
  assert.equal(f.state.grants[0].institutionId, null); assert.equal(f.state.grants[0].branchId, null);
  assert.equal(f.state.grants[0].userId, userId); assert.equal(f.state.events[0].resourceId, first.grantId);
  assert.equal(f.state.events[0].actorType, 'SYSTEM'); assert.equal(f.state.events[0].actionCode, 'INSTITUTION_ADMINISTRATOR_PROVISIONED');
  const before = structuredClone(f.state); assert.equal((await f.run()).changed, false);
  for (const key of ['roles','permissions','links','grants','events','user']) assert.deepEqual(f.state[key], before[key]);
});
test('provision reuses compatible permissions and preserves unrelated roles and grants', async () => {
  const f = fixture();
  const p = { id: randomUUID(), code: 'institutions.read', module: 'institutions', action: 'read' };
  const role = { id: randomUUID(), code: 'INSTITUTION_ADMIN', scope: 'INSTITUTION' };
  const grant = { id: randomUUID(), userId, roleId: role.id, institutionId: randomUUID(), branchId: null };
  f.state.permissions.push(p); f.state.roles.push(role); f.state.grants.push(grant); await f.run();
  assert.deepEqual(f.state.permissions[0], p); assert.deepEqual(f.state.roles[0], role); assert.deepEqual(f.state.grants[0], grant);
});
test('provision rejects incompatible role, permission, extra rights and scoped/expired assignments without repair', async () => {
  for (const mutate of [s => { s.roles[0].scope = 'INSTITUTION'; }, s => { s.roles[0].description = 'foreign'; },
    s => { s.permissions[0].module = 'other'; }, s => { s.grants[0].institutionId = randomUUID(); },
    s => { s.grants[0].active = false; }, s => { s.grants[0].validTo = new Date(); },
    s => { const p = { id: randomUUID(), code: 'users.update', module: 'users', action: 'update' }; s.permissions.push(p); s.links.push({ roleId: s.roles[0].id, permissionId: p.id }); },
  ]) { const f = fixture(); await f.run(); mutate(f.state); const before = structuredClone(f.state);
    await assert.rejects(f.run(), controlled); for (const key of ['roles','permissions','links','grants','events']) assert.deepEqual(f.state[key], before[key]); }
});
test('provision audit failure rolls back all records', async () => {
  const f = fixture(); f.state.fail = true; await assert.rejects(f.run(), /PRIVATE/);
  for (const key of ['roles','permissions','links','grants','events']) assert.equal(f.state[key].length, 0);
});
test('provision retries only recognized transaction conflict and repeats all checks', async () => {
  const f = fixture(); f.state.conflicts = 1; await f.run(); assert.equal(f.state.transactions, 2); assert.equal(f.state.grants.length, 1); assert.equal(f.state.events.length, 1);
  const g = fixture(); g.state.error = { code: '23505' }; await assert.rejects(g.run()); assert.equal(g.state.transactions, 1);
});
