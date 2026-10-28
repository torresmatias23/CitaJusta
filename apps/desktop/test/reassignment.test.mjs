import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ApiError, createHttpClient } from '@citajusta/client-core';
import {
  createReassignmentApi, parseReassignment, parseReassignmentListingPage, reassignmentError, reassignmentListingError, reassignmentListingQuery,
} from '../src/reassignments/reassignment-api.ts';
import { createReassignmentModel } from '../src/reassignments/reassignment-model.ts';
import { id, profile, processFixture } from './fixtures/reassignment.mjs';

function listingRow(patch = {}) {
  const process = processFixture();
  return {
    id: process.id, status: process.status, detectedAt: process.detectedAt, startedAt: process.startedAt, finishedAt: process.finishedAt,
    closureReasonCode: process.closureReasonCode, branch: process.branch, service: process.service,
    agendaSlot: { id: process.agendaSlot.id, startsAt: process.agendaSlot.startsAt, endsAt: process.agendaSlot.endsAt }, ...patch,
  };
}
function listingPage(data = [listingRow()], nextCursor = null) { return { data, page: { nextCursor } }; }

test('RF038 UUID inválido falla antes del transporte del detalle existente', async () => {
  const api = createReassignmentApi({ request() { assert.fail('No request'); } }, profile);
  for (const value of ['', 'invalid', '../secret', undefined]) await assert.rejects(api.find(value, new AbortController().signal), error => error.status === 400);
});
for (const branch of [undefined, id(4)]) test(`RF038 detalle exacto y headers de contexto ${branch ? 'BRANCH' : 'INSTITUTION'}`, async () => {
  const signal = new AbortController().signal;
  const http = createHttpClient({ baseUrl: 'http://localhost:3000/api/v1', fetcher: async (url, options) => {
    assert.equal(url, `http://localhost:3000/api/v1/reassignments/${id(3)}`);
    assert.equal(options.method, 'GET'); assert.equal(options.body, undefined); assert.equal(options.signal, signal);
    assert.equal(options.headers.get('x-institution-id'), id(2)); assert.equal(options.headers.get('x-branch-id'), branch ?? null);
    return Response.json({ data: processFixture() });
  } });
  const result = await createReassignmentApi(http, { ...profile, context: { ...profile.context, ...(branch ? { branchId: branch } : {}) } }).find(id(3), signal);
  assert.equal(result.id, id(3)); assert.equal(result.appointment.currentUserId, id(1));
});
test('RF038 GET listado usa cliente compartido, filtro, límite, cursor y solo headers institucionales', async () => {
  const signal = new AbortController().signal;
  const http = createHttpClient({ baseUrl: 'http://localhost:3000/api/v1', fetcher: async (url, options) => {
    const target = new URL(url); assert.equal(target.pathname, '/api/v1/reassignments');
    assert.equal(target.searchParams.get('status'), 'OFFERING'); assert.equal(target.searchParams.get('limit'), '50'); assert.equal(target.searchParams.get('cursor'), 'cursor_1');
    assert.equal(options.method, 'GET'); assert.equal(options.body, undefined); assert.equal(options.signal, signal);
    assert.equal(options.headers.get('x-institution-id'), id(2)); assert.equal(options.headers.get('x-branch-id'), id(4));
    return Response.json(listingPage([listingRow()], 'cursor_2'));
  } });
  const page = await createReassignmentApi(http, { ...profile, context: { institutionId: id(2), branchId: id(4) } }).list('OFFERING', signal, 'cursor_1');
  assert.equal(page.data[0].service.name, 'Atención controlada'); assert.equal(page.nextCursor, 'cursor_2');
});
test('RF038 permiso y contexto no se infieren de roles ni habilitan transporte', async () => {
  for (const user of [{ ...profile, permissions: [], roles: ['ADMIN'] }, { ...profile, context: {} }]) {
    const api = { request() { assert.fail('No request'); } };
    await assert.rejects(createReassignmentApi(api, user).list(undefined, new AbortController().signal), error => error.status === 403);
    await assert.rejects(createReassignmentApi(api, user).find(id(3), new AbortController().signal), error => error.status === 403);
    const model = createReassignmentModel(api, user); model.activate(); model.setId(id(3)); await model.consultById();
    assert.equal(model.getSnapshot().status, 'denied'); assert.equal(model.getSnapshot().id, ''); model.dispose();
  }
});
test('RF038 decoder del listado acepta solo resumen público y contrato estricto', () => {
  const data = listingRow(); data.passwordHash = 'secret'; data.branch.token = 'secret'; data.agendaSlot.offer = 'secret';
  const result = parseReassignmentListingPage(listingPage([data], 'cursor_1'));
  assert.deepEqual(Object.keys(result.data[0]).sort(), ['agendaSlot', 'branch', 'closureReasonCode', 'detectedAt', 'finishedAt', 'id', 'service', 'startedAt', 'status']);
  assert.doesNotMatch(JSON.stringify(result), /secret|password|offer/);
  for (const mutate of [value => { value.data = {}; }, value => { value.page.nextCursor = '='; }, value => { value.data[0].status = 'ACTIVE'; }, value => { value.data[0].agendaSlot.endsAt = value.data[0].agendaSlot.startsAt; }, value => { value.data[0].id = 'bad'; }]) {
    const value = listingPage([listingRow()]); mutate(value); assert.throws(() => parseReassignmentListingPage(value));
  }
  assert.throws(() => reassignmentListingQuery('ACTIVE'));
});
test('RF038 detalle conserva aislamiento y descarta secretos anidados', async () => {
  for (const patch of [{ id: id(99) }, { institution: { id: id(99), name: 'Otra' } }, { branch: { id: id(99), name: 'Otra' } }]) {
    const api = createReassignmentApi({ request: async () => ({ data: { ...processFixture(), ...patch } }) }, { ...profile, context: { institutionId: id(2), branchId: id(4) } });
    await assert.rejects(api.find(id(3), new AbortController().signal), error => error.status === 404);
  }
  const data = processFixture(); data.passwordHash = 'secret'; data.evaluation.criteriaSnapshot.token = 'secret'; data.candidates[0].recipient.email = 'secret';
  data.candidates[0].snapshot.evaluationContext.preferences.password = 'secret'; data.candidates[0].snapshot.scoreFactors[0].secret = 'secret'; data.offers[0].Authorization = 'secret';
  const result = parseReassignment(data); assert.doesNotMatch(JSON.stringify(result), /secret|email|passwordHash|Authorization/);
  assert.deepEqual(result.candidates.map(candidate => candidate.id), data.candidates.map(candidate => candidate.id)); assert.equal(result.candidates[0].snapshot.totalScore, '123.450000');
  assert.deepEqual(result.offers.map(offer => offer.id), data.offers.map(offer => offer.id));
});
test('RF038 detalle acepta legado y rechaza DTO o factores malformados', () => {
  const data = processFixture(); data.policy = null; data.activeOfferId = null; data.observedAt = '2040-01-01T00:00:00.000Z';
  data.evaluation.criteriaSnapshot = {}; data.evaluation.initiation = { kind: 'NOT_RECORDED', actorUserId: null };
  const result = parseReassignment(data); assert.equal(result.policy, null); assert.equal(result.activeOfferId, null); assert.equal(result.pendingOfferId, id(16)); assert.equal(result.offers[0].status, 'PENDING');
  for (const mutate of [value => { value.id = 'bad'; }, value => { value.candidates = {}; }, value => { value.offers[0].expiresAt = 'tomorrow'; }, value => { value.candidates[0].snapshot.scoreFactors = [{ code: 'SECRET', value: {} }]; }, value => { value.policy.version = 'two'; }]) {
    const invalid = processFixture(); mutate(invalid); assert.throws(() => parseReassignment(invalid));
  }
});
test('RF038 errores de listado y detalle están sanitizados', () => {
  for (const status of [400, 401, 403, 404, 500]) {
    const error = new ApiError(status); error.message = 'SQL password secret';
    assert.doesNotMatch(reassignmentError(error), /SQL|password|secret/); assert.doesNotMatch(reassignmentListingError(error), /SQL|password|secret/);
  }
  assert.match(reassignmentError(new ApiError(404)), /no está disponible en tu contexto/);
});
test('RF038 modelo carga, filtra y reinicia resultados/cursor', async () => {
  const calls = [];
  const model = createReassignmentModel({ request: async (_path, options) => {
    calls.push(options); return listingPage([listingRow()], calls.length === 1 ? 'cursor_1' : null);
  } }, profile);
  const first = model.consult(); assert.equal(model.getSnapshot().status, 'loading'); await first;
  assert.equal(model.getSnapshot().status, 'ready'); assert.equal(model.getSnapshot().nextCursor, 'cursor_1');
  model.setFilter('OFFERING'); await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls[1].query.status, 'OFFERING'); assert.equal(calls[1].query.limit, '50'); assert.equal(model.getSnapshot().data.length, 1); assert.equal(model.getSnapshot().nextCursor, null);
  model.dispose();
});
test('RF038 modelo pagina, evita duplicados y bloquea cargas simultáneas', async () => {
  let calls = 0, release;
  const model = createReassignmentModel({ request: (_path, options) => {
    calls++;
    if (calls === 1) return Promise.resolve(listingPage([listingRow()], 'cursor_1'));
    assert.equal(options.query.cursor, 'cursor_1'); return new Promise(resolve => { release = resolve; });
  } }, profile);
  await model.consult(); const more = model.loadMore(); void model.loadMore(); assert.equal(calls, 2); assert.equal(model.getSnapshot().loadingMore, true);
  release(listingPage([listingRow({ id: id(30) })])); await more;
  assert.deepEqual(model.getSnapshot().data.map(row => row.id), [id(3), id(30)]); assert.equal(model.getSnapshot().nextCursor, null); model.dispose();
});
test('RF038 cambios de filtro y desmontaje abortan y descartan respuestas antiguas', async () => {
  const pending = [];
  const model = createReassignmentModel({ request: (_path, options) => new Promise(resolve => { pending.push({ options, resolve }); }) }, profile);
  const first = model.consult(); model.setFilter('OFFERING'); assert.equal(pending[0].options.signal.aborted, true);
  pending[0].resolve(listingPage([listingRow()])); await first; assert.equal(model.getSnapshot().data.length, 0);
  pending[1].resolve(listingPage([listingRow({ id: id(31), status: 'OFFERING' })])); await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(model.getSnapshot().data.map(row => row.id), [id(31)]);
  const second = model.consult(); model.dispose(); pending[2].resolve(listingPage([listingRow()])); await second; assert.equal(model.getSnapshot().data.length, 0);
});
test('RF038 abrir fila reutiliza GET de detalle y la consulta UUID funciona fuera del listado y filtro', async () => {
  const paths = [];
  const model = createReassignmentModel({ request: async (path) => { paths.push(path); return path === 'reassignments' ? listingPage() : { data: processFixture() }; } }, profile);
  await model.consult(); await model.openDetail(id(3)); assert.equal(paths[1], `reassignments/${id(3)}`); assert.equal(model.getSnapshot().detailStatus, 'ready');
  await model.openDetail(id(99)); assert.equal(paths.length, 2); model.closeDetail(); assert.equal(model.getSnapshot().detail, null); model.dispose();
  const directPaths = [];
  const direct = createReassignmentModel({ request: async (path) => {
    directPaths.push(path); return path === 'reassignments' ? listingPage([]) : { data: processFixture() };
  } }, profile);
  direct.setFilter('FAILED'); await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(direct.getSnapshot().data, []);
  direct.setId(`  ${id(3)}  `); await direct.consultById();
  assert.equal(direct.getSnapshot().detailStatus, 'ready'); assert.equal(direct.getSnapshot().detail.status, 'OFFERING');
  assert.equal(direct.getSnapshot().filter, 'FAILED'); assert.deepEqual(direct.getSnapshot().data, []);
  await direct.consultById(); assert.deepEqual(directPaths, ['reassignments', `reassignments/${id(3)}`, `reassignments/${id(3)}`]);
  direct.dispose();
});

