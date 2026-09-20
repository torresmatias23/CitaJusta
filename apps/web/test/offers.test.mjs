import assert from 'node:assert/strict';
import test from 'node:test';
import { canRespondToOffer, createOffersApi, offerErrorMessage, offerStatuses, parseOffer } from '../src/features/offers/offers-api.ts';
import { createSubmissionLock } from '../src/features/appointments/appointments-api.ts';
import { ApiError, createHttpClient } from '../src/lib/http-client.ts';

const id = '10000000-0000-4000-8000-000000000001';
const other = '10000000-0000-4000-8000-000000000002';
const offer = {
  id, status: 'PENDING', createdAt: '2030-05-27T13:00:00.000Z', expiresAt: '2030-05-27T13:07:00.000Z', respondedAt: null,
  startsAt: '2030-05-28T15:00:00.000Z', endsAt: '2030-05-28T15:30:00.000Z',
  service: { id, name: 'Orientación' }, branch: { id, name: 'Centro' }, professional: { id, firstNames: 'Ana', lastNames: 'Pérez' },
};
const accepted = { offer: { id, status: 'ACCEPTED', respondedAt: '2030-05-27T13:02:00.000Z' },
  appointment: { id: other, agendaSlotId: id, status: 'AGENDADA', startsAt: offer.startsAt, endsAt: offer.endsAt },
  reassignment: { id: other, status: 'COMPLETED' } };
const rejected = { offer: { id, status: 'REJECTED', respondedAt: accepted.offer.respondedAt },
  reassignment: { id: other, status: 'OFFERING' }, nextOffer: { id: other, status: 'PENDING', expiresAt: offer.expiresAt } };
function setup(data) {
  const calls = [];
  return { calls, api: createOffersApi({ request: async (path, options = {}) => { calls.push({ path, ...options }); return { data }; } }) };
}

test('GET own offers uses exact route without identity/context and preserves order/signal', async () => {
  const { api, calls } = setup([offer, { ...offer, id: other }]);
  const signal = new AbortController().signal;
  assert.deepEqual(await api.list(signal), [offer, { ...offer, id: other }]);
  assert.deepEqual(calls, [{ path: 'reassignments/offers/me', signal }]);
  assert.deepEqual(await setup([]).api.list(), []);
});

test('public decoder drops internal fields, including nested PII and ranking', () => {
  assert.deepEqual(parseOffer({ ...offer, userId: id, institutionId: other, scoring: {}, priority: 2,
    candidate: { email: 'private' }, professional: { ...offer.professional, userId: other, email: 'private', phone: 'private' } }), offer);
});

test('all persisted states and actual seven-minute expiresAt survive decoding without time mutation', () => {
  for (const status of offerStatuses) {
    const original = { ...offer, status };
    assert.deepEqual(parseOffer(original), original);
    assert.equal(parseOffer(original).expiresAt, '2030-05-27T13:07:00.000Z');
  }
});

test('PENDING can respond only before expiry; finals never allow response', () => {
  const expiry = Date.parse(offer.expiresAt);
  assert.equal(canRespondToOffer(offer, expiry - 1), true);
  assert.equal(canRespondToOffer(offer, expiry), false);
  assert.equal(canRespondToOffer(offer, expiry + 1), false);
  assert.equal(offer.status, 'PENDING');
  for (const status of offerStatuses.filter((s) => s !== 'PENDING')) assert.equal(canRespondToOffer({ ...offer, status }, expiry - 1), false);
});

test('accept POST exact path, no body, no retry; returns real transferred appointment only', async () => {
  const { api, calls } = setup(accepted);
  const signal = new AbortController().signal;
  assert.deepEqual(await api.accept(id, signal), { offer: accepted.offer,
    appointment: { id: other, status: 'AGENDADA', startsAt: offer.startsAt, endsAt: offer.endsAt } });
  assert.deepEqual(calls, [{ path: `reassignments/offers/${id}/accept`, method: 'POST', retryAfterRefresh: false, signal }]);
});

test('reject POST exact path, no body/retry; nextOffer never retained as own offer', async () => {
  const { api, calls } = setup(rejected);
  assert.deepEqual(await api.reject(id), { offer: rejected.offer });
  assert.deepEqual(calls, [{ path: `reassignments/offers/${id}/reject`, method: 'POST', retryAfterRefresh: false }]);
  assert.doesNotMatch(JSON.stringify(await api.reject(id)), /nextOffer|reassignment/);
});

test('malformed offer lists, dates and unknown statuses are rejected', async () => {
  for (const data of [null, {}, [null], [{ ...offer, id: 'invalid' }], [{ ...offer, status: 'NEW' }],
    [{ ...offer, expiresAt: 'tomorrow' }], [{ ...offer, expiresAt: offer.createdAt }],
    [{ ...offer, endsAt: offer.startsAt }], [{ ...offer, professional: {} }], [{ ...offer, respondedAt: undefined }]]) {
    await assert.rejects(setup(data).api.list());
  }
});

test('writes validate response identity/status/appointment before reporting success', async () => {
  for (const data of [{}, { ...accepted, offer: { ...accepted.offer, id: other } },
    { ...accepted, offer: rejected.offer }, { ...accepted, appointment: {} }]) await assert.rejects(setup(data).api.accept(id));
  for (const data of [{}, { ...rejected, offer: accepted.offer }, { ...rejected, offer: { ...rejected.offer, id: other } }]) await assert.rejects(setup(data).api.reject(id));
  const { api, calls } = setup(accepted);
  await assert.rejects(api.accept('../invalid')); await assert.rejects(api.reject('bad'));
  assert.equal(calls.length, 0);
});

test('shared submission lock blocks simultaneous accept/reject until response, not just render', async () => {
  let release; let count = 0;
  const api = createOffersApi({ request: async () => {
    count++; await new Promise((resolve) => { release = resolve; }); return { data: accepted };
  } });
  const lock = createSubmissionLock();
  const pending = lock.run(() => api.accept(id));
  assert.equal(await lock.run(() => api.reject(id)), undefined);
  assert.equal(await lock.run(() => api.accept(id)), undefined);
  assert.equal(count, 1); release(); assert.equal((await pending).offer.status, 'ACCEPTED');
});

test('HTTP 409 is sanitized and never retried for either action', async () => {
  for (const action of ['accept', 'reject']) {
    let count = 0;
    const api = createOffersApi(createHttpClient({ baseUrl: 'http://localhost:3000/api/v1', fetcher: async () => {
      count++; return new Response(JSON.stringify({ message: 'private PostgreSQL password' }), { status: 409 });
    } }));
    await assert.rejects(api[action](id), (error) => error instanceof ApiError && error.status === 409 && !error.message.includes('private'));
    assert.equal(count, 1);
  }
});

test('401/403/404/409 and unexpected errors have controlled user messages', () => {
  for (const status of [400, 401, 403, 404, 409, 500, 503]) {
    const error = new ApiError(status); error.message = 'private SQL password';
    assert.doesNotMatch(offerErrorMessage(error), /private|SQL|password/);
  }
  assert.match(offerErrorMessage(new ApiError(409)), /venció o cambió/);
  assert.match(offerErrorMessage(new Error('private')), /Mis citas/);
});
