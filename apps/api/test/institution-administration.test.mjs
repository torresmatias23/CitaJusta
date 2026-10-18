import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { InstitutionAdministrationService } from '../dist/institutions/institution-administration.service.js';
import { createInstitutionSchema, updateInstitutionSchema, parseInstitutionAdministration, institutionAdministrationContext } from '../dist/institutions/institution-administration.schemas.js';
import { AuthorizationService } from '../dist/authorization/authorization.service.js';
import { Prisma } from '../dist/generated/prisma/client.js';

const actor = randomUUID(), id = randomUUID();
const context = { userId: actor, roleCodes: [], permissions: [] };
const status = value => error => error?.getStatus?.() === value;
const codes = ['institutions.read', 'institutions.create', 'institutions.update'];
function fixture() {
  const state = { rows: [], audit: [], permissions: codes, user: { id: actor }, failure: null, conflicts: 0, transactions: 0 };
  const tx = {
    user: { findFirst: async () => state.user },
    userRole: { findMany: async ({ where, select }) => {
      assert.equal(where.role.scope, 'GLOBAL'); assert.equal(where.active, true); assert.equal(where.role.active, true);
      assert.equal(where.userId, actor); assert.equal(where.institutionId, null); assert.equal(where.branchId, null);
      assert.equal(where.AND.length, 2); assert.ok(select.role.select.permissions);
      return [{ role: { permissions: state.permissions.map(code => ({ permission: { code } })) } }];
    } },
    institution: {
      create: async ({ data, select }) => { assert.equal(select.roleAssignments, undefined);
        const row = { ...data, createdAt: new Date(), updatedAt: new Date(), legalName: null, taxIdentifier: null,
          contactEmail: null, phone: null, timeZone: 'America/Santiago' }; state.rows.push(row); return row; },
      findFirst: async ({ where }) => state.rows.find(row => row.id === where.id && !row.deletedAt) ?? null,
      findMany: async ({ where, orderBy }) => { assert.deepEqual(where, { deletedAt: null }); assert.deepEqual(orderBy, [{ name: 'asc' }, { id: 'asc' }]); return state.rows; },
      update: async ({ where, data }) => { const row = state.rows.find(row => row.id === where.id); Object.assign(row, data); return row; },
    },
    auditEvent: { create: async ({ data }) => { state.audit.push(data); if (state.failure) throw state.failure; return { id: data.id }; } },
  };
  const service = new InstitutionAdministrationService({ $transaction: async (work, options) => {
    assert.ok(['Serializable', 'RepeatableRead'].includes(options.isolationLevel)); state.transactions++;
    const before = structuredClone({ rows: state.rows, audit: state.audit });
    try { const result = await work(tx); if (state.conflicts-- > 0) throw { code: 'P2034' }; return result; }
    catch (error) { state.rows = before.rows; state.audit = before.audit; throw error; }
  } });
  return { state, service };
}

