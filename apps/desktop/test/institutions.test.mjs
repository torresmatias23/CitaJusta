import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { ApiError } from '@citajusta/client-core';
import { createInstitutionsModel, decodeInstitution } from '../src/institutions/institutions-model.ts';

const row = { id: randomUUID(), name: 'Institution', legalName: null, taxIdentifier: null, contactEmail: null, phone: null,
  timeZone: 'America/Santiago', status: 'ACTIVE', createdAt: '2026-10-18T12:00:00.000Z', updatedAt: '2026-10-18T12:00:00.000Z' };
const input = { name: 'Institution', legalName: null, taxIdentifier: null, contactEmail: null, phone: null };
test('RF005 decoder returns only controlled fields and validates identifiers/status/dates', () => {
  assert.deepEqual(decodeInstitution({ ...row, secret: 'PRIVATE' }), row);
  for (const patch of [{ id: 'invalid' }, { status: 'ADMIN' }, { createdAt: 'not a date' }]) assert.throws(() => decodeInstitution({ ...row, ...patch }));
});
test('RF005 server-verified GLOBAL capabilities govern writes; no institutional context sent', async () => {
  const calls = [];
  const model = createInstitutionsModel({ async request(path, options) { calls.push({ path, options }); return { data: [row], permissions: { create: false, update: false } }; } });
  assert.equal(await model.save(undefined, input), false); await model.activate();
  assert.equal(await model.save(undefined, input), false); assert.equal(await model.save(row.id, input), false);
  assert.equal(calls.length, 1); assert.equal(calls[0].options.institutionContext, undefined);
  model.dispose();
});
test('RF005 denial hides records and actions, and renders a controlled error', async () => {
  const model = createInstitutionsModel({ async request() { throw new ApiError(403); } }); await model.activate();
  assert.equal(model.getSnapshot().status, 'error'); assert.deepEqual(model.getSnapshot().permissions, { create: false, update: false });
  assert.deepEqual(model.getSnapshot().items, []); assert.match(model.getSnapshot().feedback, /GLOBAL/); model.dispose();
});
test('RF005 writes allowlist fields, never retry automatically and refresh after success', async () => {
  const calls = [];
  const model = createInstitutionsModel({ async request(path, options) {
    calls.push({ path, options }); return options.method ? { data: row } : { data: [row], permissions: { create: true, update: true } };
  } }); await model.activate();
  assert.equal(await model.save(undefined, { ...input, timeZone: 'UTC', userId: randomUUID(), status: 'INACTIVE' }), true);
  assert.equal(calls[1].path, 'institutions'); assert.deepEqual(calls[1].options.body, { ...input, timeZone: 'UTC' });
  assert.equal(calls[1].options.retryAfterRefresh, false); assert.equal(calls[1].options.institutionContext, undefined);
  assert.equal(await model.save(row.id, { ...input, timeZone: 'UTC' }), true);
  assert.deepEqual(calls[3].options.body, input); assert.equal(calls[3].options.method, 'PATCH'); assert.equal(calls.length, 5); model.dispose();
});
test('RF005 double submission produces one write and stale response after dispose cannot restore data', async () => {
  let release, writes = 0;
  const model = createInstitutionsModel({ async request(path, options) {
    if (options.method) { writes++; return new Promise(resolve => { release = () => resolve({ data: row }); }); }
    return { data: [row], permissions: { create: true, update: true } };
  } }); await model.activate();
  const first = model.save(undefined, input); assert.equal(await model.save(undefined, input), false); assert.equal(writes, 1);
  model.dispose(); release(); assert.equal(await first, false); assert.deepEqual(model.getSnapshot().items, []);
});
test('RF005 late list from previous activation cannot overwrite the current activation', async () => {
  let release, count = 0;
  const model = createInstitutionsModel({ async request() {
    if (++count === 1) return new Promise(resolve => { release = () => resolve({ data: [row], permissions: { create: true, update: true } }); });
    return { data: [], permissions: { create: false, update: false } };
  } }); const first = model.activate(); model.dispose(); await model.activate(); release(); await first;
  assert.deepEqual(model.getSnapshot().items, []); assert.equal(model.getSnapshot().permissions.create, false); model.dispose();
});
