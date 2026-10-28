import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test, mock } from 'node:test';
import { GUARDS_METADATA } from '@nestjs/common/constants.js';
import { ReassignmentsController } from '../dist/reassignments/reassignments.controller.js';
import { ReassignmentListingService } from '../dist/reassignments/reassignment-listing.service.js';
import { decodeReassignmentCursor, encodeReassignmentCursor, parseReassignmentListingQuery } from '../dist/reassignments/reassignment-listing.schemas.js';
import { REQUIRE_PERMISSIONS_KEY } from '../dist/authorization/decorators/require-permissions.decorator.js';

const context = { userId: randomUUID(), institutionId: randomUUID(), permissions: ['reassignments.read'], roleCodes: [] };
const status = (code) => (error) => error.getStatus?.() === code;
const at = new Date('2026-10-26T12:00:00.000Z');

function row(overrides = {}) {
  const institutionId = context.institutionId; const serviceId = randomUUID(); const branchId = randomUUID(); const slotId = randomUUID(); const appointmentId = randomUUID();
  return {
    id: randomUUID(), institutionId, serviceId, agendaSlotId: slotId, appointmentId, originCancellationId: randomUUID(),
    status: 'OFFERING', detectedAt: at, startedAt: at, finishedAt: null, closureReasonCode: null,
    service: { id: serviceId, name: 'Servicio', institutionId },
    agendaSlot: { id: slotId, startsAt: at, endsAt: new Date('2026-10-26T12:30:00.000Z'),
      availability: { serviceId, branch: { id: branchId, name: 'Sede', institutionId } } },
    appointment: { id: appointmentId, institutionId, agendaSlotId: slotId, serviceId, branchId },
    originCancellation: { appointmentId }, candidates: [], offers: [],
    ...overrides,
  };
}

function fixture(rows = [], anchors = new Map()) {
  const db = { reassignment: {
    findFirst: mock.fn(async ({ where }) => {
      const candidate = anchors.get(where.id) ?? rows.find((item) => item.id === where.id);
      if (!candidate || candidate.institutionId !== where.institutionId || (where.status && candidate.status !== where.status)) return null;
      return candidate;
    }),
    findMany: mock.fn(async ({ cursor, take }) => {
      const index = cursor ? rows.findIndex((item) => item.id === cursor.id) + 1 : 0;
      return rows.slice(index, index + take);
    }),
  } };
  return { db, service: new ReassignmentListingService(db) };
}

test('listing controller has institutional guards and read permission', () => {
  assert.deepEqual(Reflect.getMetadata(GUARDS_METADATA, ReassignmentsController.prototype.list).map((item) => item.name),
    ['AccessTokenGuard', 'AuthorizationContextGuard', 'PermissionsGuard']);
  assert.deepEqual(Reflect.getMetadata(REQUIRE_PERMISSIONS_KEY, ReassignmentsController.prototype.list), ['reassignments.read']);
});

test('listing query accepts only real statuses with default/max limit and empty body', () => {
  assert.deepEqual(parseReassignmentListingQuery({}, undefined), { limit: 50 });
  assert.deepEqual(parseReassignmentListingQuery({ status: 'FAILED', limit: '100' }, {}), { status: 'FAILED', limit: 100 });
  for (const query of [{ status: 'ACTIVE' }, { status: 'PENDING', limit: '101' }, { limit: '0' }, { limit: '01' },
    { institutionId: randomUUID() }, { branchId: randomUUID() }, { userId: randomUUID() }, { offset: '1' }]) {
    assert.throws(() => parseReassignmentListingQuery(query, undefined), status(400));
  }
  assert.throws(() => parseReassignmentListingQuery({}, { force: true }), status(400));
});

