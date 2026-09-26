import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ApiError, createHttpClient } from '@citajusta/client-core';
import { availabilityPermissions, availabilityError, availabilityPatch, createAvailabilityAdministrationApi, blockTypes } from '../src/availability/availability-api.ts';
import { institutionalInstant, institutionalInterval } from '../src/availability/institutional-time.ts';
import { createAvailabilityModel } from '../src/availability/availability-model.ts';
import { profile, availability, block, input, branch, service, institutionId, response } from './fixtures/availability.mjs';
import { deferred } from './fixtures/agenda.mjs';
const signal = new AbortController().signal;
const status = code => error => error.status === code;

test('HU032 GET paths, query allowlist, context headers, branch fixed, DTO allowlist and active/inactive', async () => {
  const seen = [];
  const api = createHttpClient({ baseUrl: 'http://localhost/api/v1', fetcher: async (url, options) => {
    seen.push(url); assert.equal(options.headers.get('x-institution-id'), institutionId); assert.equal(options.headers.get('x-branch-id'), branch.id);
    assert.equal(options.body, undefined); assert.equal(options.signal, signal);
    return Response.json({ data: url.includes('blocks') ? [{ ...block, createdByUserId: 'SECRET' }] : [{ ...availability, lockVersion: 42 }, { ...availability, active: false }] });
  } });
  const client = createAvailabilityAdministrationApi(api, { ...profile, context: { institutionId, branchId: branch.id } });
  const filters = { date: availability.date, serviceId: service.id, professionalId: availability.professional.id, institutionId: 'foreign', actor: 'foreign', status: 'unknown' };
  assert.deepEqual(await client.find(filters, signal), [availability, { ...availability, active: false }]);
  assert.deepEqual(await client.blocks(filters, signal), [block]);
  assert.equal(seen[0], `http://localhost/api/v1/availability/administration?date=${availability.date}&branchId=${branch.id}&serviceId=${service.id}&professionalId=${availability.professional.id}`);
  assert.equal(seen[1], `http://localhost/api/v1/availability/blocks/administration?date=${availability.date}&branchId=${branch.id}&professionalId=${availability.professional.id}`);
  await assert.rejects(client.find({ date: availability.date, branchId: service.id }, signal), status(404));
});
test('HU032 invalid dates, malformed DTOs and missing data do not become successful reads', async () => {
  for (const data of [null, [{}], [{ ...availability, active: 'true' }], [{ ...availability, startTime: '25:00' }], [{ ...availability, timeZone: 'Invalid/Zone' }]]) {
    await assert.rejects(createAvailabilityAdministrationApi({ request: async () => ({ data }) }, profile).find({ date: availability.date }, signal));
  }
  const client = createAvailabilityAdministrationApi({ request: () => assert.fail('transport') }, profile);
  for (const date of ['', '2026-02-30', '26-09-2026']) await assert.rejects(client.find({ date }, signal), status(400));
});
test('HU032 permission gates independent of roles; no institution denies all', async () => {
  for (const key of ['read', 'create', 'update', 'block']) {
    const permissions = availabilityPermissions({ ...profile, permissions: [`availability.${key}`], roles: ['ADMIN'] });
    assert.deepEqual(permissions, { read: key === 'read', create: key === 'create', update: key === 'update', block: key === 'block' });
  }
  assert.deepEqual(availabilityPermissions({ ...profile, context: {} }), { read: false, create: false, update: false, block: false });
  const client = createAvailabilityAdministrationApi({ request: () => assert.fail('transport') }, { ...profile, permissions: [] });
  await assert.rejects(client.find({ date: availability.date }, signal), status(403));
  assert.throws(() => client.create(input, 'UTC', signal), status(403));
  assert.throws(() => client.block({ ...input, type: 'MANUAL' }, 'UTC', signal), status(403));
  await assert.rejects(client.deactivate(availability, signal), status(403));
});
test('HU032 create body exact and no automatic write replay; identities and point omitted', async () => {
  let seen;
  const client = createAvailabilityAdministrationApi({ request: async (path, options) => { seen = { path, ...options }; return { data: { id: availability.id } }; } }, profile);
  await client.create({ ...input, institutionId: 'bad', userId: 'bad', attentionPointId: branch.id, origin: 'bad', capacity: 999 }, 'America/Bogota', signal);
  assert.equal(seen.path, 'availability'); assert.equal(seen.method, 'POST'); assert.equal(seen.retryAfterRefresh, false);
  assert.deepEqual(seen.body, { branchId: branch.id, serviceId: service.id, professionalId: availability.professional.id, startsAt: '2035-01-15T14:00:00.000Z', endsAt: '2035-01-15T15:00:00.000Z' });
  assert.deepEqual(seen.institutionContext, { institutionId });
});
test('HU032 unchanged PATCH not sent; interval minimal, deactivate and explicit reactivate', async () => {
  const calls = [];
  const client = createAvailabilityAdministrationApi({ request: async (path, options) => { calls.push({ path, ...options }); return { data: { id: availability.id } }; } }, profile);
  assert.equal(availabilityPatch(availability, input, 'America/Bogota'), null);
  assert.equal(await client.update(availability, input, 'America/Bogota', signal), false); assert.equal(calls.length, 0);
  await client.update(availability, { ...input, startTime: '10:00', endTime: '11:00' }, 'America/Bogota', signal);
  assert.deepEqual(calls[0].body, { startsAt: '2035-01-15T15:00:00.000Z', endsAt: '2035-01-15T16:00:00.000Z' });
  await client.deactivate(availability, signal); assert.deepEqual(calls[1].body, { active: false });
  await client.update({ ...availability, active: false }, input, 'America/Bogota', signal, true);
  assert.deepEqual(calls[2].body, { startsAt: '2035-01-15T14:00:00.000Z', endsAt: '2035-01-15T15:00:00.000Z', active: true });
  for (const call of calls) { assert.equal(call.path, `availability/${availability.id}`); assert.equal(call.method, 'PATCH'); assert.equal(call.retryAfterRefresh, false); }
});
test('HU032 block exact types, optional professional/reason, no point or service', async () => {
  const calls = [];
  const client = createAvailabilityAdministrationApi({ request: async (path, options) => { assert.equal(path, 'availability/blocks'); calls.push(options.body); return { data: { id: block.id } }; } }, profile);
  for (const type of blockTypes) await client.block({ ...input, professionalId: undefined, type }, 'UTC', signal);
  assert.deepEqual(calls.map(c => c.type), [...blockTypes]);
  assert.deepEqual(Object.keys(calls[0]).sort(), ['branchId','startsAt','endsAt','type'].sort());
  await client.block({ ...input, type: 'OTHER', reason: null, attentionPointId: branch.id }, 'UTC', signal); assert.equal(calls.at(-1).reason, null);
  await client.block({ ...input, type: 'MANUAL', reason: '  Reunión  ' }, 'UTC', signal); assert.equal(calls.at(-1).reason, 'Reunión');
  assert.throws(() => client.block({ ...input, type: 'NEW' }, 'UTC', signal), status(400));
  assert.throws(() => client.block({ ...input, type: 'MANUAL', reason: 'x'.repeat(2001) }, 'UTC', signal), status(400));
});
test('HU032 institutional conversion independent of device timezone and fractional offsets', () => {
  const old = process.env.TZ;
  try {
    for (const zone of ['Pacific/Honolulu', 'Asia/Tokyo']) { process.env.TZ = zone; assert.equal(institutionalInstant('2035-01-15', '09:00', 'America/Santiago'), '2035-01-15T12:00:00.000Z'); }
    assert.equal(institutionalInstant('2035-01-15', '09:00', 'Asia/Kathmandu'), '2035-01-15T03:15:00.000Z');
  } finally { if (old === undefined) delete process.env.TZ; else process.env.TZ = old; }
});
test('HU032 nonexistent/ambiguous civil hours rejected; no silent normalization or invalid intervals', () => {
  for (const [date, time, zone] of [['2026-03-08','02:30','America/New_York'], ['2026-11-01','01:30','America/New_York'], ['2026-02-30','09:00','UTC'], ['2026-09-26','24:00','UTC'], ['2026-09-26','09:00:01','UTC']]) assert.throws(() => institutionalInstant(date, time, zone));
  assert.throws(() => institutionalInterval('2035-01-15', '10:00', '09:00', 'UTC'));
});
test('HU032 all errors sanitized, including 409 and unknown SQL', () => {
  for (const code of [400,401,403,404,409,500]) { const message = availabilityError(new ApiError(code, { message: 'SECRET SQL' })); assert.ok(message.length); assert.doesNotMatch(message, /SECRET|SQL/); }
  assert.match(availabilityError(new ApiError(409)), /protegidos/);
});
function modelFixture(overrides = {}) {
  const calls = [];
  const model = createAvailabilityModel({ request: async (path, options = {}) => { calls.push({ path, options }); if (overrides.request) return overrides.request(path, options); return options.method ? { data: { id: availability.id } } : response(path); } }, profile);
  return { model, calls };
}
test('HU032 model loading, empty, success and error; no stale rows after filter change', async () => {
  let fail = false, empty = false;
  const { model } = modelFixture({ request: async path => { if (fail) throw new ApiError(409); return path.startsWith('availability/') && empty ? { data: [] } : response(path); } });
  await model.activate(); assert.equal(model.getSnapshot().catalogStatus, 'ready');
  model.setFilters({ date: availability.date }); const request = model.consult(); assert.equal(model.getSnapshot().status, 'loading');
  await request; assert.deepEqual(model.getSnapshot().items, [availability]); assert.deepEqual(model.getSnapshot().blocks, [block]);
  model.setFilters({ date: '2035-01-16' }); assert.equal(model.getSnapshot().status, 'idle'); assert.deepEqual(model.getSnapshot().items, []);
  empty = true; await model.consult(); assert.equal(model.getSnapshot().status, 'ready'); assert.deepEqual(model.getSnapshot().items, []);
  fail = true; await model.consult(); assert.equal(model.getSnapshot().status, 'error'); assert.match(model.getSnapshot().error, /Conflicto/); model.dispose();
});
test('HU032 stale responses, abort and disposal cannot overwrite current filters/state', async () => {
  const pending = deferred(); let oldSignal;
  const { model } = modelFixture({ request: async (path, options) => { if (path === 'availability/administration' && options.query.date === availability.date) { oldSignal = options.signal; return pending.promise; } return path.startsWith('availability/') ? { data: [] } : response(path); } });
  await model.activate(); model.setFilters({ date: availability.date }); const first = model.consult();
  model.setFilters({ date: '2035-01-16' }); assert.equal(oldSignal.aborted, true); await model.consult();
  pending.resolve({ data: [availability] }); await first; assert.deepEqual(model.getSnapshot().items, []);
  model.dispose(); assert.equal(model.getSnapshot().status, 'idle');
});
test('HU032 double submit guarded; real success refreshes; failure and unchanged update never refresh', async () => {
  const pending = deferred(); let fail = false;
  const { model, calls } = modelFixture({ request: async (path, options) => { if (options.method) { if (fail) throw new ApiError(409); return pending.promise; } return response(path); } });
  await model.activate(); model.setFilters({ date: availability.date });
  const first = model.create(input); assert.equal(model.getSnapshot().busy, true);
  assert.equal(await model.create(input), false); assert.equal(calls.filter(c => c.options.method).length, 1);
  pending.resolve({ data: { id: availability.id } }); assert.equal(await first, true); assert.equal(model.getSnapshot().busy, false); assert.equal(model.getSnapshot().failed, false);
  const reads = calls.filter(c => c.path === 'availability/administration').length;
  fail = true; assert.equal(await model.create(input), false); assert.equal(model.getSnapshot().failed, true);
  assert.equal(calls.filter(c => c.path === 'availability/administration').length, reads);
  assert.equal(await model.update(availability, input, false), false); assert.equal(calls.filter(c => c.path === 'availability/administration').length, reads);
  model.dispose();
});
test('HU032 catalog selection uses actual branch/service professional relation', async () => {
  const { model, calls } = modelFixture(); await model.activate();
  await model.choose(branch.id, service.id);
  assert.ok(calls.some(c => c.path === `branches/${branch.id}/services/${service.id}/professionals`));
  assert.equal(model.getSnapshot().choices.professionals[0].id, availability.professional.id);
  await model.choose(''); assert.deepEqual(model.getSnapshot().choices.professionals, []); model.dispose();
});
test('HU032 dispose pending write cannot refresh or show success in next activation', async () => {
  const pending = deferred();
  const { model, calls } = modelFixture({ request: async (path, options) => options.method ? pending.promise : response(path) });
  await model.activate(); model.setFilters({ date: availability.date }); const first = model.create(input);
  model.dispose(); await model.activate(); pending.resolve({ data: { id: availability.id } });
  assert.equal(await first, false); assert.equal(model.getSnapshot().feedback, ''); assert.equal(calls.filter(c => c.path === 'availability/administration').length, 0); model.dispose();
});
