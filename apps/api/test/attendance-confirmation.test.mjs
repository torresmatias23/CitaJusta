import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mock, test } from 'node:test';
import { RequestMethod } from '@nestjs/common';
import { GUARDS_METADATA, HTTP_CODE_METADATA, METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { Prisma } from '../dist/generated/prisma/client.js';
import { AttendanceConfirmationService } from '../dist/appointments/attendance-confirmation.service.js';
import { confirmationStates, publicConfirmation } from '../dist/appointments/attendance-confirmation.policy.js';
import { AppointmentsController } from '../dist/appointments/appointments.controller.js';
import { parseAttendanceConfirmationInput } from '../dist/appointments/appointments.schemas.js';
import { AuthorizationContextGuard } from '../dist/authorization/authorization-context.guard.js';
import { PermissionsGuard } from '../dist/authorization/permissions.guard.js';

const principal = { userId: randomUUID(), sessionId: randomUUID() };
const context = { userId: principal.userId, roleCodes: [], permissions: [] };
const hasStatus = status => error => error?.getStatus?.() === status;
function fixture(options = {}) {
  const institutionId = randomUUID();
  const row = { id: randomUUID(), institutionId, agendaSlotId: randomUUID(), branchId: randomUUID(), serviceId: randomUUID(), professionalId: randomUUID(),
    startsAt: new Date(Date.now() + 3600000), endsAt: new Date(Date.now() + 5400000),
    status: { code: 'AGENDADA', active: true, isFinal: false, allowsConfirmation: true },
    service: { institutionId, requiresConfirmation: true }, branch: { institutionId }, professional: { institutionId } };
  let state = { confirmations: options.confirmedAt ? [options.confirmedAt] : [], audits: [] };
  const queries = [], slotQueries = [];
  const prisma = { $transaction: mock.fn(async (operation, config) => {
    assert.equal(config.isolationLevel, 'Serializable'); const working = structuredClone(state);
    if (options.conflicts-- > 0) throw new Prisma.PrismaClientKnownRequestError('private SQL', { code: 'P2034', clientVersion: '7.10.0' });
    const result = await operation({ user: { findFirst: async args => { assert.deepEqual(args.where, { id: principal.userId, status: 'ACTIVE', deletedAt: null }); return options.inactive ? null : { id: principal.userId }; } },
      appointment: { findFirst: async args => { assert.equal(args.where.userId, principal.userId); return row; } },
      agendaSlot: { findMany: async args => { slotQueries.push(args); return options.invalidSlot ? [] : [{ id: row.agendaSlotId, availability: { attentionPointId: null }, appointment: { attentionPointId: null } }]; } },
      $queryRaw: async query => {
        queries.push(query);
        if (query.sql.includes('FOR UPDATE')) return options.missing ? [] : [{ id: row.id }];
        if (query.sql.includes('LEFT JOIN LATERAL')) return [{ id: row.id, confirmedAt: working.confirmations[0] ?? null, ownershipValid: !options.invalidOwnership }];
        assert.match(query.sql, /INSERT INTO confirmaciones/); assert.match(query.sql, /inicio_at > \(clock_timestamp\(\)/);
        if (options.insertFailure) throw new TypeError('private input');
        if (options.deadlineCrossed) return [];
        const confirmedAt = new Date(); working.confirmations.push(confirmedAt); return [{ confirmedAt }];
      }, auditEvent: { create: async ({ data }) => { if (options.failAudit) throw new Error('private audit failure'); working.audits.push(data); return { id: data.id }; } },
    });
    state = working; return result;
  }) };
  return { row, queries, slotQueries, prisma, service: new AttendanceConfirmationService(prisma), state: () => state };
}

test('RF016 route is authenticated POST 200 with context guards and only the principal/context', async () => {
  const confirm = mock.fn(async () => ({ data: {} })), controller = new AppointmentsController({}, {}, { confirm });
  const handler = AppointmentsController.prototype.confirmAttendance, appointmentId = randomUUID();
  assert.equal(Reflect.getMetadata(PATH_METADATA, handler), ':appointmentId/confirm-attendance');
  assert.equal(Reflect.getMetadata(METHOD_METADATA, handler), RequestMethod.POST); assert.equal(Reflect.getMetadata(HTTP_CODE_METADATA, handler), 200);
  assert.deepEqual(Reflect.getMetadata(GUARDS_METADATA, handler), [AuthorizationContextGuard, PermissionsGuard]);
  await controller.confirmAttendance({ appointmentId }, {}, undefined, { principal, authorization: context });
  assert.deepEqual(confirm.mock.calls[0].arguments, [appointmentId, principal, context]);
  assert.throws(() => controller.confirmAttendance({ appointmentId }, {}, {}, {}), hasStatus(401));
});
test('RF016 strict UUID/empty payload/query rejects all client identity and policy fields', () => {
  const params = { appointmentId: randomUUID() };
  assert.deepEqual(parseAttendanceConfirmationInput(params, {}, undefined), params);
  for (const key of ['userId', 'institutionId', 'actorUserId', 'confirmed', 'channel', 'confirmedAt', 'comment']) {
    assert.throws(() => parseAttendanceConfirmationInput(params, {}, { [key]: 'private' }), hasStatus(400));
    assert.throws(() => parseAttendanceConfirmationInput(params, { [key]: 'private' }, {}), hasStatus(400));
  }
  for (const input of [{ appointmentId: 'bad' }, { ...params, userId: randomUUID() }]) assert.throws(() => parseAttendanceConfirmationInput(input, {}, {}), hasStatus(400));
});
test('RF016 positive confirmation and minimal audit are atomic; parent and slot are never updated', async () => {
  const f = fixture(), before = structuredClone(f.row);
  const response = await f.service.confirm(f.row.id, principal, context);
  assert.deepEqual(Object.keys(response.data).sort(), ['appointmentId', 'confirmed', 'confirmedAt'].sort());
  assert.equal(response.data.appointmentId, f.row.id); assert.equal(response.data.confirmed, true);
  assert.equal(response.data.confirmedAt, f.state().confirmations[0].toISOString());
  assert.deepEqual(f.row, before); assert.equal(f.state().audits.length, 1);
  assert.equal(f.state().audits[0].actionCode, 'APPOINTMENT_ATTENDANCE_CONFIRMED'); assert.equal(f.state().audits[0].actorUserId, principal.userId);
  assert.doesNotMatch(JSON.stringify(f.state().audits), /phone|email|comment|firstName|password|confirmedAt/);
  assert.ok(f.queries[0].sql.includes('FOR UPDATE')); assert.ok(f.queries[0].values.includes(principal.userId));
  assert.equal(f.slotQueries[0].where.OR[0].status, 'RESERVED');
  assert.equal(f.slotQueries[0].where.OR[0].availability.service.requiresConfirmation, undefined);
  assert.equal(f.slotQueries[0].where.OR[0].availability.service.active, true);
});
test('RF016 repeated confirmation returns original time and adds no audit or confirmation', async () => {
  const f = fixture(); const first = await f.service.confirm(f.row.id, principal, context), second = await f.service.confirm(f.row.id, principal, context);
  assert.deepEqual(second, first); assert.equal(f.state().confirmations.length, 1); assert.equal(f.state().audits.length, 1);
});
test('RF016 nonexistent, foreign/deleted and outside selected tenant are nondisclosing', async () => {
  const f = fixture({ missing: true });
  await assert.rejects(f.service.confirm(f.row.id, principal, { ...context, institutionId: randomUUID(), branchId: randomUUID() }), hasStatus(404));
  assert.match(f.queries[0].sql, /usuario_id = .*deleted_at IS NULL/s); assert.match(f.queries[0].sql, /institucion_id = .*sede_id = /s);
  assert.equal(f.state().confirmations.length, 0);
});
test('RF016 session/user context mismatch and inactive account cannot reach writes', async () => {
  const f = fixture(); await assert.rejects(f.service.confirm(f.row.id, principal, { ...context, userId: randomUUID() }), hasStatus(401));
  assert.equal(f.prisma.$transaction.mock.callCount(), 0);
  const inactive = fixture({ inactive: true }); await assert.rejects(inactive.service.confirm(inactive.row.id, principal, context), hasStatus(401));
  assert.equal(inactive.queries.length, 0);
});
test('RF016 both policy gates, future start, active/nonfinal status and coherent context are mandatory', async () => {
  const changes = [r => { r.service.requiresConfirmation = false; }, r => { r.status.allowsConfirmation = false; },
    r => { r.status.active = false; }, r => { r.status.isFinal = true; }, r => { r.startsAt = new Date(0); },
    ...['CANCELADA', 'ATENDIDA', 'INASISTENCIA'].map(code => r => { r.status.code = code; }),
    ...['branch', 'service', 'professional'].map(key => r => { r[key].institutionId = randomUUID(); })];
  for (const change of changes) {
    const f = fixture(); change(f.row); await assert.rejects(f.service.confirm(f.row.id, principal, context), hasStatus(409));
    assert.equal(f.state().confirmations.length, 0); assert.equal(f.state().audits.length, 0);
  }
  for (const options of [{ invalidSlot: true }, { invalidOwnership: true }]) {
    const f = fixture(options); await assert.rejects(f.service.confirm(f.row.id, principal, context), hasStatus(409));
  }
});
test('RF016 audit failure and crossed insert deadline roll back the complete operation', async () => {
  for (const options of [{ failAudit: true }, { insertFailure: true }, { deadlineCrossed: true }]) {
    const f = fixture(options); await assert.rejects(f.service.confirm(f.row.id, principal, context), hasStatus(options.deadlineCrossed ? 409 : 500));
    assert.equal(f.state().confirmations.length, 0); assert.equal(f.state().audits.length, 0);
  }
});
test('RF016 recognized conflicts retry the whole transaction at most once; arbitrary SQL is not 409', async () => {
  const f = fixture({ conflicts: 1 }); await f.service.confirm(f.row.id, principal, context);
  assert.equal(f.prisma.$transaction.mock.callCount(), 2); assert.equal(f.state().confirmations.length, 1);
  const persistent = fixture({ conflicts: 2 }); await assert.rejects(persistent.service.confirm(persistent.row.id, principal, context), hasStatus(409));
  assert.equal(persistent.prisma.$transaction.mock.callCount(), 2);
  for (const code of ['P2002', 'P2003', '23505', '42601']) {
    const bad = fixture(); bad.prisma.$transaction.mock.mockImplementation(async () => { throw Object.assign(new Error('private'), { code }); });
    await assert.rejects(bad.service.confirm(bad.row.id, principal, context), error => error.getStatus() === 500 && !error.message.includes('private'));
    assert.equal(bad.prisma.$transaction.mock.callCount(), 1);
  }
});
test('RF016 public state strips internal eligibility; ownership and timestamp comparison stay inside SQL', async () => {
  const f = fixture(), calls = [];
  const states = await confirmationStates({ $queryRaw: async query => { calls.push(query); return [{ id: f.row.id, confirmedAt: null, ownershipValid: false }]; },
    agendaSlot: { findMany: async () => [{ id: f.row.agendaSlotId, availability: { attentionPointId: null }, appointment: { attentionPointId: null } }] } }, principal.userId, [f.row]);
  assert.match(calls[0].sql, /usuario_id = a.usuario_id/); assert.match(calls[0].sql, /usuario_anterior_id IS DISTINCT FROM usuario_nuevo_id/);
  assert.match(calls[0].sql, /confirmada_at >= COALESCE/);
  assert.deepEqual(publicConfirmation(states.get(f.row.id)), { required: true, confirmed: false, confirmedAt: null, canConfirm: false });
});

test('RF016 unwraps only P2010 with the recognized adapter serialization/deadlock cause', async () => {
  for (const originalCode of ['40001', '40P01', '23505', '23503', '42601']) {
    const f = fixture(), original = f.prisma.$transaction; let attempts = 0;
    f.prisma.$transaction = async (...args) => {
      if (++attempts === 1) throw new Prisma.PrismaClientKnownRequestError('private SQL', { code: 'P2010', clientVersion: '7.10.0',
        meta: { driverAdapterError: { name: 'DriverAdapterError', cause: { kind: 'TransactionWriteConflict', originalCode } } } });
      return original(...args);
    };
    if (['40001', '40P01'].includes(originalCode)) { await f.service.confirm(f.row.id, principal, context); assert.equal(attempts, 2); }
    else { await assert.rejects(f.service.confirm(f.row.id, principal, context), hasStatus(500)); assert.equal(attempts, 1); }
  }
});