test('RF038 consulta UUID valida antes del transporte y queda disponible con el listado fallido o cargando', async () => {
  let detailCalls = 0;
  const model = createReassignmentModel({ request: async (path) => {
    if (path === 'reassignments') throw new ApiError(500);
    detailCalls++; return { data: processFixture() };
  } }, profile);
  await model.consult(); assert.equal(model.getSnapshot().status, 'error');
  for (const value of ['', 'invalid', '../secret']) {
    model.setId(value); await model.consultById();
    assert.equal(model.getSnapshot().detailStatus, 'error'); assert.match(model.getSnapshot().detailError, /UUID/);
  }
  assert.equal(detailCalls, 0);
  model.setId(id(3)); await model.consultById();
  assert.equal(model.getSnapshot().status, 'error'); assert.equal(model.getSnapshot().detail.id, id(3));
  model.dispose();

  let release;
  const pending = createReassignmentModel({ request: (path) => path === 'reassignments'
    ? new Promise(resolve => { release = resolve; }) : Promise.resolve({ data: processFixture() }) }, profile);
  const listing = pending.consult(); pending.setId(id(3)); await pending.consultById();
  assert.equal(pending.getSnapshot().status, 'loading'); assert.equal(pending.getSnapshot().detailStatus, 'ready');
  release(listingPage()); await listing; pending.dispose();
});

