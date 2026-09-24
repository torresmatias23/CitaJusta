import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ApiError, createHttpClient } from '@citajusta/client-core';
import { createAgendaApi, agendaQuery, agendaError, formatAgendaTime } from '../src/agenda/agenda-api.ts';
import { createAgendaCatalogApi } from '../src/agenda/agenda-catalog-api.ts';
import { createAgendaModel } from '../src/agenda/agenda-model.ts';
import { profile, appointment, branch, service, institutionId, catalogResponse, deferred } from './fixtures/agenda.mjs';

test('agenda: GET exacto, fecha civil sin rango UTC, contexto sólo headers y AbortSignal', async () => {
  const controller = new AbortController(); let count = 0;
  const http = createHttpClient({ baseUrl: 'http://localhost:3000/api/v1', fetcher: async (url, options) => {
    count++;
    assert.equal(url, 'http://localhost:3000/api/v1/agenda?date=2026-09-24');
    assert.equal(options.method, 'GET'); assert.equal(options.body, undefined);
    assert.equal(options.headers.get('x-institution-id'), institutionId);
    assert.equal(options.signal, controller.signal);
    return Response.json({ data: [appointment] });
  } });
  const result = await createAgendaApi(http, profile).find({ date: '2026-09-24', institutionId: 'foreign', userId: 'foreign', actor: 'foreign', token: 'secret', roles: ['ADMIN'] }, controller.signal);
  assert.deepEqual(result, [appointment]); assert.equal(count, 1);
});

test('agenda: fecha obligatoria, calendario real y formato exacto; error antes del transporte', async () => {
  const client = createAgendaApi({ request() { assert.fail('No request'); } }, profile);
  for (const date of [undefined, '', '24-09-2026', '2026-9-24', '2026-02-30', '2025-02-29', '2026-09-24T00:00:00Z']) {
    await assert.rejects(client.find({ date }, new AbortController().signal), error => error.status === 400);
  }
  assert.deepEqual(agendaQuery({ date: '2024-02-29' }), { date: '2024-02-29' });
});

test('agenda: cada filtro opcional se envía sólo definido, status exacto abierto y codificación segura', () => {
  const values = { branchId: branch.id, serviceId: service.id, professionalId: appointment.professional.id, status: 'OTRO ESTADO&VALIDO' };
  for (const [key, value] of Object.entries(values)) assert.deepEqual(agendaQuery({ date: '2026-09-24', [key]: value }), { date: '2026-09-24', [key]: value });
  const query = agendaQuery({ date: '2026-09-24', ...values });
  assert.equal(new URLSearchParams(query).get('status'), values.status);
  assert.deepEqual(agendaQuery({ date: '2026-09-24', branchId: '', serviceId: '', professionalId: '', status: '' }), { date: '2026-09-24' });
  assert.equal(agendaQuery({ date: '2026-09-24', status: ' agendada ' }).status, ' agendada ');
  for (const key of ['branchId', 'serviceId', 'professionalId']) assert.throws(() => agendaQuery({ date: '2026-09-24', [key]: '../escape' }), error => error.status === 400);
  assert.throws(() => agendaQuery({ date: '2026-09-24', status: 'x'.repeat(61) }), error => error.status === 400);
});

test('agenda: contexto BRANCH fijo y distinto branchId rechazado sin consulta', async () => {
  const contextProfile = { ...profile, context: { institutionId, branchId: branch.id } };
  const calls = [];
  const client = createAgendaApi({ request: async (path, options) => { calls.push({ path, options }); return { data: [] }; } }, contextProfile);
  await client.find({ date: '2026-09-24' }, new AbortController().signal);
  assert.equal(calls[0].options.query.branchId, branch.id);
  assert.deepEqual(calls[0].options.institutionContext, contextProfile.context);
  await assert.rejects(client.find({ date: '2026-09-24', branchId: service.id }), error => error.status === 404);
  assert.equal(calls.length, 1);
});

