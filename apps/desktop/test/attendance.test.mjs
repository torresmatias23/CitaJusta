import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { ApiError, createHttpClient } from '@citajusta/client-core';
import { createAttendanceApi, attendancePermissions, canRecordAttendance, attendanceError } from '../src/attendance/attendance-api.ts';
import { createAttendanceModel } from '../src/attendance/attendance-model.ts';
import { profile as reader, appointment, branch, service, institutionId, catalogResponse, deferred } from './fixtures/agenda.mjs';

const profile = { ...reader, permissions: ['agenda.read', 'appointments.attendance'] };
const filters = { date: '2026-09-24' }, signal = new AbortController().signal;
const receipt = status => ({ data: { id: appointment.id, status: { code: status, name: status } } });
function fixture(options = {}) {
  const calls = []; let items = [{ ...appointment }];
  const model = createAttendanceModel({ request: async (path, request = {}) => {
    calls.push({ path, request });
    if (options.request) return options.request(path, request);
    if (request.method === 'POST') { items = items.map(item => ({ ...item, status: { code: request.body.status, name: request.body.status } })); return receipt(request.body.status); }
    return path === 'agenda' ? { data: items } : catalogResponse(path);
  } }, options.profile ?? profile);
  return { model, calls, setItems(value) { items = value; } };
}
async function ready(f) { await f.model.activate(); f.model.setFilters(filters); await f.model.consult(); }

test('HU033 agenda date/filter allowlist, controlled DTO and headers only through the shared client', async () => {
  let called = 0;
  const api = createHttpClient({ baseUrl: 'http://localhost/api/v1', fetcher: async (url, options) => {
    called++; assert.equal(url, `http://localhost/api/v1/agenda?date=2026-09-24&branchId=${branch.id}&serviceId=${service.id}&professionalId=${appointment.professional.id}&status=AGENDADA`);
    assert.equal(options.headers.get('x-institution-id'), institutionId); assert.equal(options.headers.get('x-branch-id'), branch.id);
    assert.equal(options.method, 'GET'); assert.equal(options.body, undefined);
    return Response.json({ data: [{ ...appointment, institutionId: 'PRIVATE', actor: 'PRIVATE', lockVersion: 2,
      user: { ...appointment.user, passwordHash: 'PRIVATE' }, professional: { ...appointment.professional, internalNotes: 'PRIVATE' } }] });
  } });
  const model = createAttendanceModel(api, { ...profile, context: { institutionId, branchId: branch.id } });
  model.setFilters({ ...filters, branchId: branch.id, serviceId: service.id, professionalId: appointment.professional.id, status: 'AGENDADA', userId: 'foreign', institutionId: 'foreign' });
  await model.consult(); assert.equal(called, 1); assert.deepEqual(model.getSnapshot().agenda.items, [appointment]); model.dispose();
});

for (const outcome of ['ATENDIDA', 'INASISTENCIA']) test(`HU033 ${outcome}: POST exact, no replay, signal/context and receipt allowlist`, async () => {
  let called = 0;
  const api = createHttpClient({ baseUrl: 'http://localhost/api/v1', fetcher: async (url, options) => {
    called++; assert.equal(url, `http://localhost/api/v1/appointments/${appointment.id}/attendance`);
    assert.equal(options.method, 'POST'); assert.equal(options.signal, signal);
    assert.equal(options.headers.get('x-institution-id'), institutionId); assert.equal(options.headers.get('x-branch-id'), branch.id);
    assert.deepEqual(JSON.parse(options.body), { status: outcome });
    return Response.json({ data: { ...receipt(outcome).data, actor: 'private', userId: 'private', status: { code: outcome, name: outcome, isFinal: true } } });
  } });
  const client = createAttendanceApi({ request: (path, options) => { assert.equal(options.retryAfterRefresh, false); assert.deepEqual(Object.keys(options.body), ['status']); return api.request(path, options); } }, { ...profile, context: { institutionId, branchId: branch.id } });
  assert.deepEqual(await client.record(appointment.id, outcome, signal), receipt(outcome).data); assert.equal(called, 1);
});