test('RF038 cambios de UUID abortan la consulta previa y doble envío no duplica solicitudes', async () => {
  const pending = [];
  const model = createReassignmentModel({ request: (path, options) => new Promise(resolve => { pending.push({ path, options, resolve }); }) }, profile);
  model.setId(id(3)); const first = model.consultById(); await model.consultById(); assert.equal(pending.length, 1);
  model.setId(id(99)); assert.equal(pending[0].options.signal.aborted, true);
  assert.equal(model.getSnapshot().detailStatus, 'idle'); assert.equal(model.getSnapshot().detail, null);
  const second = model.consultById();
  pending[1].resolve({ data: { ...processFixture(), id: id(99) } }); await second;
  pending[0].resolve({ data: processFixture() }); await first;
  assert.equal(model.getSnapshot().detail.id, id(99)); model.dispose();
});

test('RF038 cambiar filtro o desmontar descarta detalles incluso si el transporte ignora abort', async () => {
  const pending = [];
  const model = createReassignmentModel({ request: (path, options) => path === 'reassignments' ? Promise.resolve(listingPage())
    : new Promise(resolve => { pending.push({ options, resolve }); }) }, profile);
  model.setId(id(3)); const first = model.consultById(); model.setFilter('FAILED');
  assert.equal(pending[0].options.signal.aborted, true); pending[0].resolve({ data: processFixture() }); await first;
  assert.equal(model.getSnapshot().detail, null);
  const second = model.consultById(); model.dispose(); model.activate();
  assert.equal(pending[1].options.signal.aborted, true); pending[1].resolve({ data: processFixture() }); await second;
  assert.equal(model.getSnapshot().detail, null); assert.equal(model.getSnapshot().id, ''); model.dispose();
});