test('agenda: decoder conserva orden/backend, estados abiertos e históricos, elimina internos profundamente', async () => {
  const later = { ...appointment, id: service.id, status: { code: 'ARCHIVADA', name: 'Archivada', isFinal: true }, deletedAt: 'internal',
    user: { ...appointment.user, passwordHash: 'secret', email: 'private' }, professional: { ...appointment.professional, description: 'internal' }, branch: { ...appointment.branch, status: 'INACTIVE' } };
  const client = createAgendaApi({ request: async () => ({ data: [later, appointment], internal: 'secret' }) }, profile);
  const result = await client.find({ date: '2026-09-24' });
  assert.deepEqual(result.map(row => row.id), [service.id, appointment.id]);
  assert.equal(result[0].status.code, 'ARCHIVADA');
  assert.doesNotMatch(JSON.stringify(result), /secret|private|internal|passwordHash|isFinal|INACTIVE/);
  assert.deepEqual(Object.keys(result[0]).sort(), ['id', 'startsAt', 'endsAt', 'origin', 'status', 'branch', 'service', 'professional', 'user'].sort());
});

test('agenda: DTO inválido no es éxito', async () => {
  for (const data of [null, {}, [null], [{ ...appointment, id: 'not-uuid' }], [{ ...appointment, startsAt: '2026-02-30T13:00:00.000Z' }],
    [{ ...appointment, endsAt: appointment.startsAt }], [{ ...appointment, status: 'AGENDADA' }], [{ ...appointment, professional: { ...appointment.professional, titleOrFunction: 7 } }]]) {
    await assert.rejects(createAgendaApi({ request: async () => ({ data }) }, profile).find({ date: '2026-09-24' }));
  }
});

test('agenda: errores 400/401/403/404/genéricos no filtran contenido remoto', () => {
  for (const [code, message] of [[400, /fecha/], [401, /sesión/], [403, /permiso/], [404, /contexto/], [500, /conexión/]]) {
    const error = new ApiError(code); error.message = 'secret stack password';
    assert.match(agendaError(error), message); assert.doesNotMatch(agendaError(error), /secret|stack|password/);
  }
  assert.doesNotMatch(agendaError(new Error('secret')), /secret/);
});

test('agenda: zona real para formato y fallback UTC explícito, sin reinterpretar el día consultado', () => {
  assert.match(formatAgendaTime(appointment.startsAt, 'America/Bogota'), /08:00/);
  assert.match(formatAgendaTime(appointment.startsAt, null), /13:00/);
});

test('agenda catálogos: endpoints existentes acotados a institución/sede sin permisos administrativos', async () => {
  const calls = [];
  const client = createAgendaCatalogApi({ request: async (path, options) => { calls.push({ path, options }); return catalogResponse(path); } }, profile);
  const signal = new AbortController().signal;
  assert.equal(await client.timeZone(signal), 'America/Bogota');
  const options = await client.options(signal);
  assert.deepEqual(options.branches, [appointment.branch]); assert.deepEqual(options.services, [appointment.service]);
  assert.deepEqual(options.professionals, [{ id: appointment.professional.id, name: 'Persona Profesional' }]);
  assert.equal(calls.length, 4);
  assert.ok(calls.every(call => call.options.signal === signal && !call.options.body));
  assert.ok(calls.every(call => !call.path.includes('administration')));
});

test('agenda catálogos: rechaza relaciones ajenas, zona inválida y limita ramas al contexto', async () => {
  const client = createAgendaCatalogApi({ request: async path => {
    if (path.endsWith('/branches')) return { data: [{ ...appointment.branch, institutionId: service.id }] };
    return { data: { id: institutionId, timeZone: 'Invalid/Zone' } };
  } }, profile);
  await assert.rejects(client.options()); await assert.rejects(client.timeZone());
  const calls = [];
  const scoped = createAgendaCatalogApi({ request: async path => { calls.push(path); return path.endsWith('/branches')
    ? { data: [{ ...appointment.branch, institutionId }, { id: service.id, name: 'Otra sede', institutionId }] } : catalogResponse(path); } }, { ...profile, context: { institutionId, branchId: branch.id } });
  assert.deepEqual((await scoped.options()).branches, [appointment.branch]);
  assert.ok(!calls.some(path => path.startsWith(`branches/${service.id}/`)));
});