test('RF005 strict inputs reject privilege/identity/state fields, invalid zone, empty PATCH and query', () => {
  for (const input of [{ name: '' }, { name: 'A', timeZone: 'Invalid/Zone' }, { name: 'A', timeZone: '+02:00' }, ...['id','userId','institutionId','scope','roles','permissions','status','deletedAt'].map(key => ({ name: 'A', [key]: 'GLOBAL' }))]) {
    assert.throws(() => parseInstitutionAdministration(createInstitutionSchema, input, {}), status(400));
  }
  for (const body of [{}, { timeZone: 'UTC' }, { status: 'INACTIVE' }]) assert.throws(() => parseInstitutionAdministration(updateInstitutionSchema, body, {}), status(400));
  assert.throws(() => parseInstitutionAdministration(createInstitutionSchema, { name: 'A' }, { userId: actor }), status(400));
  assert.deepEqual(parseInstitutionAdministration(createInstitutionSchema, { name: ' A ', contactEmail: 'A@Example.Test' }, {}), { name: 'A', contactEmail: 'a@example.test' });
  assert.throws(() => institutionAdministrationContext({ principal: { userId: actor }, authorization: { ...context, userId: id } }), status(401));
});
test('RF005 create/update use authenticated actor, internal ACTIVE and controlled DTO; no role grants', async () => {
  const { service, state } = fixture();
  const result = await service.create({ name: 'Institution' }, context);
  assert.equal(result.data.status, 'ACTIVE'); assert.equal(result.data.deletedAt, undefined); assert.equal(result.data.roleAssignments, undefined);
  assert.match(result.data.createdAt, /Z$/);
  await service.update(result.data.id, { name: 'Updated' }, context);
  assert.equal(state.rows[0].name, 'Updated');
  assert.deepEqual(state.audit.map(row => [row.actionCode, row.actorUserId]), [['INSTITUTION_CREATED', actor], ['INSTITUTION_UPDATED', actor]]);
});
test('RF005 GLOBAL alone does not grant rights; institutional context and unavailable users denied', async () => {
  const { service, state } = fixture(); state.permissions = [];
  await assert.rejects(service.create({ name: 'Denied' }, context), status(403));
  state.permissions = codes;
  for (const scoped of [{ institutionId: id }, { branchId: id }]) await assert.rejects(service.list({ ...context, ...scoped }), status(403));
  state.user = null; await assert.rejects(service.list(context), status(401)); assert.equal(state.rows.length, 0);
});
test('RF005 resolution does not give institutional permissions to an unscoped GLOBAL role', async () => {
  const role = (scope, permissions) => ({ active: true, institutionId: id, branchId: null, validFrom: null, validTo: null,
    role: { code: scope, scope, active: true, permissions: permissions.map(code => ({ permission: { code } })) } });
  const auth = new AuthorizationService({ userRole: { findMany: async () => [role('GLOBAL', []), role('INSTITUTION', codes)] } });
  const resolved = await auth.resolveForUser(actor, {});
  assert.deepEqual(resolved.roleCodes, ['GLOBAL']); assert.deepEqual(resolved.permissions, []);
});
test('RF005 read-only global capabilities come from actual grants, not request permission claims', async () => {
  const { service, state } = fixture(); state.permissions = ['institutions.read'];
  const result = await service.list({ ...context, permissions: codes });
  assert.deepEqual(result, { data: [], permissions: { create: false, update: false } });
  await assert.rejects(service.create({ name: 'Denied' }, context), status(403));
});
test('RF005 missing/deleted institution gives 404 and no audit', async () => {
  const { service, state } = fixture();
  await assert.rejects(service.update(id, { name: 'Missing' }, context), status(404)); assert.equal(state.audit.length, 0);
});
test('RF005 audit failure rolls back creation and update; internal error sanitized', async () => {
  const { service, state } = fixture();
  const created = await service.create({ name: 'Original' }, context); state.failure = new Error('PRIVATE SQL SECRET');
  await assert.rejects(service.create({ name: 'Rollback' }, context), error => error.getStatus() === 500 && !JSON.stringify(error.getResponse()).includes('SECRET'));
  await assert.rejects(service.update(created.data.id, { name: 'Rollback' }, context), status(500));
  assert.equal(state.rows.length, 1); assert.equal(state.rows[0].name, 'Original'); assert.equal(state.audit.length, 1);
});
test('RF005 recognized conflicts retry entire transaction once; unrelated errors do not retry', async () => {
  const f = fixture(); f.state.conflicts = 1; await f.service.create({ name: 'Retry' }, context);
  assert.equal(f.state.transactions, 2); assert.equal(f.state.rows.length, 1); assert.equal(f.state.audit.length, 1);
  const g = fixture(); g.state.conflicts = 3; await assert.rejects(g.service.create({ name: 'Conflict' }, context), status(409));
  assert.equal(g.state.transactions, 2); assert.equal(g.state.rows.length, 0);
  const h = fixture(); h.state.failure = { code: '23505' }; await assert.rejects(h.service.create({ name: 'Unexpected' }, context), status(500));
  assert.equal(h.state.transactions, 1);
});
test('RF005 Prisma unique violation becomes sanitized 409', async () => {
  const f = fixture(); f.state.failure = new Prisma.PrismaClientKnownRequestError('PRIVATE', { code: 'P2002', clientVersion: '7.10.0', meta: { modelName: 'Institution' } });
  await assert.rejects(f.service.create({ name: 'Duplicate' }, context), status(409));
  assert.equal(f.state.rows.length, 0);
});