for (const change of [{ context: { institutionId: id(20) } }, { context: { institutionId: id(2), branchId: id(4) } }, { permissions: [] }]) {
  test(`RF038 reemplazar workspace al cambiar contexto/permisos descarta UUID y listado (${JSON.stringify(change)})`, async () => {
    const pending = [];
    const previous = createReassignmentModel({ request: (_path, options) => {
      return new Promise(resolve => { pending.push({ options, resolve }); });
    } }, profile);
    const listing = previous.consult(); previous.setId(id(3)); const detail = previous.consultById(); previous.dispose();
    const next = createReassignmentModel({}, { ...profile, ...change });
    pending[0].resolve(listingPage()); pending[1].resolve({ data: processFixture() }); await Promise.all([listing, detail]);
    assert.ok(pending.every(({ options }) => options.signal.aborted)); assert.equal(next.getSnapshot().id, '');
    assert.equal(next.getSnapshot().detail, null); assert.deepEqual(next.getSnapshot().data, []);
    assert.equal(previous.getSnapshot().detail, null); assert.deepEqual(previous.getSnapshot().data, []); next.dispose();
  });
}

test('RF038 errores UUID no conservan un detalle anterior y están sanitizados', async () => {
  let failure;
  const model = createReassignmentModel({ request: async () => {
    if (failure) throw failure;
    return { data: processFixture() };
  } }, profile);
  model.setId(id(3)); await model.consultById();
  for (const status of [400, 401, 403, 404, 500]) {
    failure = new ApiError(status); failure.message = 'PRIVATE SQL password';
    await model.consultById();
    assert.equal(model.getSnapshot().detailStatus, 'error'); assert.equal(model.getSnapshot().detail, null);
    assert.doesNotMatch(model.getSnapshot().detailError, /PRIVATE|SQL|password/);
  }
  model.dispose();
});

test('RF038 reintenta la primera página con filtro, sin cursor ni solicitudes duplicadas', async () => {
  const calls = []; let release;
  const model = createReassignmentModel({ request: async (_path, options) => {
    calls.push(options);
    if (calls.length === 1) throw new ApiError(500);
    return new Promise(resolve => { release = resolve; });
  } }, profile);
  model.setFilter('OFFERING'); await new Promise(resolve => setImmediate(resolve));
  assert.equal(model.getSnapshot().status, 'error');
  const retry = model.consult(); await model.consult(); assert.equal(calls.length, 2);
  assert.equal(model.getSnapshot().status, 'loading'); assert.equal(model.getSnapshot().error, '');
  assert.deepEqual(calls[1].query, { limit: '50', status: 'OFFERING' });
  assert.deepEqual(calls[1].institutionContext, { institutionId: id(2) });
  release(listingPage([listingRow()], 'next')); await retry;
  assert.equal(model.getSnapshot().status, 'ready'); assert.equal(model.getSnapshot().data.length, 1);
  assert.equal(model.getSnapshot().nextCursor, 'next'); model.dispose();
});

test('RF038 respuesta de reintento obsoleta no contamina el filtro nuevo', async () => {
  const pending = []; let calls = 0;
  const model = createReassignmentModel({ request: (_path, options) => {
    if (++calls === 1) return Promise.reject(new ApiError(500));
    return new Promise(resolve => { pending.push({ options, resolve }); });
  } }, profile);
  await model.consult(); const retry = model.consult(); model.setFilter('FAILED');
  assert.equal(pending[0].options.signal.aborted, true);
  pending[1].resolve(listingPage([listingRow({ id: id(30), status: 'FAILED' })]));
  await new Promise(resolve => setImmediate(resolve));
  pending[0].resolve(listingPage([listingRow()], 'old')); await retry;
  assert.deepEqual(model.getSnapshot().data.map(row => row.id), [id(30)]);
  assert.equal(model.getSnapshot().filter, 'FAILED'); assert.equal(model.getSnapshot().nextCursor, null); model.dispose();
});