test('HU033 permission/eligibility uses explicit permissions, context and AGENDADA; never roles', async () => {
  assert.deepEqual(attendancePermissions(reader), { read: true, record: false });
  for (const user of [{ ...profile, context: {} }, { ...profile, permissions: ['appointments.attendance'] }, { ...profile, permissions: [], roles: ['ADMIN'] }]) {
    assert.deepEqual(attendancePermissions(user), { read: false, record: false });
    const f = fixture({ profile: user }); await f.model.activate(); f.model.setFilters(filters); await f.model.consult();
    assert.equal(await f.model.record(appointment.id, 'ATENDIDA'), false); assert.equal(f.calls.length, 0); assert.equal(f.model.getSnapshot().agenda.status, 'denied'); f.model.dispose();
  }
  assert.equal(canRecordAttendance(profile, appointment), true);
  for (const code of ['ATENDIDA', 'INASISTENCIA', 'CANCELADA', 'OTHER']) assert.equal(canRecordAttendance(profile, { ...appointment, status: { code, name: code } }), false);
  assert.equal(canRecordAttendance({ ...profile, context: { institutionId, branchId: service.id } }, appointment), false);
  const client = createAttendanceApi({ request: () => assert.fail('must not send') }, reader);
  await assert.rejects(client.record(appointment.id, 'ATENDIDA', signal), error => error.status === 403);
});

test('HU033 rejects malformed identity/status before transport and malformed/mismatched receipt', async () => {
  const client = createAttendanceApi({ request: () => assert.fail('must not send') }, profile);
  for (const [id, status] of [['../other', 'ATENDIDA'], [appointment.id, 'CANCELADA'], [appointment.id, { status: 'ATENDIDA', userId: 'foreign' }]]) await assert.rejects(client.record(id, status, signal), error => error.status === 400);
  for (const value of [{}, { data: null }, { data: { ...receipt('ATENDIDA').data, id: service.id } }, receipt('INASISTENCIA'), { data: { id: appointment.id, status: { code: 'ATENDIDA' } } }]) {
    await assert.rejects(createAttendanceApi({ request: async () => value }, profile).record(appointment.id, 'ATENDIDA', signal));
  }
});

test('HU033 branch filter is fixed; state starts idle and loading/empty/error/success preserve order', async () => {
  const pending = deferred(); let mode = 'pending';
  const f = fixture({ profile: { ...profile, context: { institutionId, branchId: branch.id } }, request: async (path, options) => {
    if (path !== 'agenda') return catalogResponse(path);
    assert.equal(options.query.branchId, branch.id);
    if (mode === 'pending') return pending.promise;
    if (mode === 'error') throw new ApiError(500, { message: 'SQL SECRET' });
    return { data: [] };
  } });
  assert.equal(f.model.getSnapshot().agenda.status, 'idle'); await f.model.activate(); f.model.setFilters({ ...filters, branchId: service.id });
  const loading = f.model.consult(); assert.equal(f.model.getSnapshot().agenda.status, 'loading');
  const second = { ...appointment, id: service.id };
  pending.resolve({ data: [second, appointment] }); await loading;
  assert.deepEqual(f.model.getSnapshot().agenda.items, [second, appointment]); assert.equal(f.model.getSnapshot().agenda.status, 'ready');
  mode = 'empty'; await f.model.consult(); assert.deepEqual(f.model.getSnapshot().agenda.items, []); assert.equal(f.model.getSnapshot().agenda.status, 'ready');
  mode = 'error'; await f.model.consult(); assert.equal(f.model.getSnapshot().agenda.status, 'error'); assert.doesNotMatch(f.model.getSnapshot().agenda.error, /SQL|SECRET/); f.model.dispose();
});