test('agenda model: sin permiso/contexto no realiza llamadas; branchContext no puede editarse', async () => {
  for (const user of [{ ...profile, permissions: [] }, { ...profile, context: {} }]) {
    const model = createAgendaModel({ request() { assert.fail('No requests'); } }, user);
    await model.activate(); await model.consult(); model.setFilters({ date: '2026-09-24' });
    assert.equal(model.getSnapshot().status, 'denied');
  }
  const model = createAgendaModel({}, { ...profile, context: { institutionId, branchId: branch.id } });
  model.setFilters({ branchId: service.id }); assert.equal(model.getSnapshot().filters.branchId, branch.id);
});

test('agenda model: loading/success/empty/error; catálogos fallidos no ocultan historial ni bloquean fecha', async () => {
  let response = { data: [appointment] };
  const model = createAgendaModel({ request: async path => { if (path !== 'agenda') throw new Error('secret catalog'); if (response instanceof Error) throw response; return response; } }, profile);
  await model.activate(); assert.equal(model.getSnapshot().zoneStatus, 'error');
  model.setFilters({ date: '2026-09-24' });
  const first = model.consult(); assert.equal(model.getSnapshot().status, 'loading'); await first;
  assert.deepEqual(model.getSnapshot().items, [appointment]); assert.deepEqual(model.getSnapshot().catalogs.services, [appointment.service]);
  response = { data: [] }; await model.consult(); assert.equal(model.getSnapshot().status, 'ready'); assert.deepEqual(model.getSnapshot().items, []);
  response = new Error('secret stack'); await model.consult(); assert.equal(model.getSnapshot().status, 'error');
  assert.deepEqual(model.getSnapshot().items, []); assert.doesNotMatch(model.getSnapshot().error, /secret|stack/);
});

test('agenda model: cambios de filtro abortan y descartan respuesta/rechazo obsoleto incluso sin cancelar transporte', async () => {
  const old = deferred(), current = deferred(); const calls = [];
  const model = createAgendaModel({ request: (_path, options) => { calls.push(options); return calls.length === 1 ? old.promise : current.promise; } }, profile);
  model.setFilters({ date: '2026-09-24' }); const first = model.consult();
  model.setFilters({ date: '2026-09-25' }); assert.equal(calls[0].signal.aborted, true); assert.deepEqual(model.getSnapshot().items, []);
  const second = model.consult(); current.resolve({ data: [] }); await second;
  old.resolve({ data: [appointment] }); await first;
  assert.deepEqual(model.getSnapshot().items, []); assert.equal(model.getSnapshot().status, 'ready');
  const late = deferred(); const other = createAgendaModel({ request: () => late.promise }, profile);
  other.setFilters({ date: '2026-09-24' }); const request = other.consult(); other.setFilters({ status: 'CANCELADA' });
  late.reject(new Error('secret')); await request; assert.equal(other.getSnapshot().status, 'idle'); assert.equal(other.getSnapshot().error, '');
});

test('agenda model: dispose/reactivate invalida peticiones previas y no restaura datos tras desmontaje', async () => {
  const late = deferred();
  const model = createAgendaModel({ request: path => path === 'agenda' ? late.promise : Promise.resolve(catalogResponse(path)) }, profile);
  model.setFilters({ date: '2026-09-24' }); const pending = model.consult(); model.dispose(); await model.activate();
  late.resolve({ data: [appointment] }); await pending;
  assert.equal(model.getSnapshot().status, 'idle'); assert.deepEqual(model.getSnapshot().items, []);
  assert.equal(model.getSnapshot().timeZone, 'America/Bogota'); model.dispose();
});