test('listing cursor is canonical, opaque and rejects invalid values', () => {
  const point = { id: randomUUID() };
  const cursor = encodeReassignmentCursor(point);
  assert.deepEqual(decodeReassignmentCursor(cursor), point);
  assert.deepEqual(JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')), { v: 1, id: point.id });
  for (const value of ['', '!', cursor + '=', 'a'.repeat(301), Buffer.from('{}').toString('base64url'),
    Buffer.from(JSON.stringify({ v: 1, id: point.id, at: at.toISOString() })).toString('base64url')]) {
    assert.throws(() => decodeReassignmentCursor(value), status(400));
  }
});

test('listing scopes institution, branch, status and cursor with deterministic bounded query', async () => {
  const anchor = row(); const { db, service } = fixture([], new Map([[anchor.id, anchor]]));
  const branchId = randomUUID();
  anchor.agendaSlot.availability.branch.id = branchId;
  anchor.appointment.branchId = branchId;
  await service.find(parseReassignmentListingQuery({ status: 'OFFERING', limit: '2', cursor: encodeReassignmentCursor(anchor) }, undefined),
    { ...context, branchId });
  const anchorArgs = db.reassignment.findFirst.mock.calls[0].arguments[0];
  assert.equal(anchorArgs.where.id, anchor.id);
  assert.equal(anchorArgs.where.status, 'OFFERING');
  const args = db.reassignment.findMany.mock.calls[0].arguments[0];
  assert.equal(args.take, 3);
  assert.deepEqual(args.orderBy, [{ detectedAt: 'desc' }, { id: 'desc' }]);
  assert.deepEqual(args.cursor, { id: anchor.id }); assert.equal(args.skip, 1);
  assert.equal(args.where.institutionId, context.institutionId);
  assert.equal(args.where.status, 'OFFERING');
  assert.equal(args.where.service.institutionId, context.institutionId);
  assert.equal(args.where.appointment.institutionId, context.institutionId);
  assert.deepEqual(args.where.agendaSlot, { availability: { branch: { institutionId: context.institutionId, id: branchId } } });
  assert.equal(args.where.OR, undefined);
});

test('listing returns a controlled summary, next cursor and makes no writes', async () => {
  const first = row(); const second = row({ detectedAt: new Date('2026-10-26T11:00:00.000Z') }); const extra = row({ detectedAt: new Date('2026-10-26T10:00:00.000Z') });
  const { db, service } = fixture([first, second, extra]);
  const result = await service.find(parseReassignmentListingQuery({ limit: '2' }, undefined), context);
  assert.equal(result.data.length, 2);
  assert.equal(result.page.nextCursor, encodeReassignmentCursor(second));
  assert.deepEqual(Object.keys(result.data[0]).sort(), ['id', 'status', 'detectedAt', 'startedAt', 'finishedAt', 'closureReasonCode', 'branch', 'service', 'agendaSlot'].sort());
  assert.deepEqual(Object.keys(db.reassignment.findMany.mock.calls[0].arguments[0].select).sort(),
    ['id', 'institutionId', 'serviceId', 'agendaSlotId', 'appointmentId', 'originCancellationId', 'status', 'detectedAt', 'startedAt', 'finishedAt', 'closureReasonCode', 'service', 'agendaSlot', 'appointment', 'originCancellation', 'candidates', 'offers'].sort());
  assert.equal(db.reassignment.create, undefined);
  assert.equal(db.reassignment.update, undefined);
});

test('ID cursor does not serialize a timestamp; PostgreSQL precision requires integration coverage', async () => {
  const anchor = row(); const after = row();
  const { db, service } = fixture([after], new Map([[anchor.id, anchor]]));
  await service.find(parseReassignmentListingQuery({ cursor: encodeReassignmentCursor(anchor) }, undefined), context);
  const args = db.reassignment.findMany.mock.calls[0].arguments[0];
  assert.deepEqual(args.cursor, { id: anchor.id }); assert.equal(args.skip, 1);
  assert.equal(JSON.stringify(args.cursor).includes('detectedAt'), false);
  assert.equal(encodeReassignmentCursor(anchor).includes(at.toISOString()), false);
});

test('same detectedAt rows retain the UUID tie-breaker in the Prisma request', async () => {
  const sameInstant = new Date('2026-10-26T12:00:00.000Z');
  const anchor = row({ detectedAt: sameInstant }); const next = row({ detectedAt: sameInstant });
  const { db, service } = fixture([next], new Map([[anchor.id, anchor]]));
  const result = await service.find(parseReassignmentListingQuery({ cursor: encodeReassignmentCursor(anchor) }, undefined), context);
  assert.deepEqual(result.data.map((item) => item.id), [next.id]);
  const args = db.reassignment.findMany.mock.calls[0].arguments[0];
  assert.deepEqual(args.orderBy, [{ detectedAt: 'desc' }, { id: 'desc' }]);
  assert.deepEqual(args.cursor, { id: anchor.id });
});

test('cursor must exist and remain in the authorized tenant, branch and status scope', async () => {
  const anchor = row(); const cursor = encodeReassignmentCursor(anchor);
  for (const anchors of [new Map(), new Map([[anchor.id, row({ institutionId: randomUUID() })]]), new Map([[anchor.id, row({ status: 'COMPLETED' })]])]) {
    const { db, service } = fixture([], anchors);
    await assert.rejects(service.find(parseReassignmentListingQuery({ status: 'OFFERING', cursor }, undefined), context), status(404));
    assert.equal(db.reassignment.findMany.mock.callCount(), 0);
  }
});

test('historically inconsistent rows are suppressed without exposing their internal fields', async () => {
  const valid = row(); const inconsistent = row({ appointment: { ...row().appointment, institutionId: context.institutionId, agendaSlotId: randomUUID() } });
  const { service } = fixture([valid, inconsistent]);
  const result = await service.find(parseReassignmentListingQuery({}, undefined), context);
  assert.deepEqual(result.data.map((item) => item.id), [valid.id]);
  assert.equal(JSON.stringify(result).includes('appointmentId'), false);
});

test('listing fills pages across inconsistent batches and repeats tenant, branch and status filters', async () => {
  const branchId = randomUUID();
  const rows = Array.from({ length: 10 }, (_, index) => {
    const record = row({ detectedAt: new Date(at.getTime() - index * 1_000) });
    record.agendaSlot.availability.branch.id = branchId;
    record.appointment.branchId = index < 6 ? randomUUID() : branchId;
    return record;
  });
  const { db, service } = fixture(rows);
  const query = { status: 'OFFERING', limit: 2 };
  const scope = { ...context, branchId };
  const first = await service.find(query, scope);
  assert.deepEqual(first.data.map((item) => item.id), rows.slice(6, 8).map((item) => item.id));
  assert.equal(first.page.nextCursor, encodeReassignmentCursor(rows[7]));
  assert.equal(db.reassignment.findMany.mock.callCount(), 3);
  assert.deepEqual(db.reassignment.findMany.mock.calls.map((call) => call.arguments[0].cursor),
    [undefined, { id: rows[2].id }, { id: rows[5].id }]);
  const second = await service.find({ ...query, cursor: first.page.nextCursor }, scope);
  assert.deepEqual(second.data.map((item) => item.id), rows.slice(8).map((item) => item.id));
  assert.equal(second.page.nextCursor, null);
  assert.equal(new Set([...first.data, ...second.data].map((item) => item.id)).size, 4);
  for (const { arguments: [args] } of db.reassignment.findMany.mock.calls) {
    assert.equal(args.take, 3);
    assert.deepEqual(args.orderBy, [{ detectedAt: 'desc' }, { id: 'desc' }]);
    assert.deepEqual(args.where, {
      institutionId: context.institutionId, status: 'OFFERING',
      service: { institutionId: context.institutionId }, appointment: { institutionId: context.institutionId },
      agendaSlot: { availability: { branch: { institutionId: context.institutionId, id: branchId } } },
    });
    if (args.cursor) assert.equal(args.skip, 1);
  }
});

test('limit=1 emits reusable valid cursors even when batch boundaries are inconsistent', async () => {
  const rows = Array.from({ length: 5 }, (_, index) => {
    const record = row({ detectedAt: new Date(at.getTime() - index * 1_000) });
    if (index % 2) record.appointment.branchId = randomUUID();
    return record;
  });
  const { service } = fixture(rows);
  const seen = []; const cursors = [];
  let cursor;
  do {
    const page = await service.find({ limit: 1, ...(cursor ? { cursor } : {}) }, context);
    assert.equal(page.data.length, 1);
    seen.push(page.data[0].id);
    cursor = page.page.nextCursor;
    if (cursor) {
      assert.equal(decodeReassignmentCursor(cursor).id, page.data[0].id);
      assert.equal(cursors.includes(cursor), false);
      cursors.push(cursor);
    }
  } while (cursor);
  assert.deepEqual(seen, [rows[0].id, rows[2].id, rows[4].id]);
  assert.equal(new Set(seen).size, 3);
});

for (const validCount of [0, 1, 2]) test(`listing exhausts inconsistent tails and returns ${validCount} valid rows without an artificial cursor`, async () => {
  const valid = Array.from({ length: validCount }, () => row());
  const invalid = Array.from({ length: 8 }, () => {
    const record = row(); record.appointment.branchId = randomUUID(); return record;
  });
  const { db, service } = fixture([...invalid.slice(0, 4), ...valid, ...invalid.slice(4)]);
  const result = await service.find({ limit: 2 }, context);
  assert.deepEqual(result.data.map((item) => item.id), valid.map((item) => item.id));
  assert.equal(result.page.nextCursor, null);
  assert.ok(db.reassignment.findMany.mock.callCount() >= 3);
});

test('inconsistent anchors remain rejected even though internal scanning can pass inconsistent rows', async () => {
  const invalid = row(); invalid.appointment.branchId = randomUUID();
  const { db, service } = fixture([invalid, row()]);
  await assert.rejects(service.find({ limit: 1, cursor: encodeReassignmentCursor(invalid) }, context), status(404));
  assert.equal(db.reassignment.findMany.mock.callCount(), 0);
});

test('a later batch failure rejects the request instead of returning a partial page', async () => {
  const invalid = row(); invalid.appointment.branchId = randomUUID();
  let calls = 0;
  const db = { reassignment: { findMany: mock.fn(async () => {
    if (++calls === 1) return [row(), invalid];
    throw new Error('PRIVATE_SECOND_BATCH_FAILURE');
  }) } };
  await assert.rejects(new ReassignmentListingService(db).find({ limit: 1 }, context),
    (error) => error.getStatus?.() === 500 && !error.message.includes('PRIVATE_SECOND_BATCH_FAILURE'));
  assert.equal(db.reassignment.findMany.mock.callCount(), 2);
});

test('unexpected persistence failures are sanitized', async () => {
  const db = { reassignment: { findFirst: async () => null, findMany: async () => { throw new Error('PRIVATE_STORAGE_DETAIL'); } } };
  await assert.rejects(new ReassignmentListingService(db).find(parseReassignmentListingQuery({}, undefined), context),
    (error) => error.getStatus?.() === 500 && !String(error.message).includes('PRIVATE_STORAGE_DETAIL'));
});

test('listing handles empty data and rejects missing permission or institution before persistence', async () => {
  const { db, service } = fixture();
  assert.deepEqual(await service.find(parseReassignmentListingQuery({}, undefined), context), { data: [], page: { nextCursor: null } });
  for (const denied of [{ ...context, permissions: [] }, { ...context, institutionId: undefined }]) {
    await assert.rejects(service.find(parseReassignmentListingQuery({}, undefined), denied), status(403));
  }
  assert.equal(db.reassignment.findMany.mock.callCount(), 1);
});

test('listing controller rejects absent identity, body/query extras and missing institution', () => {
  const listing = { find: (query, authorization) => ({ query, authorization }) };
  const controller = new ReassignmentsController({}, {}, {}, listing);
  const request = { principal: { userId: randomUUID() }, authorization: context };
  assert.deepEqual(controller.list({ status: 'COMPLETED' }, undefined, request), { query: { status: 'COMPLETED', limit: 50 }, authorization: context });
  for (const [query, body, value, code] of [[{}, undefined, {}, 401], [{ userId: randomUUID() }, undefined, request, 400],
    [{ status: 'BAD' }, undefined, request, 400], [{}, { force: true }, request, 400], [{}, undefined, { ...request, authorization: { ...context, institutionId: undefined } }, 400]]) {
    assert.throws(() => controller.list(query, body, value), status(code));
  }
});
