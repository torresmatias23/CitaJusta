import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ApiError, createHttpClient } from '@citajusta/client-core';
import { createReassignmentApi, parseReassignment, reassignmentError } from '../src/reassignments/reassignment-api.ts';
import { createReassignmentModel } from '../src/reassignments/reassignment-model.ts';
import { id, profile, processFixture } from './fixtures/reassignment.mjs';

test('HU036 UUID inválido falla antes del transporte', async () => {
  const api = createReassignmentApi({ request() { assert.fail('No request'); } }, profile);
  for (const value of ['', 'invalid', '../secret', undefined]) await assert.rejects(api.find(value, new AbortController().signal), e => e.status === 400);
});
for (const branch of [undefined, id(4)]) test(`HU036 GET exacto y headers de contexto ${branch ? 'BRANCH' : 'INSTITUTION'}`, async () => {
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
test('HU036 denegación no infiere permiso por rol ni consulta sin institución', async () => {
  for (const user of [{ ...profile, permissions: [], roles: ['ADMIN'] }, { ...profile, context: {} }]) {
    const api = { request() { assert.fail('No request'); } };
    await assert.rejects(createReassignmentApi(api, user).find(id(3), new AbortController().signal), e => e.status === 403);
    const model = createReassignmentModel(api, user); model.setId(id(3)); await model.consult(); assert.equal(model.getSnapshot().status, 'denied'); model.dispose();
  }
});
test('HU036 rechaza identidad, tenant o sede ajenos sin divulgar distinción', async () => {
  for (const patch of [{ id: id(99) }, { institution: { id: id(99), name: 'Otra' } }, { branch: { id: id(99), name: 'Otra' } }]) {
    const api = createReassignmentApi({ request: async () => ({ data: { ...processFixture(), ...patch } }) }, { ...profile, context: { institutionId: id(2), branchId: id(4) } });
    await assert.rejects(api.find(id(3), new AbortController().signal), e => e.status === 404);
  }
});
test('HU036 decoder descarta secretos anidados y conserva scoring/orden sin recalcular', () => {
  const data = processFixture();
  data.passwordHash = 'secret'; data.evaluation.criteriaSnapshot.token = 'secret'; data.candidates[0].recipient.email = 'secret';
  data.candidates[0].snapshot.evaluationContext.preferences.password = 'secret'; data.candidates[0].snapshot.scoreFactors[0].secret = 'secret';
  data.offers[0].Authorization = 'secret';
  const result = parseReassignment(data);
  assert.doesNotMatch(JSON.stringify(result), /secret|email|passwordHash|Authorization/);
  assert.deepEqual(result.candidates.map(c => c.id), data.candidates.map(c => c.id));
  assert.equal(result.candidates[0].snapshot.totalScore, '123.450000');
  assert.deepEqual(result.offers.map(o => o.id), data.offers.map(o => o.id));
});
test('HU036 policy null, snapshots vacíos y PENDING sin activa son válidos', () => {
  const data = processFixture(); data.policy = null; data.activeOfferId = null; data.observedAt = '2040-01-01T00:00:00.000Z';
  data.evaluation.criteriaSnapshot = {}; data.evaluation.initiation = { kind: 'NOT_RECORDED', actorUserId: null };
  const result = parseReassignment(data);
  assert.equal(result.policy, null); assert.equal(result.activeOfferId, null); assert.equal(result.pendingOfferId, id(16)); assert.equal(result.offers[0].status, 'PENDING');
});
test('HU036 DTO malformado y factores ajenos no se aceptan', () => {
  for (const mutate of [d => { d.id = 'bad'; }, d => { d.candidates = {}; }, d => { d.offers[0].expiresAt = 'tomorrow'; }, d => { d.candidates[0].snapshot.scoreFactors = [{ code: 'SECRET', value: {} }]; }, d => { d.policy.version = 'two'; }]) {
    const d = processFixture(); mutate(d); assert.throws(() => parseReassignment(d));
  }
});
test('HU036 errores 400/401/403/404/500 son sanitizados', () => {
  for (const status of [400, 401, 403, 404, 500]) { const e = new ApiError(status); e.message = 'SQL password secret'; assert.doesNotMatch(reassignmentError(e), /SQL|password|secret/); }
  assert.match(reassignmentError(new ApiError(404)), /no está disponible en tu contexto/);
});
test('HU036 modelo idle/loading/ready/refresco y validación local visible', async () => {
  let count = 0;
  const model = createReassignmentModel({ request: async () => { count++; return { data: processFixture() }; } }, profile);
  assert.equal(model.getSnapshot().status, 'idle'); await model.consult(); assert.equal(model.getSnapshot().status, 'error'); assert.match(model.getSnapshot().error, /UUID/); assert.equal(count, 0);
  model.setId(id(3)); const pending = model.consult(); assert.equal(model.getSnapshot().status, 'loading'); await pending; assert.equal(model.getSnapshot().status, 'ready');
  await model.consult(); assert.equal(count, 2); model.dispose(); assert.equal(model.getSnapshot().data, null);
});
test('HU036 cambio de UUID/contexto o desmontaje invalida incluso transporte que ignora abort', async () => {
  let release, signal;
  const model = createReassignmentModel({ request: (_path, options) => { signal = options.signal; return new Promise(resolve => { release = resolve; }); } }, profile);
  model.setId(id(3)); const first = model.consult(); model.setId(id(99)); assert.equal(signal.aborted, true); release({ data: processFixture() }); await first; assert.equal(model.getSnapshot().data, null);
  model.setId(id(3)); const second = model.consult(); model.dispose(); model.activate(); release({ data: processFixture() }); await second;
  assert.equal(model.getSnapshot().status, 'idle'); assert.equal(model.getSnapshot().data, null);
});
test('HU036 errores y doble consulta no mantienen filas antiguas ni peticiones duplicadas', async () => {
  let reject, count = 0;
  const model = createReassignmentModel({ request: () => { count++; return new Promise((_resolve, fail) => { reject = fail; }); } }, profile);
  model.setId(id(3)); const first = model.consult(); await model.consult(); assert.equal(count, 1); reject(new ApiError(404)); await first;
  assert.equal(model.getSnapshot().status, 'error'); assert.equal(model.getSnapshot().data, null); model.dispose();
});
