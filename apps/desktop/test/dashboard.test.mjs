import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ApiError } from '@citajusta/client-core';
import { createDashboardApi, parseDashboard } from '../src/dashboard/dashboard-api.ts';
import { createDashboardModel, presetRange } from '../src/dashboard/dashboard-model.ts';
import { branch, service, catalogResponse } from './fixtures/agenda.mjs';
import { profile, period, dashboard } from './fixtures/dashboard.mjs';

const signal = () => new AbortController().signal;
const status = code => error => error instanceof ApiError && error.status === code;

test('HU037 presets produce inclusive civil ranges ending today', () => {
  const today = new Date(2026, 10, 24, 15, 30);
  assert.deepEqual(presetRange('7', today), { from: '2026-11-18', to: '2026-11-24' });
  assert.deepEqual(presetRange('30', today), { from: '2026-10-26', to: '2026-11-24' });
  assert.deepEqual(presetRange('90', today), { from: '2026-08-27', to: '2026-11-24' });
  assert.deepEqual(presetRange('month', today), { from: '2026-11-01', to: '2026-11-24' });
  assert.deepEqual(presetRange('month', new Date(2026, 10, 1)), { from: '2026-11-01', to: '2026-11-01' });
});
test('HU037 dashboard request reuses reports validation, exact route, context and no body', async () => {
  let calls = 0;
  const api = createDashboardApi({ request: async (path, options) => {
    calls++; assert.equal(path, 'reports/dashboard'); assert.deepEqual(options.query, { ...period, serviceId: service.id });
    assert.deepEqual(options.institutionContext, { institutionId: profile.context.institutionId });
    assert.equal(options.body, undefined); assert.equal(options.method, undefined); return dashboard();
  } }, profile);
  assert.deepEqual(await api.find({ ...period, serviceId: service.id, branchId: '' }, signal()), dashboard().data);
  for (const filters of [{ from: period.to, to: period.from }, { from: '2024-01-01', to: '2025-01-01' }, { ...period, userId: branch.id }]) {
    await assert.rejects(api.find(filters, signal()), status(400));
  }
  assert.equal(calls, 1);
  await assert.rejects(createDashboardApi({ request: async () => assert.fail('no call') }, { ...profile, permissions: [] }).find(period, signal()), status(403));
});
test('HU037 parser rejects malformed, negative, unexpected period and unknown severities', () => {
  assert.deepEqual(parseDashboard(dashboard(), period), dashboard().data);
  const broken = [
    d => { d.data.period.from = '2026-10-01'; }, d => { d.data.granularity = 'month'; }, d => { d.data.rates.noShowRatePct = -1; },
    d => { d.data.appointmentStatus.total = 1.5; }, d => { d.data.trend[0].start = '01-11-2026'; }, d => { d.data.services = 'x'; },
    d => { d.data.insights[0].severity = 'critical'; }, d => { d.data.insights[0].title = ''; }, d => { d.data.waitlist.byPriority[0].level = 'x'; },
    d => { delete d.data.capacity; },
  ];
  for (const mutate of broken) { const value = dashboard(); mutate(value); assert.throws(() => parseDashboard(value, period)); }
});
test('HU037 model opens with last 30 days consulted and loads filter catalogs', async () => {
  const paths = [];
  const model = createDashboardModel({ request: async (path, options) => {
    paths.push(path);
    if (path === 'reports/dashboard') return dashboard({ from: options.query.from, to: options.query.to });
    return catalogResponse(path);
  } }, profile, () => new Date(2026, 10, 24));
  await model.activate();
  const state = model.getSnapshot();
  assert.equal(state.status, 'ready'); assert.equal(state.preset, '30'); assert.deepEqual(state.filters, { from: '2026-10-26', to: '2026-11-24' });
  assert.equal(state.catalogStatus, 'ready'); assert.equal(paths[0], 'reports/dashboard');
  await model.applyPreset('7');
  assert.deepEqual(model.getSnapshot().filters, { from: '2026-11-18', to: '2026-11-24' }); assert.equal(model.getSnapshot().data.period.from, '2026-11-18');
  model.setFilter('from', '2026-11-20');
  assert.equal(model.getSnapshot().preset, null); assert.equal(model.getSnapshot().status, 'idle'); assert.equal(model.getSnapshot().data, null);
  model.dispose();
});
test('HU037 without permission or institution nothing is requested; errors are friendly', async () => {
  for (const user of [{ ...profile, permissions: [] }, { ...profile, context: {} }]) {
    const model = createDashboardModel({ request: async () => assert.fail('unexpected request') }, user);
    await model.activate(); await model.consult(); assert.equal(model.getSnapshot().status, 'denied'); model.dispose();
  }
  const failing = createDashboardModel({ request: async path => { if (path === 'reports/dashboard') throw new ApiError(503); return catalogResponse(path); } }, profile);
  await failing.activate();
  assert.equal(failing.getSnapshot().status, 'error'); assert.match(failing.getSnapshot().error, /no están disponibles temporalmente/);
  failing.dispose();
});
test('HU037 stale responses never overwrite a newer consultation and branch context stays fixed', async () => {
  let release;
  const slow = new Promise(resolve => { release = resolve; });
  let call = 0;
  const user = { ...profile, context: { ...profile.context, branchId: branch.id } };
  const model = createDashboardModel({ request: async (path, options) => {
    if (path !== 'reports/dashboard') return catalogResponse(path);
    assert.equal(options.query.branchId, branch.id);
    if (++call === 1) { await slow; return dashboard({ from: options.query.from, to: options.query.to }); }
    return dashboard({ from: options.query.from, to: options.query.to });
  } }, user, () => new Date(2026, 10, 24));
  const first = model.consult();
  await model.applyPreset('7');
  release(); await first;
  assert.equal(model.getSnapshot().data.period.from, '2026-11-18');
  model.setFilter('branchId', service.id); assert.equal(model.getSnapshot().filters.branchId, undefined);
  model.dispose();
});