for (const outcome of ['ATENDIDA', 'INASISTENCIA']) test(`HU033 success ${outcome} refreshes real agenda, preserves filters and removes eligibility`, async () => {
  const f = fixture(); await ready(f); const before = { ...f.model.getSnapshot().agenda.filters };
  assert.equal(await f.model.record(appointment.id, outcome), true);
  assert.equal(f.calls.filter(c => c.path === 'agenda').length, 2);
  const snapshot = f.model.getSnapshot(); assert.equal(snapshot.failed, false); assert.equal(snapshot.busyId, null);
  assert.equal(snapshot.agenda.items[0].status.code, outcome); assert.equal(f.model.canRecord(snapshot.agenda.items[0]), false);
  assert.deepEqual(snapshot.agenda.filters, before); assert.match(snapshot.feedback, /registrada/);
  assert.equal(await f.model.record(appointment.id, outcome), false); assert.equal(f.calls.filter(c => c.request.method === 'POST').length, 1); f.model.dispose();
});

test('HU033 read-only user may consult but cannot post; missing/ineligible rows cannot post', async () => {
  const f = fixture({ profile: reader }); await ready(f); assert.equal(f.model.getSnapshot().agenda.items.length, 1);
  assert.equal(await f.model.record(appointment.id, 'ATENDIDA'), false); assert.equal(f.calls.filter(c => c.request.method).length, 0); f.model.dispose();
  const authorized = fixture(); await ready(authorized); assert.equal(await authorized.model.record(service.id, 'ATENDIDA'), false);
  authorized.setItems([{ ...appointment, status: { code: 'CANCELADA', name: 'Cancelada' } }]); await authorized.model.consult();
  assert.equal(await authorized.model.record(appointment.id, 'ATENDIDA'), false); assert.equal(authorized.calls.filter(c => c.request.method).length, 0); authorized.model.dispose();
});

test('HU033 double submit blocked across outcomes; no automatic retry on 409 and explicit consultation remains available', async () => {
  const pending = deferred();
  const f = fixture({ request: async (path, options) => options.method ? pending.promise : path === 'agenda' ? { data: [appointment] } : catalogResponse(path) });
  await ready(f); const first = f.model.record(appointment.id, 'ATENDIDA'); assert.equal(f.model.getSnapshot().busyId, appointment.id);
  assert.equal(await f.model.record(appointment.id, 'INASISTENCIA'), false); assert.equal(f.calls.filter(c => c.request.method).length, 1);
  pending.reject(new ApiError(409, { message: 'SQL private' })); assert.equal(await first, false);
  assert.equal(f.model.getSnapshot().failed, true); assert.match(f.model.getSnapshot().feedback, /Vuelve a consultar/); assert.doesNotMatch(f.model.getSnapshot().feedback, /SQL|private/);
  assert.equal(f.model.getSnapshot().busyId, null); assert.equal(f.calls.filter(c => c.path === 'agenda').length, 1);
  await f.model.consult(); assert.equal(f.calls.filter(c => c.path === 'agenda').length, 2); f.model.dispose();
});

test('HU033 every error sanitized, failed or malformed writes never report success/refresh', async () => {
  for (const code of [400, 401, 403, 404, 409, 503, 500]) {
    const error = new ApiError(code, { message: 'Prisma SQL SECRET' }); assert.doesNotMatch(attendanceError(error), /Prisma|SQL|SECRET/);
    const f = fixture({ request: async (path, options) => { if (options.method) throw error; return path === 'agenda' ? { data: [appointment] } : catalogResponse(path); } });
    await ready(f); assert.equal(await f.model.record(appointment.id, 'ATENDIDA'), false);
    assert.equal(f.model.getSnapshot().failed, true); assert.equal(f.calls.filter(c => c.path === 'agenda').length, 1); f.model.dispose();
  }
  const f = fixture({ request: async (path, options) => options.method ? {} : path === 'agenda' ? { data: [appointment] } : catalogResponse(path) });
  await ready(f); assert.equal(await f.model.record(appointment.id, 'ATENDIDA'), false); assert.equal(f.calls.filter(c => c.path === 'agenda').length, 1); f.model.dispose();
});

