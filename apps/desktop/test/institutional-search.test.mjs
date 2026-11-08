import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ApiError, createHttpClient } from '@citajusta/client-core';
import { institutionalSearchQuery, parseInstitutionalSearchPage, createInstitutionalSearchApi, searchError } from '../src/institutional-search/institutional-search-api.ts';
import { createInstitutionalSearchModel } from '../src/institutional-search/institutional-search-model.ts';
import { profile, branch, institutionId, service, userId, entryId, otherId, person, waiting, page, deferred } from './fixtures/institutional-search.mjs';
const signal = () => new AbortController().signal;
const status = code => error => error instanceof ApiError && error.status === code;

for (const resource of ['users', 'waitlist']) {
  const filters = resource === 'users' ? { q: ' Ana Prueba ', branchId: branch.id } : { status: ' ACTIVE ', serviceId: service.id, userId, branchId: branch.id };
  const expectedQuery = { limit: '50', ...filters, ...(resource === 'users' ? { q: 'Ana Prueba' } : { status: 'ACTIVE' }) };
  const find = (request, user = profile) => createInstitutionalSearchApi(resource, { request }, user);
  const model = (request, user = profile) => createInstitutionalSearchModel(resource, { request }, user);
  const item = patch => resource === 'users' ? person(patch) : waiting(patch);

  test(`${resource}: exact existing GET contract, filters, opaque cursor and session context; no body`, async () => {
    const user = { ...profile, context: { institutionId, branchId: branch.id } }, abort = signal();
    const client = find(async (path, options) => {
      assert.equal(path, `${resource}/administration`); assert.equal(options.signal, abort);
      assert.deepEqual(options.query, { ...expectedQuery, cursor: 'opaque_cursor' });
      assert.deepEqual(options.institutionContext, user.context); assert.equal(options.method, undefined); assert.equal(options.body, undefined);
      return page(resource);
    }, user);
    assert.deepEqual((await client.find(filters, abort, 'opaque_cursor')).data, [item()]);
    assert.deepEqual(institutionalSearchQuery(resource, {}), { limit: '50' });
    assert.deepEqual(institutionalSearchQuery(resource, Object.fromEntries(Object.keys(filters).map(key => [key, '']))), { limit: '50' });
  });

  test(`${resource}: rejects identity/scope injection, pagination overrides, wrong fields and invalid cursors before transport`, async () => {
    let calls = 0; const client = find(async () => { calls++; return page(resource); });
    for (const key of ['institutionId', 'actorUserId', 'limit', 'cursor', 'offset', 'page', 'body', 'statusCode', resource === 'users' ? 'userId' : 'q']) {
      await assert.rejects(client.find({ [key]: 'invalid' }, signal()), status(400));
    }
    for (const cursor of ['', null, '?private', 'x'.repeat(301)]) await assert.rejects(client.find({}, signal(), cursor), status(400));
    for (const value of ['not-uuid', null, 1]) await assert.rejects(client.find({ branchId: value }, signal()), status(400));
    assert.equal(calls, 0);
  });

  test(`${resource}: explicit permission/context required; wrong role name never authorizes`, async () => {
    for (const user of [{ ...profile, permissions: [] }, { ...profile, permissions: [resource === 'users' ? 'waitlist.read' : 'users.read'] },
      { ...profile, context: {} }, { ...profile, context: { institutionId: 'invalid' } }, { ...profile, permissions: [], roles: ['ADMIN'] }]) {
      const request = async () => assert.fail('Denied must not request'); const m = model(request, user);
      await assert.rejects(find(request, user).find({}, signal()), status(403));
      await m.activate(); await m.consult(); await m.loadMore(); assert.equal(m.getSnapshot().status, 'denied'); m.dispose();
    }
  });

  test(`${resource}: fixed contextual branch cannot be replaced, omitted or changed through model`, async () => {
    const user = { ...profile, context: { institutionId, branchId: branch.id } }; let calls = 0;
    const request = async (_path, options) => { calls++; assert.equal(options.query.branchId, branch.id); assert.deepEqual(options.institutionContext, user.context); return page(resource); };
    await find(request, user).find({}, signal());
    await assert.rejects(find(request, user).find({ branchId: otherId }, signal()), status(404)); assert.equal(calls, 1);
    const m = model(request, user); await m.activate(); assert.equal(calls, 1); m.setFilter('branchId', otherId);
    assert.deepEqual(m.getSnapshot().filters, {}); await m.consult(); m.dispose();
  });

  test(`${resource}: controlled DTO drops all private fields, enforces page/UUID shape and accepts empty final page`, () => {
    const privateRow = { ...item(), email: 'PRIVATE', passwordHash: 'PRIVATE', phone: 'PRIVATE', priorityId: 'PRIVATE', institutionId: 'PRIVATE', payload: 'PRIVATE' };
    assert.deepEqual(parseInstitutionalSearchPage(resource, page(resource, [privateRow])).data, [item()]);
    assert.deepEqual(parseInstitutionalSearchPage(resource, page(resource, [])), { data: [], nextCursor: null });
    for (const value of [{}, { data: [] }, { data: 'bad', page: { nextCursor: null } }, page(resource, [item({ id: 'invalid' })]),
      page(resource, Array.from({ length: 51 }, () => item())), page(resource, [], 'opaque'), page(resource, [item()], 'https://private'),
      { data: [item()], page: {} }]) assert.throws(() => parseInstitutionalSearchPage(resource, value));
  });

  test(`${resource}: real shared HTTP client sends Bearer and tenant headers, never scope in query/body`, async () => {
    const http = createHttpClient({ baseUrl: 'http://localhost:3000/api/v1', getAccessToken: () => 'test-access', fetcher: async (url, options) => {
      const target = new URL(url); assert.equal(target.pathname, `/api/v1/${resource}/administration`);
      assert.equal(target.searchParams.get('institutionId'), null); assert.equal(target.searchParams.get('limit'), '50');
      assert.equal(options.headers.get('Authorization'), 'Bearer test-access'); assert.equal(options.headers.get('x-institution-id'), institutionId);
      assert.equal(options.method, 'GET'); assert.equal(options.body, undefined); assert.equal(options.credentials, 'omit');
      return new Response(JSON.stringify(page(resource)), { headers: { 'content-type': 'application/json' } });
    } });
    assert.equal((await createInstitutionalSearchApi(resource, http, profile).find({}, signal())).data.length, 1);
  });

  test(`${resource}: filters reset results/cursor; pagination uses exact filters, deduplicates and terminates`, async () => {
    const seen = []; const m = model(async (_path, options) => {
      seen.push(options.query);
      return seen.length === 1 ? page(resource, [item(), item()], 'first') : page(resource, [item(), item({ id: otherId }), item({ id: otherId })]);
    });
    const key = resource === 'users' ? 'q' : 'status', value = resource === 'users' ? 'Ana' : 'ACTIVE';
    m.setFilter(key, value); await m.consult(); assert.equal(m.getSnapshot().data.length, 1);
    await m.loadMore(); assert.deepEqual(m.getSnapshot().data.map(row => row.id), [item().id, otherId]);
    assert.deepEqual(seen, [{ limit: '50', [key]: value }, { limit: '50', [key]: value, cursor: 'first' }]);
    await m.loadMore(); assert.equal(seen.length, 2);
    m.setFilter(key, ''); assert.equal(m.getSnapshot().status, 'idle'); assert.deepEqual(m.getSnapshot().data, []); assert.equal(m.getSnapshot().nextCursor, null); m.dispose();
  });

  test(`${resource}: duplicate consult/loadMore blocked, more failure preserves rows/cursor and explicit retry works`, async () => {
    const first = deferred(), more = deferred(); let calls = 0;
    const m = model(async () => { calls++; return calls === 1 ? first.promise : calls === 2 ? more.promise : page(resource, [item({ id: otherId })]); });
    const pending = m.consult(); await m.consult(); assert.equal(calls, 1); assert.equal(m.getSnapshot().status, 'loading');
    first.resolve(page(resource, [item()], 'next')); await pending;
    const loading = m.loadMore(); await m.loadMore(); await m.consult(); assert.equal(calls, 2);
    more.reject(new Error('PRIVATE SQL token')); await loading;
    assert.equal(m.getSnapshot().data.length, 1); assert.equal(m.getSnapshot().nextCursor, 'next'); assert.ok(m.getSnapshot().moreError); assert.ok(!m.getSnapshot().moreError.includes('PRIVATE'));
    await m.loadMore(); assert.equal(m.getSnapshot().data.length, 2); assert.equal(m.getSnapshot().moreError, ''); m.dispose();
  });

  test(`${resource}: stale first page and stale pagination cannot repopulate filters or disposed contexts`, async () => {
    const old = deferred(); let oldSignal, calls = 0;
    const m = model(async (_path, options) => { calls++; oldSignal ??= options.signal; return calls === 1 ? old.promise : page(resource, [], null); });
    const pending = m.consult(); m.setFilter('branchId', branch.id); assert.equal(oldSignal.aborted, true);
    await m.consult(); old.resolve(page(resource, [item()], 'stale')); await pending; assert.deepEqual(m.getSnapshot().data, []);
    const more = deferred(); const p = model(async (_path, options) => options.query.cursor ? more.promise : page(resource, [item()], 'next'));
    await p.consult(); const paging = p.loadMore(); p.dispose(); more.resolve(page(resource, [item({ id: otherId })])); await paging;
    assert.deepEqual(p.getSnapshot().data, []); assert.equal(p.getSnapshot().nextCursor, null); m.dispose();
  });

  test(`${resource}: catalog failure never blocks consultation; errors and no-progress cursors are controlled`, async () => {
    const m = model(async path => { if (path.startsWith('institutions/')) throw new Error('PRIVATE'); return page(resource, [], null); });
    await m.activate(); assert.equal(m.getSnapshot().catalogStatus, 'error'); await m.consult(); assert.equal(m.getSnapshot().status, 'ready'); m.dispose();
    let calls = 0; const p = model(async () => { calls++; return page(resource, [item()], calls === 1 ? 'a' : calls === 2 ? 'b' : 'a'); });
    await p.consult(); await p.loadMore(); await p.loadMore(); assert.ok(p.getSnapshot().moreError); assert.equal(p.getSnapshot().nextCursor, 'b'); assert.equal(p.getSnapshot().data.length, 1); p.dispose();
    for (const error of [new ApiError(400), new ApiError(401), new ApiError(403), new ApiError(404), new ApiError(503), new Error('PRIVATE SQL')]) {
      const failed = model(async () => { throw error; }); await failed.consult(); assert.equal(failed.getSnapshot().status, 'error'); assert.ok(!failed.getSnapshot().error.includes('PRIVATE')); failed.dispose();
    }
  });
}

