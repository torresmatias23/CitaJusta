import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mock, test } from 'node:test';
import { GUARDS_METADATA } from '@nestjs/common/constants.js';
import { REQUIRE_PERMISSIONS_KEY } from '../dist/authorization/decorators/require-permissions.decorator.js';
import { encodeInstitutionalCursor, decodeInstitutionalCursor } from '../dist/common/institutional-listing.schemas.js';
import { InstitutionalUsersController } from '../dist/users/institutional-users.controller.js';
import { InstitutionalUsersService } from '../dist/users/institutional-users.service.js';
import { parseInstitutionalUsersQuery } from '../dist/users/institutional-users.schemas.js';
import { InstitutionalWaitlistController } from '../dist/waitlist/institutional-waitlist.controller.js';
import { InstitutionalWaitlistService } from '../dist/waitlist/institutional-waitlist.service.js';
import { parseInstitutionalWaitlistQuery } from '../dist/waitlist/institutional-waitlist.schemas.js';

const institutionId = randomUUID(), branchId = randomUUID(), serviceId = randomUUID(), userId = randomUUID();
const context = { userId, institutionId, roleCodes: [], permissions: ['users.read', 'waitlist.read'] };
const status = code => error => error.getStatus?.() === code;
const user = () => ({ id: randomUUID(), firstNames: 'Ana', lastNames: 'Pérez', email: 'private@example.test', passwordHash: 'secret' });
const entry = () => ({ id: randomUUID(), enteredAt: new Date('2026-11-01T12:00:00Z'),
  status: { code: 'ACTIVE', name: 'Activa' }, user: user(), service: { id: serviceId, name: 'Servicio' },
  branch: { id: branchId, name: 'Sede' }, operationalNote: 'private note' });
function fixture(rows = [], anchor = null) {
  const collection = { findFirst: mock.fn(async () => anchor), findMany: mock.fn(async () => rows) };
  const db = { user: collection, waitlistEntry: collection,
    branch: { findFirst: mock.fn(async () => ({ id: branchId })) },
    service: { findFirst: mock.fn(async () => ({ id: serviceId })) } };
  return { db, collection, users: new InstitutionalUsersService(db), waitlist: new InstitutionalWaitlistService(db) };
}

for (const [resource, Controller, parse, method, permission] of [
  ['users', InstitutionalUsersController, parseInstitutionalUsersQuery, 'users', 'users.read'],
  ['waitlist', InstitutionalWaitlistController, parseInstitutionalWaitlistQuery, 'waitlist', 'waitlist.read'],
]) {
  test(`${resource}: dedicated permission and existing three guards protect the controller`, () => {
    assert.deepEqual(Reflect.getMetadata(GUARDS_METADATA, Controller).map(item => item.name),
      ['AccessTokenGuard', 'AuthorizationContextGuard', 'PermissionsGuard']);
    assert.deepEqual(Reflect.getMetadata(REQUIRE_PERMISSIONS_KEY, Controller.prototype.find), [permission]);
    const controller = new Controller({ find: () => { throw new Error('must not query'); } });
    for (const request of [{}, { principal: { userId } }, { principal: { userId: randomUUID() }, authorization: context }]) {
      assert.throws(() => controller.find({}, undefined, request), status(401));
    }
  });

  test(`${resource}: strict query, body and page boundaries`, () => {
    assert.deepEqual(parse({}, undefined), { limit: 50 });
    assert.equal(parse({ limit: '100', branchId }, {}).limit, 100);
    for (const query of [{ limit: '0' }, { limit: '101' }, { limit: '01' }, { limit: '-1' }, { limit: '1.5' },
      { limit: ['1', '2'] }, { branchId: 'bad' }, { institutionId }, { offset: '5' }, { role: 'GLOBAL' }]) {
      assert.throws(() => parse(query, undefined), status(400));
    }
    for (const body of [null, [], { userId }, 'text']) assert.throws(() => parse({}, body), status(400));
  });

  test(`${resource}: canonical cursors cannot cross resource types`, () => {
    const cursor = encodeInstitutionalCursor(resource, userId);
    assert.deepEqual(parse({ cursor }, undefined).cursor, { id: userId });
    for (const value of ['', 'bad!', cursor + '=', 'x'.repeat(301),
      encodeInstitutionalCursor(resource === 'users' ? 'waitlist' : 'users', userId),
      Buffer.from(JSON.stringify({ v: 1, resource, id: userId, extra: true })).toString('base64url')]) {
      assert.throws(() => decodeInstitutionalCursor(resource, value), status(400));
    }
  });

  test(`${resource}: permission, explicit institution and branch cannot be bypassed`, async () => {
    const f = fixture();
    await assert.rejects(f[method].find(parse({}, undefined), { ...context, permissions: ['agenda.read', 'reassignments.read', 'professionals.create'] }), status(403));
    await assert.rejects(f[method].find(parse({}, undefined), { ...context, institutionId: undefined }), status(400));
    await assert.rejects(f[method].find(parse({ branchId: randomUUID() }, undefined), { ...context, branchId }), status(404));
    assert.equal(f.collection.findMany.mock.calls.length, 0);
    f.db.branch.findFirst = mock.fn(async () => null);
    await assert.rejects(f[method].find(parse({ branchId }, undefined), context), status(404));
    assert.deepEqual(f.db.branch.findFirst.mock.calls[0].arguments[0].where, { id: branchId, institutionId });
    assert.equal(f.collection.findMany.mock.calls.length, 0);
  });

  test(`${resource}: cursor anchor must remain in the same authorized query`, async () => {
    const f = fixture();
    const query = parse({ cursor: encodeInstitutionalCursor(resource, randomUUID()) }, undefined);
    await assert.rejects(f[method].find(query, context), status(404));
    assert.equal(f.collection.findMany.mock.calls.length, 0);
    assert.deepEqual(f.collection.findFirst.mock.calls[0].arguments[0].where.AND[1], query.cursor);
  });

  test(`${resource}: empty/final pages and storage errors are sanitized`, async () => {
    const f = fixture();
    assert.deepEqual(await f[method].find(parse({}, undefined), context), { data: [], page: { nextCursor: null } });
    f.collection.findMany = async () => { throw new Error('private SQL or connection string'); };
    await assert.rejects(f[method].find(parse({}, undefined), context), error => {
      assert.equal(error.getStatus(), 500);
      assert.equal(JSON.stringify(error.getResponse()).includes('private'), false);
      assert.equal(error.cause, undefined);
      return true;
    });
  });
}