test('HU033 stale GET ignored after new filters, old rows cleared and signal aborted', async () => {
  const pending = deferred(); let oldSignal;
  const f = fixture({ request: async (path, options) => {
    if (path !== 'agenda') return catalogResponse(path);
    if (options.query.date === filters.date) { oldSignal = options.signal; return pending.promise; }
    return { data: [] };
  } });
  await f.model.activate(); f.model.setFilters(filters); const first = f.model.consult();
  f.model.setFilters({ date: '2026-09-25' }); assert.deepEqual(f.model.getSnapshot().agenda.items, []); assert.equal(oldSignal.aborted, true);
  await f.model.consult(); pending.resolve({ data: [appointment] }); await first;
  assert.deepEqual(f.model.getSnapshot().agenda.items, []); assert.equal(f.model.getSnapshot().agenda.filters.date, '2026-09-25'); f.model.dispose();
});

test('HU033 pending write cannot refresh a changed filter view', async () => {
  const pending = deferred();
  const f = fixture({ request: async (path, options) => options.method ? pending.promise : path === 'agenda' ? { data: [appointment] } : catalogResponse(path) });
  await ready(f); const write = f.model.record(appointment.id, 'ATENDIDA');
  f.model.setFilters({ date: '2026-09-25' }); pending.resolve(receipt('ATENDIDA')); assert.equal(await write, false);
  assert.equal(f.model.getSnapshot().feedback, ''); assert.equal(f.model.getSnapshot().busyId, null);
  assert.deepEqual(f.model.getSnapshot().agenda.items, []); assert.equal(f.calls.filter(c => c.path === 'agenda').length, 1); f.model.dispose();
});

test('HU033 dispose/reactivate discards old reads and writes; aborted request cannot repopulate context', async () => {
  for (const writing of [false, true]) {
    const pending = deferred(); let delayed = false, oldSignal;
    const f = fixture({ request: async (path, options) => {
      if ((writing && options.method) || (!writing && delayed && path === 'agenda')) { oldSignal = options.signal; return pending.promise; }
      return path === 'agenda' ? { data: [appointment] } : catalogResponse(path);
    } });
    await ready(f); delayed = true;
    const operation = writing ? f.model.record(appointment.id, 'ATENDIDA') : f.model.consult();
    f.model.dispose(); assert.equal(oldSignal.aborted, true); await f.model.activate();
    pending.resolve(writing ? receipt('ATENDIDA') : { data: [appointment] }); await operation;
    assert.deepEqual(f.model.getSnapshot().agenda.items, []); assert.equal(f.model.getSnapshot().feedback, ''); assert.equal(f.model.getSnapshot().busyId, null); f.model.dispose();
  }
});

test('HU033 successful POST followed by failed refresh shows actual success and no stale actions', async () => {
  let saved = false;
  const f = fixture({ request: async (path, options) => {
    if (options.method) { saved = true; return receipt(options.body.status); }
    if (path === 'agenda') { if (saved) throw new ApiError(500); return { data: [appointment] }; }
    return catalogResponse(path);
  } });
  await ready(f); assert.equal(await f.model.record(appointment.id, 'ATENDIDA'), true);
  assert.match(f.model.getSnapshot().feedback, /Asistencia registrada/); assert.equal(f.model.getSnapshot().agenda.status, 'error');
  assert.deepEqual(f.model.getSnapshot().agenda.items, []); f.model.dispose();
});

test('HU033 shell wires AttendancePage; session.api reused without fetch, storage or parallel client', async () => {
  const shell = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8'); assert.match(shell, /selected === 'Asistencia' \? <AttendancePage \/>/);
  const page = await readFile(new URL('../src/attendance/attendance-page.tsx', import.meta.url), 'utf8');
  assert.match(page, /const \{ api \} = useAuth\(\)/); assert.match(page, /createAttendanceModel\(api, user\)/);
  assert.match(page, /key=\{JSON.stringify\(\[user.id, user.context, user.permissions\]\)\}/);
  for (const name of ['attendance-api.ts', 'attendance-model.ts', 'attendance-page.tsx']) {
    const source = await readFile(new URL(`../src/attendance/${name}`, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /\bfetch\s*\(|createHttpClient|createDesktopHttpClient|localStorage|sessionStorage|\bany\b/);
  }
});
