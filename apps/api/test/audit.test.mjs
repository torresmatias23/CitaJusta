import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test, mock } from 'node:test';
import { GUARDS_METADATA } from '@nestjs/common/constants.js';
import { AuditService } from '../dist/audit/audit.service.js';
import { AuditController } from '../dist/audit/audit.controller.js';
import { parseAuditQuery, encodeCursor, decodeCursor } from '../dist/audit/audit.schemas.js';
import { REQUIRE_PERMISSIONS_KEY } from '../dist/authorization/decorators/require-permissions.decorator.js';

const context = { userId: randomUUID(), institutionId: randomUUID(), permissions: ['audit.read'], roleCodes: [] };
const event = { actorType: 'USER', actorUserId: context.userId, actionCode: 'AUTH_LOGIN_SUCCESS', resourceType: 'AUTH', outcome: 'SUCCESS' };
const status = (code) => (error) => error.getStatus?.() === code;
function fixture() {
  const db = { auditEvent: { create: mock.fn(async ({ data }) => ({ id: data.id })), findMany: mock.fn(async () => []) },
    branch: { findFirst: async () => ({ id: randomUUID() }) }, institution: { findUnique: async () => ({ timeZone: 'America/Santiago' }) } };
  return { db, service: new AuditService(db) };
}
test('audit read has all three guards and explicit permission', () => {
  assert.deepEqual(Reflect.getMetadata(GUARDS_METADATA, AuditController).map((item) => item.name), ['AccessTokenGuard', 'AuthorizationContextGuard', 'PermissionsGuard']);
  assert.deepEqual(Reflect.getMetadata(REQUIRE_PERMISSIONS_KEY, AuditController.prototype.find), ['audit.read']);
});
test('record uses supplied root or transaction client, only minimal fields and DB timestamp', async () => {
  const root = fixture().db; const tx = fixture().db;
  await AuditService.record(root, event); await AuditService.record(tx, event);
  for (const db of [root, tx]) {
    assert.equal(db.auditEvent.create.mock.callCount(), 1);
    const data = db.auditEvent.create.mock.calls[0].arguments[0].data;
    assert.deepEqual(Object.keys(data).sort(), ['id', ...Object.keys(event)].sort());
    assert.equal(data.occurredAt, undefined);
  }
});
test('record rejects arbitrary bodies, secrets, states and branch without institution', async () => {
  const { db } = fixture();
  for (const extra of [{ password: 'secret' }, { email: 'private@example.com' }, { newState: 'private text' }, { reasonCode: 'private text' },
    { actionCode: 'ARBITRARY' }, { branchId: randomUUID() }]) await assert.rejects(AuditService.record(db, { ...event, ...extra }));
  assert.equal(db.auditEvent.create.mock.callCount(), 0);
});
test('query has strict dates, filters, default 50 and max 100', () => {
  assert.equal(parseAuditQuery({}, undefined).limit, 50);
  assert.equal(parseAuditQuery({ limit: '100', from: '2026-01-01' }, {}).limit, 100);
  for (const q of [{ limit: '101' }, { limit: '0' }, { limit: '-1' }, { limit: '1.5' }, { limit: ['5'] },
    { from: '2026-02-30' }, { from: '2026-02-01', to: '2026-01-01' }, { branchId: 'x' }, { actorUserId: 'x' },
    { action: 'x' }, { resourceType: 'x' }, { cursor: '' }, { institutionId: randomUUID() }, { userId: randomUUID() }, { offset: '1' }]) {
    assert.throws(() => parseAuditQuery(q, undefined), status(400));
  }
  assert.throws(() => parseAuditQuery({}, { token: 'private' }), status(400));
});
test('cursor round-trips exact millisecond timestamp/id and rejects invalid or noncanonical input', () => {
  const point = { id: randomUUID(), occurredAt: new Date('2026-09-16T12:34:56.789Z') };
  const encoded = encodeCursor(point); assert.deepEqual(decodeCursor(encoded), point);
  for (const bad of ['', '!', encoded + '=', 'a'.repeat(301), Buffer.from('{}').toString('base64url'),
    Buffer.from(JSON.stringify({ v: 1, at: '2026-09-16T12:34:56.789123Z', id: point.id })).toString('base64url')]) assert.throws(() => decodeCursor(bad), status(400));
});
test('scope, filters and cursor remain conjunctive; ordering stable and take bounded', async () => {
  const { db, service } = fixture(); const branchId = randomUUID(); const point = { id: randomUUID(), occurredAt: new Date() };
  const query = parseAuditQuery({ branchId, actorUserId: context.userId, action: 'AUTH_LOGIN_SUCCESS', resourceType: 'AUTH', cursor: encodeCursor(point) });
  await service.find(query, { ...context, branchId });
  const args = db.auditEvent.findMany.mock.calls[0].arguments[0];
  assert.equal(args.take, 51); assert.deepEqual(args.orderBy, [{ occurredAt: 'desc' }, { id: 'desc' }]);
  assert.equal(args.where.institutionId, context.institutionId); assert.equal(args.where.branchId, branchId);
  assert.equal(args.where.actorUserId, context.userId); assert.equal(args.where.actionCode, query.action);
  assert.deepEqual(args.where.OR, [{ occurredAt: { lt: point.occurredAt } }, { occurredAt: point.occurredAt, id: { lt: point.id } }]);
  await assert.rejects(service.find(query, { ...context, branchId: randomUUID() }), status(404));
  await assert.rejects(service.find(query, { ...context, institutionId: undefined, branchId }), status(400));
});
test('uncontextualized GLOBAL read includes null events, selected institution always restricts', async () => {
  const { db, service } = fixture();
  await service.find(parseAuditQuery({}), { ...context, institutionId: undefined });
  assert.equal(db.auditEvent.findMany.mock.calls[0].arguments[0].where.institutionId, undefined);
  await service.find(parseAuditQuery({}), context);
  assert.equal(db.auditEvent.findMany.mock.calls[1].arguments[0].where.institutionId, context.institutionId);
});
test('controlled select, next cursor from last returned row and no write during GET', async () => {
  const { db, service } = fixture();
  const rows = Array.from({ length: 3 }, () => ({ id: randomUUID(), occurredAt: new Date(), ...event }));
  db.auditEvent.findMany.mock.mockImplementation(async () => rows);
  const result = await service.find(parseAuditQuery({ limit: '2' }), context);
  assert.equal(result.data.length, 2); assert.equal(result.page.nextCursor, encodeCursor(rows[1]));
  assert.equal(db.auditEvent.create.mock.callCount(), 0);
  assert.deepEqual(Object.keys(db.auditEvent.findMany.mock.calls[0].arguments[0].select).sort(),
    ['id', 'institutionId', 'branchId', 'actorUserId', 'actorType', 'actionCode', 'resourceType', 'resourceId', 'outcome', 'previousState', 'newState', 'reasonCode', 'occurredAt'].sort());
});
