import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { ApiError, createAuthSession } from '@citajusta/client-core';
import { createMemorySessionStorage } from '../src/auth/memory-session-storage.ts';
import { createCatalogModel } from '../src/catalog/catalog-model.ts';
import { catalogPermissions, createCatalogApi } from '../src/catalog/catalog-api.ts';
import { branch, service, profile, institutionId, catalogResponse } from './fixtures/catalog.mjs';

test('catalog loads through session.api with contextual administrative routes and controlled DTOs', async () => {
  const calls = [];
  const session = createAuthSession({
    publicApi: { request: async () => ({ accessToken: 'test-access', refreshToken: 'test-refresh', tokenType: 'Bearer' }) },
    authenticatedApi: () => ({ request: async (path, options) => {
      calls.push({ path, options });
      if (path === 'users/me') return { data: profile };
      const response = catalogResponse(path);
      return { data: response.data.map(item => ({ ...item, deletedAt: 'private', institutionId: 'private' })) };
    } }), storage: createMemorySessionStorage(),
  });
  await session.login({ email: profile.email, password: 'test-only' });
  const model = createCatalogModel(session.api, session.getSnapshot().user);
  assert.equal(model.getSnapshot().branches.status, 'loading');
  await model.activate();
  assert.deepEqual(model.getSnapshot().branches.items, [branch]);
  assert.deepEqual(model.getSnapshot().services.items, [service]);
  for (const call of calls.slice(1)) {
    assert.deepEqual(call.options.institutionContext, { institutionId });
    assert.equal(call.options.query, undefined);
    assert.equal(call.options.body, undefined);
  }
  assert.deepEqual(calls.slice(1).map(c => c.path).sort(), ['branches/administration', 'services/administration', 'services/categories']);
  model.dispose();
});
test('permissions never inferred from roles; denied context issues no public fallback requests', async () => {
  for (const user of [{ ...profile, permissions: [], roles: ['ADMIN'] }, { ...profile, context: {} }]) {
    const model = createCatalogModel({ request() { assert.fail('No requests without permission/context'); } }, user);
    await model.activate();
    assert.equal(model.getSnapshot().branches.status, 'denied');
    assert.equal(model.getSnapshot().services.status, 'denied');
    assert.equal(await model.saveBranch(undefined, { code: 'NO' }), false);
    model.dispose();
  }
  const scoped = { ...profile, context: { institutionId, branchId: branch.id } };
  assert.deepEqual(catalogPermissions(scoped), { branches: true, services: false, createBranch: false, updateBranch: true, createService: false, updateService: false });
  const calls = [];
  const model = createCatalogModel({ request: async (path, options) => { calls.push({ path, options }); return catalogResponse(path); } }, scoped);
  await model.activate();
  assert.deepEqual(calls.map(c => c.path), ['branches/administration']);
  assert.equal(calls[0].options.institutionContext.branchId, branch.id);
});
test('empty/error/retry and malformed responses have controlled state without internal errors', async () => {
  let fail = true;
  const model = createCatalogModel({ request: async () => { if (fail) throw new Error('Prisma private detail'); return { data: [] }; } }, profile);
  await model.activate();
  assert.equal(model.getSnapshot().branches.status, 'error');
  assert.doesNotMatch(JSON.stringify(model.getSnapshot()), /Prisma|private/);
  fail = false; await model.reload();
  assert.equal(model.getSnapshot().branches.status, 'ready');
  assert.deepEqual(model.getSnapshot().branches.items, []);
  const invalid = createCatalogApi({ request: async () => ({ data: [{ ...branch, status: 'UNKNOWN' }] }) }, profile);
  await assert.rejects(invalid.branches(new AbortController().signal));
  const mismatched = createCatalogApi({ request: async () => ({ data: { ...branch, id: service.id } }) }, profile);
  await assert.rejects(mismatched.saveBranch(branch.id, { status: 'ACTIVE' }, new AbortController().signal));
});
test('create/edit send only domain body, no automatic write retry, and refresh real catalogs', async () => {
  const calls = [];
  const model = createCatalogModel({ request: async (path, options) => {
    calls.push({ path, options });
    if (options.method) return { data: path.startsWith('branches') ? branch : service };
    return catalogResponse(path);
  } }, profile);
  await model.activate();
  for (const [operation, id, input, path] of [
    ['saveBranch', undefined, { code: 'NEW', name: 'Nueva' }, 'branches'],
    ['saveBranch', branch.id, { status: 'ACTIVE' }, `branches/${branch.id}`],
    ['saveService', undefined, { code: 'NEW', name: 'Nuevo', durationMinutes: 20 }, 'services'],
    ['saveService', service.id, { active: true, branchIds: [] }, `services/${service.id}`],
  ]) {
    const before = calls.length;
    assert.equal(await model[operation](id, input), true);
    const write = calls[before];
    assert.equal(write.path, path);
    assert.equal(write.options.method, id ? 'PATCH' : 'POST');
    assert.deepEqual(write.options.body, input);
    assert.equal(write.options.body.institutionId, undefined);
    assert.equal(write.options.retryAfterRefresh, false);
    assert.equal(calls.length, before + 4);
  }
  assert.equal(model.getSnapshot().feedback, 'Cambios guardados.');
});
test('busy prevents duplicate writes and failures preserve actionable feedback', async () => {
  let reject;
  let writes = 0;
  const model = createCatalogModel({ request: (path, options) => {
    if (options.method) { writes++; return new Promise((_, fail) => { reject = fail; }); }
    return Promise.resolve(catalogResponse(path));
  } }, profile);
  await model.activate();
  const saving = model.saveService(service.id, { active: true });
  assert.equal(model.getSnapshot().busy, true);
  assert.equal(await model.saveService(service.id, { active: true }), false);
  assert.equal(writes, 1);
  reject(new ApiError(409));
  assert.equal(await saving, false);
  assert.equal(model.getSnapshot().busy, false);
  assert.equal(model.getSnapshot().failed, true);
  assert.match(model.getSnapshot().feedback, /conflicto/);
});
test('disposal/context replacement prevents stale reads and writes from updating the next view', async () => {
  const pending = [];
  const model = createCatalogModel({ request: (path, options) => new Promise(resolve => pending.push({ path, options, resolve })) }, profile);
  const first = model.activate();
  model.dispose();
  const second = model.activate();
  for (const call of pending.slice(0, 3)) {
    assert.equal(call.options.signal.aborted, true);
    call.resolve(catalogResponse(call.path));
  }
  await first;
  assert.equal(model.getSnapshot().branches.status, 'loading');
  for (const call of pending.slice(3)) call.resolve({ data: [] });
  await second;
  assert.deepEqual(model.getSnapshot().branches.items, []);
  model.dispose();
});
test('module replaces shell placeholder and never adds direct fetch/another HTTP client', async () => {
  const app = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');
  assert.match(app, /selected === 'Sedes y servicios' \? <CatalogPage/);
  for (const file of ['catalog-api.ts', 'catalog-model.ts', 'catalog-page.tsx', 'catalog-forms.tsx']) {
    const source = await readFile(new URL(`../src/catalog/${file}`, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /\bfetch\s*\(|createHttpClient|plugin-http/);
  }
});