test('users: name search rejects empty/oversized and unsupported identity filters', () => {
  assert.equal(parseInstitutionalUsersQuery({ q: ' Ana Pérez ' }, undefined).q, 'Ana Pérez');
  for (const query of [{ q: ' ' }, { q: 'a' }, { q: 'x'.repeat(121) }, { q: ['Ana'] }, { email: 'person@example.test' }, { userId }]) {
    assert.throws(() => parseInstitutionalUsersQuery(query, undefined), status(400));
  }
});

test('users: every membership alternative is scoped and role membership is time/scope constrained', async () => {
  const f = fixture();
  await f.users.find(parseInstitutionalUsersQuery({}, undefined), { ...context, branchId });
  const args = f.collection.findMany.mock.calls[0].arguments[0];
  const membership = args.where.AND[0];
  assert.equal(membership.deletedAt, null);
  const [appointments, waits, professionals, roles] = membership.OR;
  assert.equal(appointments.appointments.some.institutionId, institutionId);
  assert.equal(appointments.appointments.some.branchId, branchId);
  assert.equal(appointments.appointments.some.agendaSlot.availability.branchId, branchId);
  for (const name of ['branch', 'service', 'professional']) assert.equal(appointments.appointments.some[name].institutionId, institutionId);
  assert.equal(waits.waitlistEntries.some.institutionId, institutionId);
  assert.equal(waits.waitlistEntries.some.branchId, branchId);
  assert.equal(professionals.professionalProfiles.some.institutionId, institutionId);
  assert.equal(professionals.professionalProfiles.some.branchAssignments.some.branchId, branchId);
  const grant = roles.roleAssignments.some;
  assert.equal(grant.active, true); assert.equal(grant.role.active, true);
  assert.ok(grant.AND[0].OR[1].validFrom.lte instanceof Date);
  assert.ok(grant.AND[1].OR[1].validTo.gte instanceof Date);
  assert.equal(grant.AND[2].role.scope, 'BRANCH');
  assert.equal(grant.AND[2].branch.institutionId, institutionId);
});

