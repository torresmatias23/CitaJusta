import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ApiError } from '../src/lib/http-client.ts';
import {
  appointmentErrorMessage, createAppointmentsApi, createSubmissionLock, isAppointmentId, parseAppointment,
} from '../src/features/appointments/appointments-api.ts';

const ids = Array.from({ length: 6 }, (_, index) => `10000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`);
const summary = {
  id: ids[0], institutionId: ids[1], status: 'AGENDADA',
  startsAt: '2030-05-27T13:30:00.000Z', endsAt: '2030-05-27T14:00:00.000Z', origin: 'WEB',
  branch: { id: ids[2], name: 'Sucursal Centro' }, service: { id: ids[3], name: 'Orientación de trámites' },
  professional: { id: ids[4], firstNames: 'Camila', lastNames: 'López' },
};
const booking = {
  id: summary.id, institutionId: summary.institutionId, branchId: ids[2], serviceId: ids[3], professionalId: ids[4],
  agendaSlotId: ids[5], status: 'AGENDADA', startsAt: summary.startsAt, endsAt: summary.endsAt, origin: 'WEB',
};

test('reserva usa el endpoint real y envía solamente agendaSlotId', async () => {
  const calls = [];
  const signal = new AbortController().signal;
  const api = createAppointmentsApi({ request: async (...args) => { calls.push(args); return { data: booking }; } });
  assert.deepEqual(await api.reserve(ids[5], signal), booking);
  assert.deepEqual(calls, [['appointments', { method: 'POST', body: { agendaSlotId: ids[5] }, signal }]]);
});

test('listado propio no envía userId, body, query ni filtros y preserva el orden del backend', async () => {
  const calls = [];
  const data = [summary, { ...summary, id: ids[5], status: 'CANCELADA' }];
  const api = createAppointmentsApi({ request: async (...args) => { calls.push(args); return { data }; } });
  assert.deepEqual(await api.list(), data);
  assert.deepEqual(calls, [['appointments/me', {}]]);
});

test('listado vacío representa ausencia de citas reales', async () => {
  const api = createAppointmentsApi({ request: async () => ({ data: [] }) });
  assert.deepEqual(await api.list(), []);
});

test('parsea exclusivamente campos públicos y no infiere estados por fecha', () => {
  const result = parseAppointment({
    ...summary, startsAt: '2001-01-01T10:00:00.000Z', endsAt: '2001-01-01T11:00:00.000Z',
    userId: ids[5], lockVersion: 9, passwordHash: 'private',
    professional: { ...summary.professional, userId: ids[5] },
  });
  assert.equal(result.status, 'AGENDADA');
  assert.deepEqual(Object.keys(result), Object.keys(summary));
  assert.deepEqual(result.professional, summary.professional);
  assert.equal(parseAppointment({ ...summary, status: 'CANCELADA' }).status, 'CANCELADA');
  assert.equal(parseAppointment({ ...summary, status: 'REALIZADA' }).status, 'REALIZADA');
});

test('respuestas inválidas se rechazan en vez de presentar datos inventados', async () => {
  for (const invalid of [null, {}, { ...summary, startsAt: 'ayer' }, { ...summary, professional: null }, { ...summary, id: '../another-user' }]) {
    assert.throws(() => parseAppointment(invalid), /formato esperado/);
  }
  const api = createAppointmentsApi({ request: async () => ({ data: null }) });
  await assert.rejects(api.list(), /formato esperado/);
  await assert.rejects(api.reserve(ids[5]), /formato esperado/);
});

test('cancelación usa POST por id, sin body/query; conserva la respuesta real CANCELADA', async () => {
  const calls = [];
  const cancelled = { ...summary, status: 'CANCELADA' };
  const signal = new AbortController().signal;
  const api = createAppointmentsApi({ request: async (...args) => { calls.push(args); return { data: cancelled }; } });
  assert.deepEqual(await api.cancel(summary.id, signal), cancelled);
  assert.deepEqual(calls, [[`appointments/${summary.id}/cancel`, { method: 'POST', signal }]]);
});

test('200 idempotente conserva el mismo DTO; una respuesta de otra cita no se aplica', async () => {
  const cancelled = { ...summary, status: 'CANCELADA' };
  const api = createAppointmentsApi({ request: async () => ({ data: cancelled }) });
  assert.deepEqual(await api.cancel(summary.id), await api.cancel(summary.id));
  const wrong = createAppointmentsApi({ request: async () => ({ data: { ...cancelled, id: ids[5] } }) });
  await assert.rejects(wrong.cancel(summary.id), /formato esperado/);
});

test('ids inválidos no provocan peticiones ni permiten escapar del path', async () => {
  let calls = 0;
  const api = createAppointmentsApi({ request: async () => { calls += 1; return { data: summary }; } });
  for (const value of ['', '../users/me', `${summary.id}?userId=other`, 'https://example.test']) {
    assert.equal(isAppointmentId(value), false);
    await assert.rejects(api.cancel(value), /inválido/);
    await assert.rejects(api.reserve(value), /inválido/);
  }
  assert.equal(calls, 0);
});

test('409 de reserva se propaga sin retry y produce un mensaje controlado para actualizar', async () => {
  let calls = 0;
  const api = createAppointmentsApi({ request: async () => { calls += 1; throw new ApiError(409); } });
  await assert.rejects(api.reserve(ids[5]), (error) => error instanceof ApiError && error.status === 409);
  assert.equal(calls, 1);
  assert.match(appointmentErrorMessage(new ApiError(409), 'reserve'), /Actualiza los resultados/);
});

test('errores de cancelación son controlados y no filtran mensajes sensibles', async () => {
  for (const status of [400, 401, 403, 404, 409, 503]) {
    const error = new ApiError(status);
    error.message = 'password=private; Prisma stack internal';
    const api = createAppointmentsApi({ request: async () => { throw error; } });
    await assert.rejects(api.cancel(summary.id), (received) => received === error);
    assert.doesNotMatch(appointmentErrorMessage(error, 'cancel'), /password|private|Prisma|stack/);
  }
  assert.match(appointmentErrorMessage(new Error('network'), 'reserve'), /Consulta Mis citas antes/);
});

test('AbortSignal llega a GET /appointments/me y no se reintenta una cancelación abortada', async () => {
  const controller = new AbortController();
  controller.abort();
  let calls = 0;
  const api = createAppointmentsApi({ request: async (_path, options) => {
    assert.equal(options.signal, controller.signal);
    calls += 1;
    options.signal.throwIfAborted();
  } });
  await assert.rejects(api.list(controller.signal), { name: 'AbortError' });
  await assert.rejects(api.cancel(summary.id, controller.signal), { name: 'AbortError' });
  assert.equal(calls, 2);
});

test('bloqueo de submit usado por reserva/cancelación ejecuta sólo una operación concurrente', async () => {
  let resolve;
  const pending = new Promise((done) => { resolve = done; });
  let calls = 0;
  const lock = createSubmissionLock();
  const operation = async () => { calls += 1; await pending; return summary; };
  const first = lock.run(operation);
  const second = lock.run(operation);
  assert.equal(calls, 1);
  assert.equal(await second, undefined);
  resolve();
  assert.deepEqual(await first, summary);
  assert.deepEqual(await lock.run(operation), summary);
  assert.equal(calls, 2);
});

test('el bloqueo se libera tras error pero no reenvía la operación por su cuenta', async () => {
  let calls = 0;
  const lock = createSubmissionLock();
  await assert.rejects(lock.run(async () => { calls += 1; throw new ApiError(503); }));
  assert.equal(calls, 1);
  assert.equal(await lock.run(async () => 'ok'), 'ok');
});
