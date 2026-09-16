import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test, mock } from 'node:test';
import { GUARDS_METADATA, HTTP_CODE_METADATA } from '@nestjs/common/constants.js';
import { AttendanceController } from '../dist/appointments/attendance.controller.js';
import { AttendanceService } from '../dist/appointments/attendance.service.js';
import { parseAttendance, attendanceContext } from '../dist/appointments/attendance.schemas.js';
import { REQUIRE_PERMISSIONS_KEY } from '../dist/authorization/decorators/require-permissions.decorator.js';

const context = { userId: randomUUID(), institutionId: randomUUID(), permissions: ['appointments.attendance'], roleCodes: [] };
const path = { appointmentId: randomUUID() };
const hasStatus = (status) => (error) => error.getStatus?.() === status;
function fixture() {
  const branchId = randomUUID(); const serviceId = randomUUID(); const professionalId = randomUUID();
  const source = { code: 'AGENDADA', name: 'Agendada', active: true, isFinal: false };
  const row = { id: path.appointmentId, userId: randomUUID(), branchId, serviceId, professionalId, attentionPointId: null,
    statusId: randomUUID(), status: source, updatedAt: new Date(), startsAt: new Date('2030-01-01T10:00Z'), endsAt: new Date('2030-01-01T11:00Z'),
    branch: { id: branchId, name: 'Sede' }, service: { id: serviceId, name: 'Servicio' },
    professional: { id: professionalId, titleOrFunction: null, user: { firstNames: 'Persona', lastNames: 'Prueba' } },
    attentionPoint: null, agendaSlot: { availability: { branchId, serviceId, professionalId, attentionPointId: null } } };
  const history = [];
  const tx = {
    auditEvent: { create: mock.fn(async ({ data }) => ({ id: data.id })) },
    user: { findFirst: mock.fn(async () => ({ id: context.userId })) }, userRole: { count: mock.fn(async () => 1) },
    appointment: { findFirst: mock.fn(async () => structuredClone(row)), updateMany: mock.fn(async ({ data }) => { row.statusId = data.statusId; return { count: 1 }; }) },
    appointmentStatus: { findUnique: mock.fn(async ({ where }) => ({ id: randomUUID(), code: where.code, name: where.code,
      active: true, isFinal: true, allowsCancellation: false, allowsConfirmation: false })) },
    appointmentHistory: { create: mock.fn(async ({ data }) => { history.push(data); return data; }) },
  };
  const prisma = { $transaction: mock.fn(async (work, options) => {
    assert.equal(options.isolationLevel, 'Serializable'); const before = structuredClone(row); const count = history.length;
    try { return await work(tx); } catch (error) { Object.assign(row, before); history.splice(count); throw error; }
  }) };
  return { row, tx, prisma, history, service: new AttendanceService(prisma) };
}
test('attendance controller requires all guards, explicit permission and HTTP 200', () => {
  assert.equal(Reflect.getMetadata(GUARDS_METADATA, AttendanceController).length, 3);
  assert.deepEqual(Reflect.getMetadata(REQUIRE_PERMISSIONS_KEY, AttendanceController.prototype.record), ['appointments.attendance']);
  assert.equal(Reflect.getMetadata(HTTP_CODE_METADATA, AttendanceController.prototype.record), 200);
});
test('attendance rejects missing/mismatched identity and institutional context', () => {
  for (const request of [{}, { principal: { userId: context.userId } }, { principal: { userId: randomUUID() }, authorization: context }]) assert.throws(() => attendanceContext(request), hasStatus(401));
  assert.throws(() => attendanceContext({ principal: { userId: context.userId }, authorization: { ...context, institutionId: undefined } }), hasStatus(400));
});
for (const outcome of ['ATENDIDA', 'INASISTENCIA']) test(`schema accepts only controlled ${outcome} body`, () => {
  assert.deepEqual(parseAttendance(path, { status: outcome }, {}), { ...path, status: outcome });
});
test('attendance rejects unknown state, missing status, extra body/query/path and invalid UUID', () => {
  for (const body of [{}, { status: 'CANCELADA' }, { status: 'ATENDIDA', userId: context.userId }, { status: 'ATENDIDA', reason: 'custom' }, { status: 'ATENDIDA', institutionId: context.institutionId }]) assert.throws(() => parseAttendance(path, body, {}), hasStatus(400));
  assert.throws(() => parseAttendance({ appointmentId: 'bad' }, { status: 'ATENDIDA' }, {}), hasStatus(400));
  assert.throws(() => parseAttendance(path, { status: 'ATENDIDA' }, { branchId: randomUUID() }), hasStatus(400));
});
for (const outcome of ['ATENDIDA', 'INASISTENCIA']) test(`AGENDADA to ${outcome} updates once and records actor/owner/status without slot writes`, async () => {
  const { service, tx, row, history } = fixture(); const originalStatus = row.statusId;
  const result = await service.record(row.id, outcome, context);
  assert.equal(result.data.status.code, outcome); assert.equal(tx.appointment.updateMany.mock.callCount(), 1);
  assert.equal(history.length, 1); assert.equal(history[0].previousStatusId, originalStatus); assert.equal(history[0].newStatusId, row.statusId);
  assert.equal(history[0].actorUserId, context.userId); assert.equal(history[0].previousUserId, row.userId); assert.equal(history[0].newUserId, row.userId);
  assert.equal(history[0].reason, outcome === 'ATENDIDA' ? 'ATTENDANCE_RECORDED' : 'NO_SHOW_RECORDED');
  assert.equal(history[0].details, undefined); assert.equal(tx.agendaSlot, undefined);
  assert.deepEqual(Object.keys(result.data).sort(), ['id', 'status', 'startsAt', 'endsAt', 'branch', 'service', 'professional'].sort());
});
for (const outcome of ['ATENDIDA', 'INASISTENCIA']) test(`${outcome} replay is read-only and contradictory result is 409`, async () => {
  const { service, tx, row } = fixture(); row.status.code = outcome; row.status.isFinal = true;
  const before = structuredClone(row); assert.equal((await service.record(row.id, outcome, context)).data.status.code, outcome);
  assert.deepEqual(row, before); assert.equal(tx.appointment.updateMany.mock.callCount(), 0); assert.equal(tx.appointmentHistory.create.mock.callCount(), 0);
  await assert.rejects(service.record(row.id, outcome === 'ATENDIDA' ? 'INASISTENCIA' : 'ATENDIDA', context), hasStatus(409));
});
test('cancelled, final or inactive scheduled states cannot transition', async () => {
  for (const source of [{ code: 'CANCELADA' }, { code: 'OTHER' }, { isFinal: true }, { active: false }]) {
    const { service, row, tx } = fixture(); Object.assign(row.status, source);
    await assert.rejects(service.record(row.id, 'ATENDIDA', context), hasStatus(409)); assert.equal(tx.appointment.updateMany.mock.callCount(), 0);
  }
});
test('scoped lookup enforces institution, branch, deletedAt and coherent institutional relations', async () => {
  const { service, tx, row } = fixture(); const scoped = { ...context, branchId: row.branchId };
  tx.appointment.findFirst.mock.mockImplementation(async () => null);
  await assert.rejects(service.record(row.id, 'ATENDIDA', scoped), hasStatus(404));
  const where = tx.appointment.findFirst.mock.calls[0].arguments[0].where;
  assert.equal(where.institutionId, context.institutionId); assert.equal(where.branchId, scoped.branchId); assert.equal(where.deletedAt, null);
  for (const relation of ['branch', 'service', 'professional']) assert.deepEqual(where[relation], { institutionId: context.institutionId });
});
test('incoherent slot or attention-point relations are nondisclosing 404', async () => {
  for (const field of ['branchId', 'serviceId', 'professionalId', 'attentionPointId']) {
    const { service, row } = fixture(); row.agendaSlot.availability[field] = randomUUID();
    await assert.rejects(service.record(row.id, 'ATENDIDA', context), hasStatus(404));
  }
});
test('actor and permission revoked after guards are checked inside the transaction', async () => {
  const { service, tx, row } = fixture(); tx.user.findFirst.mock.mockImplementation(async () => null);
  await assert.rejects(service.record(row.id, 'ATENDIDA', context), hasStatus(401));
  tx.user.findFirst.mock.mockImplementation(async () => ({ id: context.userId })); tx.userRole.count.mock.mockImplementation(async () => 0);
  await assert.rejects(service.record(row.id, 'ATENDIDA', context), hasStatus(403));
  assert.equal(tx.appointment.updateMany.mock.callCount(), 0);
});
test('missing or incompatible target catalog is controlled 503', async () => {
  for (const target of [null, { active: false }, { active: true, isFinal: false }, { active: true, isFinal: true, allowsCancellation: true }, { active: true, isFinal: true, allowsConfirmation: true }]) {
    const { service, tx, row } = fixture(); tx.appointmentStatus.findUnique.mock.mockImplementation(async () => target);
    await assert.rejects(service.record(row.id, 'ATENDIDA', context), hasStatus(503));
  }
});
test('CAS failure produces conflict and never inserts history', async () => {
  const { service, tx, row } = fixture(); tx.appointment.updateMany.mock.mockImplementation(async () => ({ count: 0 }));
  await assert.rejects(service.record(row.id, 'ATENDIDA', context), hasStatus(409)); assert.equal(tx.appointmentHistory.create.mock.callCount(), 0);
});
test('history failure rolls back appointment and is not retried as a serialization conflict', async () => {
  const { service, tx, row, prisma } = fixture(); const before = structuredClone(row);
  tx.appointmentHistory.create.mock.mockImplementation(async () => { throw new Error('history failure'); });
  await assert.rejects(service.record(row.id, 'ATENDIDA', context), /history failure/);
  assert.deepEqual(row, before); assert.equal(prisma.$transaction.mock.callCount(), 1);
});
test('recognized conflict retries whole transaction and sees equivalent winner without writing', async () => {
  const { service, tx, row, prisma } = fixture();
  prisma.$transaction.mock.mockImplementationOnce(async () => { row.status.code = 'ATENDIDA'; row.status.isFinal = true; throw { code: 'P2034' }; });
  assert.equal((await service.record(row.id, 'ATENDIDA', context)).data.status.code, 'ATENDIDA');
  assert.equal(prisma.$transaction.mock.callCount(), 2); assert.equal(tx.appointmentHistory.create.mock.callCount(), 0);
});
test('persistent recognized conflicts stop after one retry; arbitrary SQL errors are not reclassified', async () => {
  const { service, row, prisma } = fixture();
  prisma.$transaction.mock.mockImplementation(async () => { throw { code: 'P2034' }; });
  await assert.rejects(service.record(row.id, 'ATENDIDA', context), hasStatus(409)); assert.equal(prisma.$transaction.mock.callCount(), 2);
  const error = { code: 'P2003' }; prisma.$transaction.mock.mockImplementation(async () => { throw error; });
  await assert.rejects(service.record(row.id, 'ATENDIDA', context), (caught) => caught === error);
});
