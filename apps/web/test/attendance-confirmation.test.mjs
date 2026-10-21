import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import { createAppointmentsApi, parseAppointment } from '../src/features/appointments/appointments-api.ts';
import { ApiError } from '../src/lib/http-client.ts';

const previous = process.env.API_PROXY_TARGET; process.env.API_PROXY_TARGET = 'http://localhost:3000';
const vite = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom' });
if (previous === undefined) delete process.env.API_PROXY_TARGET; else process.env.API_PROXY_TARGET = previous;
after(() => vite.close());
const { AttendanceConfirmationView, createConfirmationSubmission } = await vite.ssrLoadModule('/src/features/appointments/attendance-confirmation-action.tsx');
const id = '10000000-0000-4000-8000-000000000001', confirmedAt = '2030-01-01T12:00:00.000Z';
const eligible = { required: true, confirmed: false, confirmedAt: null, canConfirm: true };
const result = { data: { appointmentId: id, confirmed: true, confirmedAt } };
const row = { id, institutionId: id, status: 'AGENDADA', startsAt: confirmedAt, endsAt: '2030-01-01T12:30:00.000Z', origin: 'WEB',
  branch: { id, name: 'Centro' }, service: { id, name: 'Atención' }, professional: { id, firstNames: 'Ana', lastNames: 'Test' } };
const render = (confirmation, overrides = {}) => renderToStaticMarkup(createElement(AttendanceConfirmationView, {
  confirmation, busy: false, error: '', onConfirm() {}, onRefresh() {}, ...overrides,
}));

test('RF016 client sends exact bodyless authenticated POST, refuses automatic replay and controls DTO', async () => {
  const calls = [], signal = new AbortController().signal;
  const api = createAppointmentsApi({ request: async (...args) => { calls.push(args); return { data: { ...result.data, userId: 'private', comment: 'private' } }; } });
  assert.deepEqual(await api.confirmAttendance(id, signal), result.data);
  assert.deepEqual(calls, [[`appointments/${id}/confirm-attendance`, { method: 'POST', retryAfterRefresh: false, signal }]]);
  await assert.rejects(api.confirmAttendance('bad')); assert.equal(calls.length, 1);
});
test('RF016 additive listing data is validated and old cancellation DTOs remain compatible', () => {
  assert.equal(parseAppointment(row).attendanceConfirmation, undefined);
  assert.deepEqual(parseAppointment({ ...row, attendanceConfirmation: { ...eligible, userId: 'private' } }).attendanceConfirmation, eligible);
  for (const value of [{ ...eligible, canConfirm: 'true' }, { ...eligible, confirmed: true }, { ...eligible, required: false },
    { ...eligible, confirmed: true, confirmedAt, canConfirm: true }]) assert.throws(() => parseAppointment({ ...row, attendanceConfirmation: value }));
  assert.deepEqual(parseAppointment({ ...row, attendanceConfirmation: { required: true, confirmed: true, confirmedAt, canConfirm: false } }).attendanceConfirmation.confirmed, true);
});
test('RF016 action follows backend capability only, has clear accessible pending and historical states', () => {
  assert.match(render(eligible), /Confirmar asistencia/); assert.match(render(eligible), /aria-label="Confirmar que asistiré/);
  assert.match(render(eligible), /seguirá agendada/);
  assert.doesNotMatch(render(undefined), /button/);
  assert.doesNotMatch(render({ ...eligible, canConfirm: false }), /button/);
  assert.match(render({ ...eligible, confirmed: true, canConfirm: false, confirmedAt }), /Asistencia confirmada previamente/);
  assert.doesNotMatch(render({ ...eligible, confirmed: true, canConfirm: false, confirmedAt }), /button/);
  assert.match(render(eligible, { busy: true }), /disabled=""/); assert.match(render(eligible, { busy: true }), /Confirmando/);
  assert.match(render(eligible, { error: 'Actualiza tus citas' }), /role="alert"/);
});
test('RF016 submission prevents double send, publishes pending/success and requests one refresh', async () => {
  let resolve, calls = 0, refreshed = 0; const updates = [];
  const operation = createConfirmationSubmission({ request: async () => { calls++; return new Promise(yes => { resolve = yes; }); } }, id, state => updates.push(state), () => { refreshed++; });
  const first = operation.run(), second = operation.run(); assert.equal(calls, 1); assert.equal(updates[0].busy, true);
  resolve(result); await Promise.all([first, second]);
  assert.equal(refreshed, 1); assert.deepEqual(updates.at(-1), { busy: false, error: '' });
});
test('RF016 malformed/error responses never announce success, and late logout/unmount aborts publication', async () => {
  for (const response of [new ApiError(409), new ApiError(401), new Error('private'), { data: { ...result.data, appointmentId: 'another' } }]) {
    const updates = []; let refreshed = 0;
    const operation = createConfirmationSubmission({ request: async () => { if (response instanceof Error) throw response; return response; } }, id, value => updates.push(value), () => { refreshed++; });
    await operation.run(); assert.equal(refreshed, 0); assert.ok(updates.at(-1).error); assert.ok(!updates.at(-1).error.includes('private'));
  }
  let resolve, signal; const updates = [];
  const operation = createConfirmationSubmission({ request: async (_path, options) => { signal = options.signal; return new Promise(yes => { resolve = yes; }); } }, id,
    state => updates.push(state), () => assert.fail('Late completion must not refresh another session'));
  const pending = operation.run(); operation.dispose(); assert.equal(signal.aborted, true); resolve(result); await pending;
  assert.equal(updates.length, 1);
});
