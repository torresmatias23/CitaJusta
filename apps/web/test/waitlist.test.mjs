import assert from 'node:assert/strict';
import test from 'node:test';
import { createWaitlistApi, waitlistErrorMessage } from '../src/features/waitlist/waitlist-api.ts';
import { createSubmissionLock } from '../src/features/appointments/appointments-api.ts';
import { ApiError, createHttpClient } from '../src/lib/http-client.ts';

const id = '10000000-0000-4000-8000-000000000001';
const serviceId = '10000000-0000-4000-8000-000000000002';
const branchId = '10000000-0000-4000-8000-000000000003';
const entry = { id, status: 'ACTIVE', enteredAt: '2030-05-27T13:30:00.000Z', service: { id: serviceId, name: 'Orientación' }, branch: null };
const preferences = { preferredDays: [1, 5], timeRanges: [{ start: '09:00', end: '12:00' }], preferredBranchIds: [branchId], allowsOtherBranches: false, acceptsAnyProfessional: true };
function setup(data) {
  const calls = [];
  return { calls, api: createWaitlistApi({ request: async (path, options = {}) => { calls.push({ path, ...options }); return { data }; } }) };
}

test('waitlist GET propio sin filtros de identidad, preserva orden/estado real y propaga AbortSignal', async () => {
  const second = { ...entry, id: branchId, status: 'OFFERED' };
  const { api, calls } = setup([entry, second]);
  const signal = new AbortController().signal;
  assert.deepEqual(await api.list(signal), [entry, second]);
  assert.deepEqual(calls, [{ path: 'waitlist', signal }]);
  assert.deepEqual(await setup([]).api.list(), []);
});

test('alta envía sólo serviceId/branchId, nunca userId/institutionId ni retries', async () => {
  const { api, calls } = setup(entry);
  await api.enter({ serviceId, branchId, userId: id, institutionId: id });
  await api.enter({ serviceId, userId: id });
  assert.deepEqual(calls, [
    { path: 'waitlist', method: 'POST', body: { serviceId, branchId }, retryAfterRefresh: false },
    { path: 'waitlist', method: 'POST', body: { serviceId }, retryAfterRefresh: false },
  ]);
});

test('GET preferencias usa contrato HU-008 y descarta datos internos', async () => {
  const { api, calls } = setup({ ...preferences, userId: id, privateNotes: 'secret' });
  assert.deepEqual(await api.preferences(id), preferences);
  assert.deepEqual(calls, [{ path: `waitlist/${id}/preferences` }]);
});

test('PUT reemplaza exactamente las cinco preferencias y preserva false y arrays vacíos', async () => {
  const empty = { preferredDays: [], timeRanges: [], preferredBranchIds: [], allowsOtherBranches: false, acceptsAnyProfessional: false };
  for (const input of [preferences, empty]) {
    const { api, calls } = setup(input);
    assert.deepEqual(await api.updatePreferences(id, { ...input, userId: id, institutionId: id, professionalId: id }), input);
    assert.deepEqual(calls, [{ path: `waitlist/${id}/preferences`, method: 'PUT', body: input, retryAfterRefresh: false }]);
  }
});

test('retiro POST sin body ni filtros, valida identidad y estado de respuesta', async () => {
  const { api, calls } = setup({ id, status: 'WITHDRAWN', userId: id });
  assert.deepEqual(await api.withdraw(id), { id, status: 'WITHDRAWN' });
  assert.deepEqual(calls, [{ path: `waitlist/${id}/withdraw`, method: 'POST', retryAfterRefresh: false }]);
  await assert.rejects(setup({ id: branchId, status: 'WITHDRAWN' }).api.withdraw(id));
  await assert.rejects(setup({ id, status: 'ACTIVE' }).api.withdraw(id));
});

test('rechaza respuestas de lista/alta/preferencias inválidas sin presentarlas como éxito', async () => {
  for (const value of [null, {}, [null], [{ ...entry, enteredAt: 'mañana' }], [{ ...entry, branch: {} }], [{ ...entry, status: '' }]]) {
    await assert.rejects(setup(value).api.list());
  }
  await assert.rejects(setup({}).api.enter({ serviceId }));
  for (const value of [null, {}, { ...preferences, allowsOtherBranches: 'false' }, { ...preferences, preferredDays: [8] }, { ...preferences, timeRanges: [{ start: '25:00', end: '26:00' }] }]) {
    await assert.rejects(setup(value).api.preferences(id));
  }
});

test('DTO público descarta identidad, prioridad y campos sensibles de lista y alta', async () => {
  const extra = { ...entry, userId: id, institutionId: id, priorityId: id, token: 'secret' };
  assert.deepEqual(await setup([extra]).api.list(), [entry]);
  assert.deepEqual(await setup(extra).api.enter({ serviceId }), entry);
});

test('errores 400/401/403/404/409/503 controlados y errores internos nunca se muestran', () => {
  for (const status of [400, 401, 403, 404, 409, 503]) {
    const error = new ApiError(status);
    error.message = 'password token Prisma SQL secret';
    assert.doesNotMatch(waitlistErrorMessage(error), /password|token|Prisma|SQL|secret/);
  }
  assert.match(waitlistErrorMessage(new ApiError(409)), /conflicto/);
  assert.match(waitlistErrorMessage(new ApiError(403)), /autorización/);
  assert.doesNotMatch(waitlistErrorMessage(new Error('secret')), /secret/);
});

test('doble submit bloquea cada escritura durante la petición sin reenviarla', async () => {
  for (const action of ['enter', 'updatePreferences', 'withdraw']) {
    let resolve;
    let count = 0;
    const api = createWaitlistApi({ request: async () => {
      count++;
      await new Promise((done) => { resolve = done; });
      return { data: action === 'enter' ? entry : action === 'withdraw' ? { id, status: 'WITHDRAWN' } : preferences };
    } });
    const lock = createSubmissionLock();
    const invoke = () => action === 'enter' ? api.enter({ serviceId }) : action === 'withdraw' ? api.withdraw(id) : api.updatePreferences(id, preferences);
    const pending = lock.run(invoke);
    assert.equal(await lock.run(invoke), undefined);
    assert.equal(count, 1);
    resolve();
    await pending;
  }
});

test('409 no provoca retry y HTTP descarta cuerpo sensible', async () => {
  let calls = 0;
  const api = createWaitlistApi(createHttpClient({ baseUrl: 'http://localhost:3000/api/v1', fetcher: async () => {
    calls++;
    return new Response(JSON.stringify({ message: 'secret Prisma SQL' }), { status: 409 });
  } }));
  await assert.rejects(api.enter({ serviceId }), (error) => error instanceof ApiError && error.status === 409 && !error.message.includes('secret'));
  assert.equal(calls, 1);
});

test('catálogos usan GET reales sin inventar sedes, instituciones ni elegibilidad', async () => {
  const services = setup([{ id: serviceId, name: 'Orientación', institution: { id, name: 'Institución' } }]);
  assert.equal((await services.api.services())[0].institution.name, 'Institución');
  assert.equal(services.calls[0].path, 'services');
  const branches = setup({ branches: [{ id: branchId, name: 'Centro' }] });
  assert.deepEqual(await branches.api.branches(serviceId), [{ id: branchId, name: 'Centro' }]);
  assert.equal(branches.calls[0].path, `services/${serviceId}`);
});