test('users names and waitlist catalog codes use only the backend constraints, not invented enums', () => {
  for (const q of ['a', 'a'.repeat(121), 10, null]) assert.throws(() => institutionalSearchQuery('users', { q }), status(400));
  assert.deepEqual(institutionalSearchQuery('users', { q: '  ' }), { limit: '50' });
  assert.equal(institutionalSearchQuery('waitlist', { status: ' CUSTOM_FINAL ' }).status, 'CUSTOM_FINAL');
  for (const filter of [{ status: 'a'.repeat(61) }, { status: null }, { serviceId: 'bad' }, { userId: 'bad' }]) assert.throws(() => institutionalSearchQuery('waitlist', filter), status(400));
});

test('waitlist dates, minimal nested DTO and response filters cannot escape a selected branch/service/user', async () => {
  const context = { ...profile, context: { institutionId, branchId: branch.id } };
  for (const patch of [{ branch: null }, { branch: { id: otherId, name: 'Foreign' } }, { service: { id: otherId, name: 'Foreign' } }, { user: person({ id: otherId }) }, { status: { code: 'OTHER', name: 'Other' } }]) {
    const client = createInstitutionalSearchApi('waitlist', { request: async () => page('waitlist', [waiting(patch)]) }, context);
    await assert.rejects(client.find({ serviceId: service.id, userId, status: 'ACTIVE' }, signal()), status(404));
  }
  for (const enteredAt of ['bad', '2026-02-30T00:00:00.000Z', '2026-01-01T00:00:00-03:00']) assert.throws(() => parseInstitutionalSearchPage('waitlist', page('waitlist', [waiting({ enteredAt })])));
  assert.equal(parseInstitutionalSearchPage('waitlist', page('waitlist', [waiting({ branch: null })])).data[0].branch, null);
  assert.deepEqual(Object.keys(parseInstitutionalSearchPage('waitlist', page('waitlist')).data[0]).sort(), ['branch', 'enteredAt', 'id', 'service', 'status', 'user']);
  assert.equal(entryId, waiting().id); assert.ok(!searchError(new Error('PRIVATE')).includes('PRIVATE'));
});
