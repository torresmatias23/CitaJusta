import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ApiError } from '@citajusta/client-core';
import { createReportsApi, reportsQuery, reportsError, parseIndicators } from '../src/reports/reports-api.ts';
import { createReportsModel } from '../src/reports/reports-model.ts';
import { profile as agendaProfile, branch, service, appointment, catalogResponse, deferred } from './fixtures/agenda.mjs';

export const profile = { ...agendaProfile, permissions: ['reports.read'] };
export const period = { from: '2026-09-01', to: '2026-09-30' };
export const indicators = () => ({ data: { period: { ...period }, appointments: { scheduled: 11, cancelled: 7, noShows: 3 },
  slots: { released: 5, recovered: 2, recoveryRatePct: 37.19 }, offers: { sent: 23, accepted: 2, rejected: 9, expired: 12 } } });
const signal = () => new AbortController().signal;
const status = code => error => error instanceof ApiError && error.status === code;

test('HU037 required civil dates, invalid dates, reversed ranges and >366 days never request', async () => {
  let calls = 0; const api = createReportsApi({ request: async () => { calls++; } }, profile);
  for (const filters of [{}, { from: period.from }, { to: period.to }, { ...period, from: '' },
    { ...period, from: '2026-02-30' }, { ...period, from: '2026-09-01T00:00:00Z' },
    { from: period.to, to: period.from }, { from: '2024-01-01', to: '2025-01-01' }]) {
    await assert.rejects(api.find(filters, signal()), status(400));
  }
  assert.equal(calls, 0);
});
test('HU037 accepts one day and inclusive 366 days without converting request dates', () => {
  for (const filters of [{ from: '2026-01-01', to: '2026-01-01' }, { from: '2024-01-01', to: '2024-12-31' }]) assert.deepEqual(reportsQuery(filters), filters);
});
test('HU037 unknown and invalid optional filters rejected, empty filters omitted', () => {
  for (const key of ['userId', 'institutionId', 'actor', 'unknown']) assert.throws(() => reportsQuery({ ...period, [key]: branch.id }), status(400));
  for (const key of ['branchId', 'serviceId', 'professionalId']) assert.throws(() => reportsQuery({ ...period, [key]: 'invalid' }), status(400));
  assert.deepEqual(reportsQuery({ ...period, branchId: '', serviceId: '', professionalId: '' }), period);
});
test('HU037 request uses existing client, exact route/query/context and no body', async () => {
  const filters = { ...period, branchId: branch.id, serviceId: service.id, professionalId: appointment.professional.id };
  let calls = 0;
  const api = createReportsApi({ request: async (path, options) => {
    calls++; assert.equal(path, 'reports/indicators'); assert.deepEqual(options.query, filters);
    assert.deepEqual(options.institutionContext, { institutionId: profile.context.institutionId });
    assert.equal(options.body, undefined); assert.equal(options.method, undefined); assert.ok(options.signal instanceof AbortSignal);
    return indicators();
  } }, profile);
  assert.deepEqual(await api.find(filters, signal()), indicators().data); assert.equal(calls, 1);
});
test('HU037 branch context enforced and conflicting query never sent', async () => {
  let calls = 0; const user = { ...profile, context: { ...profile.context, branchId: branch.id } };
  const api = createReportsApi({ request: async (_path, options) => {
    calls++; assert.equal(options.query.branchId, branch.id); assert.deepEqual(options.institutionContext, user.context); return indicators();
  } }, user);
  await api.find(period, signal());
  await assert.rejects(api.find({ ...period, branchId: service.id }, signal()), status(404)); assert.equal(calls, 1);
});
test('HU037 no permission or institution means no API or catalog calls', async () => {
  for (const user of [{ ...profile, permissions: [] }, { ...profile, context: {} }]) {
    const model = createReportsModel({ request: async () => { assert.fail('unexpected request'); } }, user);
    await model.activate(); await model.consult(); assert.equal(model.getSnapshot().status, 'denied'); model.dispose();
  }
});
test('HU037 maps all backend values including an intentionally non-derived recovery rate', () => {
  const result = parseIndicators(indicators(), period);
  assert.deepEqual(result, indicators().data); assert.equal(result.slots.recoveryRatePct, 37.19);
  assert.notEqual(result.slots.recoveryRatePct, result.slots.recovered / result.slots.released * 100);
});
test('HU037 rejects incomplete, invalid and mismatched response without trusting extra internal fields', () => {
  for (const change of [d => { delete d.offers; }, d => { d.slots.recoveryRatePct = '37'; }, d => { d.appointments.scheduled = -1; }, d => { d.offers.sent = NaN; }, d => { d.period.to = '2026-10-01'; }]) {
    const value = indicators(); change(value.data); assert.throws(() => parseIndicators(value, period));
  }
  const value = indicators(); value.data.secret = 'internal'; assert.deepEqual(parseIndicators(value, period), indicators().data);
});
test('HU037 zero values are valid data, not an error', () => {
  const value = indicators(); for (const key of ['appointments', 'slots', 'offers']) for (const name of Object.keys(value.data[key])) value.data[key][name] = 0;
  assert.deepEqual(parseIndicators(value, period), value.data);
});
test('HU037 sanitized messages for 400 401 403 404 503 and unexpected failures', () => {
  const messages = [400, 401, 403, 404, 503].map(code => reportsError(new ApiError(code, 'SQL SECRET')));
  assert.equal(new Set(messages).size, 5);
  for (const message of [...messages, reportsError(new Error('SQL SECRET'))]) assert.doesNotMatch(message, /SQL|SECRET|stack/);
  assert.match(messages[3], /contexto/);
});
function modelWith(request, user = profile) {
  const model = createReportsModel({ request }, user); model.setFilter('from', period.from); model.setFilter('to', period.to); return model;
}
test('HU037 catalog failure does not block period-only reports.read consultation', async () => {
  const model = modelWith(async path => { if (path === 'reports/indicators') return indicators(); throw new ApiError(403); });
  await model.activate(); assert.equal(model.getSnapshot().catalogStatus, 'error'); await model.consult();
  assert.equal(model.getSnapshot().status, 'ready'); model.dispose();
});
test('HU037 existing public catalogs populate optional selectors with reports.read only', async () => {
  const model = modelWith(async path => catalogResponse(path)); await model.activate();
  assert.equal(model.getSnapshot().catalogStatus, 'ready'); assert.equal(model.getSnapshot().catalogs.branches[0].id, branch.id);
  assert.equal(model.getSnapshot().catalogs.services[0].id, service.id); assert.equal(model.getSnapshot().catalogs.professionals[0].id, appointment.professional.id); model.dispose();
});
test('HU037 loading prevents duplicate sends and successful result is displayed', async () => {
  const pending = deferred(); let calls = 0; const model = modelWith(async () => { calls++; return pending.promise; });
  const work = model.consult(); assert.equal(model.getSnapshot().status, 'loading'); await model.consult(); assert.equal(calls, 1);
  pending.resolve(indicators()); await work; assert.deepEqual(model.getSnapshot().data, indicators().data); model.dispose();
});
test('HU037 filter change aborts and discards stale response even if transport ignores abort', async () => {
  const pending = deferred(); let requestSignal; const model = modelWith(async (_path, options) => { requestSignal = options.signal; return pending.promise; });
  const work = model.consult(); model.setFilter('to', '2026-10-01'); assert.equal(requestSignal.aborted, true);
  pending.resolve(indicators()); await work; assert.equal(model.getSnapshot().status, 'idle'); assert.equal(model.getSnapshot().data, null); model.dispose();
});
test('HU037 error clears prior results and can retry', async () => {
  let fail = false; const model = modelWith(async () => { if (fail) throw new ApiError(503, 'SQL'); return indicators(); });
  await model.consult(); fail = true; await model.consult(); assert.equal(model.getSnapshot().status, 'error'); assert.equal(model.getSnapshot().data, null);
  assert.doesNotMatch(model.getSnapshot().error, /SQL/); fail = false; await model.consult(); assert.equal(model.getSnapshot().status, 'ready'); model.dispose();
});
test('HU037 fixed branch cannot change through model and disposal prevents stale publication', async () => {
  const pending = deferred(); const model = modelWith(async () => pending.promise, { ...profile, context: { ...profile.context, branchId: branch.id } });
  model.setFilter('branchId', service.id); assert.equal(model.getSnapshot().filters.branchId, undefined);
  const work = model.consult(); model.dispose(); pending.resolve(indicators()); await work; assert.equal(model.getSnapshot().data, null);
});
