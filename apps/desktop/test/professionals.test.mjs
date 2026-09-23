import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { ApiError } from '@citajusta/client-core';
import { createProfessionalApi, professionalPermissions, professionalError } from '../src/professionals/professional-api.ts';
import { createProfessionalModel } from '../src/professionals/professional-model.ts';
import { account, branch, service, professional, profile, response } from './fixtures/professionals.mjs';

test('HU-030 administrative list and exact email lookup use session API/context and discard private fields', async () => {
  const calls = [];
  const client = createProfessionalApi({ request: async (path, options) => {
    calls.push({ path, options });
    if (path.endsWith('eligible-users')) return { data: { ...account, passwordHash: 'secret', phone: 'private', roles: ['private'] } };
    return { data: [{ ...professional, deletedAt: 'secret', user: { ...account, nationalIdentifier: 'private' } }] };
  } }, profile);
  const signal = new AbortController().signal;
  assert.deepEqual(await client.list(signal), [professional]);
  assert.deepEqual(await client.eligible(' Professional@Example.Test ', signal), account);
  assert.deepEqual(calls.map(c => c.path), ['professionals/administration', 'professionals/eligible-users']);
  assert.deepEqual(calls[1].options.query, { email: 'Professional@Example.Test' });
  for (const c of calls) { assert.deepEqual(c.options.institutionContext, profile.context); assert.equal(c.options.signal, signal); assert.equal(c.options.body, undefined); }
});
test('HU-030 permission gates require institution, reject branch and never infer from roles', async () => {
  for (const user of [{ ...profile, context: {} }, { ...profile, context: { ...profile.context, branchId: branch.id } }, { ...profile, permissions: [], roles: ['ADMIN'] }]) {
    const model = createProfessionalModel({ request() { assert.fail('No request without access'); } }, user);
    await model.activate(); await model.search(account.email);
    assert.equal(await model.save(undefined, {}), false); assert.equal(model.getSnapshot().status, 'denied');
  }
  assert.deepEqual(professionalPermissions({ ...profile, permissions: ['professionals.read'] }), { read: true, catalogs: false, create: false, update: false });
  const paths = [];
  const model = createProfessionalModel({ request: async path => { paths.push(path); return response(path); } }, { ...profile, permissions: ['professionals.read'] });
  await model.activate(); assert.deepEqual(paths, ['professionals/administration']);
});
test('HU-030 create payload allowlist and immutable user on PATCH, no retry after refresh', async () => {
  const calls = [];
  const client = createProfessionalApi({ request: async (path, options) => { calls.push({ path, options }); return response(path, options); } }, profile);
  const allowed = { internalCode: null, titleOrFunction: 'Atención', status: 'ACTIVE', branchIds: [branch.id], serviceIds: [service.id] };
  const unsafe = { ...allowed, institutionId: 'foreign', actor: 'foreign', password: 'secret', roles: [], userId: 'foreign' };
  const signal = new AbortController().signal;
  await client.save(undefined, unsafe, account.id, signal);
  assert.deepEqual(calls[0].options.body, { ...allowed, userId: account.id });
  await client.save(professional.id, unsafe, account.id, signal);
  assert.deepEqual(calls[1].options.body, allowed);
  assert.equal(calls[1].path, `professionals/${professional.id}`);
  for (const c of calls) assert.equal(c.options.retryAfterRefresh, false);
  await assert.rejects(client.save('../escape', {}, account.id, signal));
  assert.equal(calls.length, 2);
});
test('HU-030 loading/empty/error/retry states stay sanitized', async () => {
  let fail = true;
  const model = createProfessionalModel({ request: async () => { if (fail) throw new Error('Prisma token private'); return { data: [] }; } }, profile);
  assert.equal(model.getSnapshot().status, 'loading');
  await model.activate(); assert.equal(model.getSnapshot().status, 'error');
  assert.doesNotMatch(JSON.stringify(model.getSnapshot()), /Prisma|token|private/);
  fail = false; await model.reload(); assert.equal(model.getSnapshot().status, 'ready'); assert.deepEqual(model.getSnapshot().items, []);
  for (const code of [401, 403, 404, 409]) assert.doesNotMatch(professionalError(new ApiError(code)), /stack|Prisma|Bearer/);
});
test('HU-030 create requires eligible account; create/update refresh only after real success and block duplicates', async () => {
  const calls = []; let finish;
  const model = createProfessionalModel({ request: (path, options) => {
    calls.push({ path, options });
    if (options.method) return new Promise(resolve => { finish = () => resolve(response(path, options)); });
    return Promise.resolve(response(path, options));
  } }, profile);
  await model.activate(); assert.equal(await model.save(undefined, {}), false);
  await model.search(account.email); assert.deepEqual(model.getSnapshot().eligible, account);
  for (const id of [undefined, professional.id]) {
    const before = calls.length;
    const saving = model.save(id, { branchIds: [branch.id], serviceIds: [service.id], status: 'SUSPENDED' });
    assert.equal(model.getSnapshot().busy, true); assert.equal(model.getSnapshot().feedback, '');
    assert.equal(await model.save(id, {}), false); assert.equal(calls.length, before + 1);
    finish(); assert.equal(await saving, true); assert.equal(calls.length, before + 4);
    assert.equal(model.getSnapshot().feedback, 'Profesional guardado.');
  }
});
test('HU-030 write failure does not report success or refresh', async () => {
  const paths = [];
  const model = createProfessionalModel({ request: async (path, options) => {
    paths.push(path); if (options.method) throw new ApiError(409); return response(path, options);
  } }, profile);
  await model.activate();
  const before = paths.length;
  assert.equal(await model.save(professional.id, { status: 'INACTIVE' }), false);
  assert.equal(paths.length, before + 1); assert.equal(model.getSnapshot().failed, true);
  assert.doesNotMatch(model.getSnapshot().feedback, /guardado/);
});
test('HU-030 changed email cancels eligibility and latest search wins even if transport ignores abort', async () => {
  const pending = [];
  const model = createProfessionalModel({ request: async (path, options) => path.endsWith('eligible-users')
    ? new Promise(resolve => pending.push({ resolve, options })) : response(path, options) }, profile);
  await model.activate();
  const first = model.search(account.email); const second = model.search('other@example.test');
  assert.equal(pending[0].options.signal.aborted, true);
  pending[1].resolve({ data: { ...account, email: 'other@example.test' } }); await second;
  pending[0].resolve({ data: account }); await first;
  assert.equal(model.getSnapshot().eligible.email, 'other@example.test');
  model.clearEligible(); assert.equal(model.getSnapshot().eligible, null);
  const late = model.search(account.email); model.dispose();
  pending[2].resolve({ data: account }); await late; assert.equal(model.getSnapshot().eligible, null);
});
test('HU-030 disposed list and writes cannot repopulate a new context or StrictMode activation', async () => {
  const pending = [];
  const model = createProfessionalModel({ request: (path, options) => new Promise(resolve => pending.push({ path, options, resolve })) }, profile);
  const old = model.activate(); model.dispose(); const fresh = model.activate();
  for (const c of pending.slice(0, 3)) { assert.equal(c.options.signal.aborted, true); c.resolve(response(c.path)); }
  await old; assert.equal(model.getSnapshot().status, 'loading');
  for (const c of pending.slice(3)) c.resolve({ data: [] });
  await fresh; assert.deepEqual(model.getSnapshot().items, []);
  let finish;
  const writing = createProfessionalModel({ request: (path, options) => options.method
    ? new Promise(resolve => { finish = () => resolve(response(path, options)); }) : Promise.resolve(response(path, options)) }, profile);
  await writing.activate();
  const save = writing.save(professional.id, { status: 'INACTIVE' });
  writing.dispose(); await writing.activate(); finish();
  assert.equal(await save, false);
  assert.equal(writing.getSnapshot().feedback, '');
});
test('HU-030 all persisted statuses are accepted, malformed DTOs rejected; shell uses module without direct fetch', async () => {
  for (const status of ['ACTIVE', 'INACTIVE', 'SUSPENDED']) {
    const api = createProfessionalApi({ request: async () => ({ data: [{ ...professional, status }] }) }, profile);
    assert.equal((await api.list(new AbortController().signal))[0].status, status);
  }
  const api = createProfessionalApi({ request: async () => ({ data: [{ ...professional, status: 'INVALID' }] }) }, profile);
  await assert.rejects(api.list(new AbortController().signal));
  const app = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');
  assert.match(app, /selected === 'Profesionales' \? <ProfessionalPage/);
  for (const file of ['professional-api.ts', 'professional-model.ts', 'professional-forms.tsx', 'professional-page.tsx']) {
    const source = await readFile(new URL(`../src/professionals/${file}`, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /\bfetch\s*\(|createHttpClient|plugin-http/);
  }
});