test('users: name terms are ANDed with membership, wildcards are escaped, PII is omitted', async () => {
  const rows = [user(), user(), user()], f = fixture(rows, { id: userId });
  const query = parseInstitutionalUsersQuery({ q: 'Ana %_', limit: '2', cursor: encodeInstitutionalCursor('users', userId) }, undefined);
  const response = await f.users.find(query, context);
  const args = f.collection.findMany.mock.calls[0].arguments[0];
  assert.equal(args.where.AND[1].OR[0].firstNames.contains, 'Ana');
  assert.equal(args.where.AND[2].OR[0].firstNames.contains, '\\%\\_');
  assert.equal(args.where.AND[1].OR[0].firstNames.mode, 'insensitive');
  assert.deepEqual(args.orderBy, { id: 'asc' }); assert.equal(args.take, 3);
  assert.deepEqual(args.cursor, { id: userId }); assert.equal(args.skip, 1);
  assert.deepEqual(f.collection.findFirst.mock.calls[0].arguments[0].where.AND[0], args.where);
  assert.deepEqual(args.select, { id: true, firstNames: true, lastNames: true });
  assert.equal(response.data.length, 2);
  for (const row of response.data) assert.deepEqual(Object.keys(row).sort(), ['firstNames', 'id', 'lastNames']);
  assert.equal(response.page.nextCursor, encodeInstitutionalCursor('users', rows[1].id));
  assert.equal(JSON.stringify(response).includes('secret'), false);
});

test('waitlist: existing catalog codes and UUID filters are strict', () => {
  assert.deepEqual(parseInstitutionalWaitlistQuery({ status: 'WITHDRAWN', serviceId, userId }, undefined), { status: 'WITHDRAWN', serviceId, userId, limit: 50 });
  for (const query of [{ status: '' }, { status: 'x'.repeat(61) }, { status: ['ACTIVE'] }, { userId: 'bad' }, { serviceId: 'bad' }, { priorityId: randomUUID() }]) {
    assert.throws(() => parseInstitutionalWaitlistQuery(query, undefined), status(400));
  }
});

test('waitlist: branch scope excludes unassigned entries and enforces relation ownership', async () => {
  const f = fixture();
  await f.waitlist.find(parseInstitutionalWaitlistQuery({ status: 'FULFILLED', serviceId, userId }, undefined), { ...context, branchId });
  const where = f.collection.findMany.mock.calls[0].arguments[0].where;
  assert.equal(where.institutionId, institutionId); assert.equal(where.branchId, branchId);
  assert.deepEqual(where.branch, { institutionId }); assert.deepEqual(where.service, { institutionId });
  assert.deepEqual(where.priority, { institutionId }); assert.equal(where.deletedAt, null);
  assert.deepEqual(where.user, { deletedAt: null }); assert.equal(where.userId, userId);
  assert.equal(where.serviceId, serviceId); assert.deepEqual(where.status, { code: 'FULFILLED' });
  assert.equal(where.OR, undefined);
  const serviceWhere = f.db.service.findFirst.mock.calls[0].arguments[0].where;
  assert.equal(serviceWhere.institutionId, institutionId);
  assert.equal(serviceWhere.branchAssignments.some.branchId, branchId);
});

test('waitlist: institution may see branchless records, foreign service IDs fail uniformly', async () => {
  const f = fixture();
  await f.waitlist.find(parseInstitutionalWaitlistQuery({}, undefined), context);
  assert.deepEqual(f.collection.findMany.mock.calls[0].arguments[0].where.OR, [{ branchId: null }, { branch: { institutionId } }]);
  f.db.service.findFirst = async () => null;
  await assert.rejects(f.waitlist.find(parseInstitutionalWaitlistQuery({ serviceId }, undefined), context), status(404));
  assert.equal(f.collection.findMany.mock.calls.length, 1);
});

test('waitlist: minimal DTO and bounded cursor page preserve null branches and timestamps', async () => {
  const rows = [entry(), { ...entry(), branch: null }, entry()], f = fixture(rows, { id: userId });
  const response = await f.waitlist.find(parseInstitutionalWaitlistQuery({ limit: '2', cursor: encodeInstitutionalCursor('waitlist', userId) }, undefined), context);
  const args = f.collection.findMany.mock.calls[0].arguments[0];
  assert.equal(args.take, 3); assert.deepEqual(args.orderBy, [{ enteredAt: 'desc' }, { id: 'desc' }]);
  assert.deepEqual(args.cursor, { id: userId }); assert.equal(args.skip, 1);
  assert.deepEqual(f.collection.findFirst.mock.calls[0].arguments[0].where.AND[0], args.where);
  assert.equal(response.data[1].branch, null);
  assert.equal(response.data[0].enteredAt, rows[0].enteredAt.toISOString());
  assert.deepEqual(Object.keys(response.data[0]).sort(), ['branch', 'enteredAt', 'id', 'service', 'status', 'user']);
  assert.deepEqual(Object.keys(response.data[0].user).sort(), ['firstNames', 'id', 'lastNames']);
  assert.equal(response.page.nextCursor, encodeInstitutionalCursor('waitlist', rows[1].id));
  assert.equal(JSON.stringify(response).includes('private'), false);
  assert.equal(args.select.operationalNote, undefined); assert.equal(args.select.user.select.email, undefined);
});
