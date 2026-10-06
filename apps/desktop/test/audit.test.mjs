import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ApiError } from '@citajusta/client-core';
import { auditActions, auditResources, auditQuery, createAuditApi, parseAuditPage, auditError } from '../src/audit/audit-api.ts';
import { createAuditModel } from '../src/audit/audit-model.ts';
import { createAgendaCatalogApi } from '../src/agenda/agenda-catalog-api.ts';
import { profile, branch, institutionId, actorId, resourceId, auditEvent, page, deferred } from './fixtures/audit.mjs';
const signal = () => new AbortController().signal;
const status = code => error => error instanceof ApiError && error.status === code;
const apiWith = (request, user = profile) => createAuditApi({ request }, user);
const modelWith = (request, user = profile) => createAuditModel({ request }, user);

test('HU038 empty query valid, from/to independently optional, no Reportes day limit', () => {
  assert.deepEqual(auditQuery({}), { limit: '50' });
  for (const filters of [{ from: '2026-10-01' }, { to: '2026-10-01' }, { from: '2020-01-01', to: '2026-10-01' }, { from: '2026-10-01', to: '2026-10-01' }]) assert.deepEqual(auditQuery(filters), { limit: '50', ...filters });
  assert.deepEqual(auditQuery({ from: '', to: '' }), { limit: '50' });
});
test('HU038 invalid civil dates and inverted periods rejected before request', async () => {
  let calls = 0; const api = apiWith(async () => { calls++; return page(); });
  for (const filters of [{ from: '2026-02-30' }, { to: '2026-13-01' }, { from: '2026-10-01T00:00:00Z' }, { from: '2026-10-02', to: '2026-10-01' }, { to: null }, { from: 100 }]) await assert.rejects(api.find(filters, signal()), status(400));
  assert.equal(calls, 0);
});
test('HU038 validates UUIDs, unknown query including institution/user/offset/page/body and fixed limit', () => {
  for (const key of ['branchId', 'actorUserId']) for (const value of ['invalid', null, 5]) assert.throws(() => auditQuery({ [key]: value }), status(400));
  for (const key of ['institutionId', 'userId', 'offset', 'page', 'body', 'limit', 'unknown', 'cursor']) assert.throws(() => auditQuery({ [key]: '50' }), status(400));
});
test('HU038 closed action/resource enums sent unchanged; invalid values rejected', () => {
  assert.equal(auditActions.length, 26); assert.equal(auditResources.length, 10);
  for (const action of auditActions) assert.equal(auditQuery({ action }).action, action);
  for (const resourceType of auditResources) assert.equal(auditQuery({ resourceType }).resourceType, resourceType);
  for (const filters of [{ action: 'DELETE_ALL' }, { resourceType: 'USER' }, { action: null }]) assert.throws(() => auditQuery(filters), status(400));
});

test('HU040 Google linking audit is readable and filterable without allowing unknown actions', () => {
  const linked = auditEvent({ actionCode: 'AUTH_GOOGLE_LINKED', resourceType: 'AUTH', resourceId: null });
  assert.equal(parseAuditPage(page([linked])).data[0].actionCode, 'AUTH_GOOGLE_LINKED');
  assert.equal(auditQuery({ action: 'AUTH_GOOGLE_LINKED' }).action, 'AUTH_GOOGLE_LINKED');
});

test('HU041 Calendar export audit remains readable and filterable in institutional Desktop', () => {
  const created = auditEvent({ actionCode: 'GOOGLE_CALENDAR_EVENT_CREATED', resourceType: 'APPOINTMENT' });
  assert.equal(parseAuditPage(page([created])).data[0].actionCode, 'GOOGLE_CALENDAR_EVENT_CREATED');
  assert.equal(auditQuery({ action: 'GOOGLE_CALENDAR_EVENT_CREATED' }).action, 'GOOGLE_CALENDAR_EVENT_CREATED');
});
test('HU038 exact audit/events GET, civil query, principal context in request options, no body', async () => {
  const filters = { from: '2020-01-01', to: '2026-10-01', branchId: branch.id, actorUserId: actorId, action: 'APPOINTMENT_CANCELLED', resourceType: 'APPOINTMENT' };
  const abort = signal(); const api = apiWith(async (path, options) => {
    assert.equal(path, 'audit/events'); assert.deepEqual(options.query, { limit: '50', ...filters });
    assert.deepEqual(options.institutionContext, { institutionId }); assert.equal(options.signal, abort);
    assert.equal(options.body, undefined); assert.equal(options.method, undefined); return page();
  });
  assert.deepEqual((await api.find(filters, abort)).data[0], auditEvent());
});
test('HU038 branch context fixed and contradictory branch never sent', async () => {
  const user = { ...profile, context: { institutionId, branchId: branch.id } }; let calls = 0;
  const api = apiWith(async (_path, options) => { calls++; assert.deepEqual(options.institutionContext, user.context); assert.equal(options.query.branchId, branch.id); return page(); }, user);
  await api.find({}, signal()); await assert.rejects(api.find({ branchId: resourceId }, signal()), status(404)); assert.equal(calls, 1);
});
test('HU038 scoped API rejects events from another institution or effective branch', async () => {
  for (const patch of [{ institutionId: resourceId }, { institutionId: null }]) await assert.rejects(apiWith(async () => page([auditEvent(patch)])).find({}, signal()), status(404));
  await assert.rejects(apiWith(async () => page([auditEvent({ branchId: resourceId })])).find({ branchId: branch.id }, signal()), status(404));
});
test('HU038 no audit.read or institution denies API/model without any calls', async () => {
  for (const user of [{ ...profile, permissions: [] }, { ...profile, context: {} }]) {
    const request = async () => assert.fail('unexpected HTTP request'); const model = modelWith(request, user);
    await assert.rejects(apiWith(request, user).find({}, signal()), status(403));
    await model.activate(); await model.consult(); await model.loadMore(); assert.equal(model.getSnapshot().status, 'denied'); model.dispose();
  }
});
test('HU038 controlled parser, optional states/reason, nullable IDs and SYSTEM are valid', () => {
  const system = auditEvent({ actorType: 'SYSTEM', actorUserId: null, institutionId: null, branchId: null, resourceId: null });
  delete system.previousState; delete system.newState; delete system.reasonCode;
  const result = parseAuditPage(page([system]));
  assert.equal(result.data[0].actorType, 'SYSTEM'); assert.equal(result.data[0].actorUserId, null);
  assert.equal(result.data[0].previousState, null); assert.equal(result.data[0].newState, null); assert.equal(result.data[0].reasonCode, null);
  assert.equal(result.nextCursor, null);
  assert.equal(parseAuditPage(page()).data[0].actorUserId, actorId);
});
test('HU038 strips extras deeply and keeps only public DTO fields', () => {
  const response = page([{ ...auditEvent(), passwordHash: 'SECRET', payload: { token: 'SECRET' } }]);
  response.secret = 'SECRET'; response.page.total = 100;
  assert.deepEqual(parseAuditPage(response), { data: [auditEvent()], nextCursor: null });
});
test('HU038 rejects invalid envelopes and every malformed closed DTO field', () => {
  for (const value of [null, [], { data: {}, page: { nextCursor: null } }, { data: [], page: null }, { data: [], page: {} }, page([], 5), page([], ''), page([], 'x'.repeat(301))]) assert.throws(() => parseAuditPage(value));
  for (const patch of [{ id: 'bad' }, { institutionId: 'bad' }, { branchId: 'bad' }, { actorUserId: 'bad' }, { resourceId: 'bad' },
    { actorType: 'ADMIN' }, { actionCode: 'DELETE_ALL' }, { resourceType: 'USER' }, { outcome: 'UNKNOWN' }, { previousState: {} }, { newState: 'SECRET' },
    { reasonCode: 'ARBITRARY' }, { occurredAt: 'not-a-date' }, { occurredAt: '2026-02-30T00:00:00.000Z' }, { occurredAt: '2026-10-01T25:00:00Z' }]) assert.throws(() => parseAuditPage(page([auditEvent(patch)])), JSON.stringify(patch));
});
test('HU038 empty page and opaque string cursor accepted without decoding', () => {
  assert.deepEqual(parseAuditPage(page([])), { data: [], nextCursor: null });
  assert.equal(parseAuditPage(page([], 'opaque-server-cursor')).nextCursor, 'opaque-server-cursor');
  assert.equal(auditQuery({}, undefined, 'opaque-server-cursor').cursor, 'opaque-server-cursor');
  for (const cursor of ['', null, 7, 'x'.repeat(301)]) assert.throws(() => auditQuery({}, undefined, cursor), status(400));
});
test('HU038 error messages sanitized for 400/401/403/404/503 and unexpected failures', () => {
  const messages = [400, 401, 403, 404, 503].map(code => auditError(new ApiError(code, 'SQL SECRET')));
  assert.equal(new Set(messages).size, 5);
  for (const message of [...messages, auditError(new Error('SQL SECRET'))]) assert.doesNotMatch(message, /SQL|SECRET|stack/);
  assert.match(messages[3], /contexto/);
});
test('HU038 catalog uses only existing branches route; failure does not block events', async () => {
  const paths = []; const model = modelWith(async path => {
    paths.push(path); if (path === 'audit/events') return page([]); throw new ApiError(403);
  });
  await model.activate(); assert.equal(model.getSnapshot().catalogStatus, 'error');
  await model.consult(); assert.equal(model.getSnapshot().status, 'ready'); assert.deepEqual(model.getSnapshot().data, []);
  assert.deepEqual(paths, [`institutions/${institutionId}/branches`, 'audit/events']); model.dispose();
});
test('HU038 branches-only shared helper validates tenant, limits branch and skips service/professional requests', async () => {
  const paths = []; const user = { ...profile, context: { institutionId, branchId: branch.id } };
  const api = { request: async path => { paths.push(path); return { data: [{ id: resourceId, institutionId, name: 'Otra sede' }, { id: branch.id, institutionId, name: branch.name }] }; } };
  assert.deepEqual(await createAgendaCatalogApi(api, user).branches(signal()), [{ id: branch.id, name: branch.name }]);
  assert.deepEqual(paths, [`institutions/${institutionId}/branches`]);
  await assert.rejects(createAgendaCatalogApi({ request: async () => ({ data: [{ id: branch.id, institutionId: resourceId, name: 'Ajena' }] }) }, user).branches(signal()));
});
test('HU038 model catalogs populate independently; branch context skips catalog and cannot change', async () => {
  const model = modelWith(async () => ({ data: [{ id: branch.id, institutionId, name: branch.name }] })); await model.activate();
  assert.equal(model.getSnapshot().catalogStatus, 'ready'); assert.deepEqual(model.getSnapshot().branches, [{ id: branch.id, name: branch.name }]); model.dispose();
  const fixed = modelWith(async () => assert.fail('no catalog needed'), { ...profile, context: { institutionId, branchId: branch.id } });
  await fixed.activate(); fixed.setFilter('branchId', resourceId); assert.equal(fixed.getSnapshot().filters.branchId, undefined); fixed.dispose();
});
test('HU038 loading blocks duplicate first requests; first page replaces old data and cursor', async () => {
  const pending = deferred(); let calls = 0; const model = modelWith(async () => { calls++; return calls === 1 ? pending.promise : page([]); });
  const work = model.consult(); assert.equal(model.getSnapshot().status, 'loading'); await model.consult(); await model.loadMore(); assert.equal(calls, 1);
  pending.resolve(page([auditEvent()], 'cursor-1')); await work;
  assert.equal(model.getSnapshot().nextCursor, 'cursor-1'); await model.consult(); assert.deepEqual(model.getSnapshot().data, []); assert.equal(model.getSnapshot().nextCursor, null); model.dispose();
});
test('HU038 loadMore sends identical filters + exact cursor, appends in server order, removes duplicates and terminates', async () => {
  const requests = []; const second = auditEvent({ id: resourceId, occurredAt: '2026-09-30T11:00:00.000Z' });
  const model = modelWith(async (path, options) => {
    requests.push({ path, query: options.query });
    return requests.length === 1 ? page([auditEvent()], 'cursor-1') : page([auditEvent(), second, second]);
  });
  model.setFilter('from', '2026-01-01'); model.setFilter('action', 'APPOINTMENT_CANCELLED');
  await model.consult(); await model.loadMore(); await model.loadMore();
  assert.equal(requests.length, 2);
  assert.deepEqual(requests[1].query, { ...requests[0].query, cursor: 'cursor-1' });
  assert.equal(requests[0].query.cursor, undefined); assert.deepEqual(model.getSnapshot().data, [auditEvent(), second]); assert.equal(model.getSnapshot().nextCursor, null); model.dispose();
});
test('HU038 prevents multiple simultaneous loadMore and first-page reload during pagination', async () => {
  const pending = deferred(); let calls = 0; const model = modelWith(async () => { calls++; return calls === 1 ? page([auditEvent()], 'next') : pending.promise; });
  await model.consult(); const work = model.loadMore(); assert.equal(model.getSnapshot().loadingMore, true);
  await model.loadMore(); await model.consult(); assert.equal(calls, 2); pending.resolve(page([])); await work; assert.equal(model.getSnapshot().loadingMore, false); model.dispose();
});
test('HU038 more failure keeps data and cursor, sanitized error and successful retry', async () => {
  let calls = 0; const model = modelWith(async () => { calls++; if (calls === 1) return page([auditEvent()], 'next'); if (calls === 2) throw new ApiError(503, 'SQL SECRET'); return page([]); });
  await model.consult(); await model.loadMore(); assert.equal(model.getSnapshot().status, 'ready'); assert.deepEqual(model.getSnapshot().data, [auditEvent()]); assert.equal(model.getSnapshot().nextCursor, 'next');
  assert.doesNotMatch(model.getSnapshot().moreError, /SQL|SECRET/); assert.ok(model.getSnapshot().moreError);
  await model.loadMore(); assert.equal(model.getSnapshot().moreError, ''); assert.equal(model.getSnapshot().nextCursor, null); model.dispose();
});
test('HU038 changing each filter resets cursor/data, aborts and discards late next page', async () => {
  for (const key of ['from', 'to', 'branchId', 'actorUserId', 'action', 'resourceType']) {
    const pending = deferred(); let calls = 0, requestSignal;
    const model = modelWith(async (_path, options) => { calls++; requestSignal = options.signal; return calls === 1 ? page([auditEvent()], 'next') : pending.promise; });
    await model.consult(); const work = model.loadMore(); model.setFilter(key, 'changed');
    assert.equal(requestSignal.aborted, true); assert.equal(model.getSnapshot().nextCursor, null); assert.deepEqual(model.getSnapshot().data, []); assert.equal(model.getSnapshot().status, 'idle');
    pending.resolve(page([auditEvent()])); await work; assert.equal(model.getSnapshot().status, 'idle'); assert.deepEqual(model.getSnapshot().data, []); model.dispose();
  }
});
test('HU038 stale first-page error cannot overwrite a newer successful consultation', async () => {
  const old = deferred(); let calls = 0; const model = modelWith(async () => ++calls === 1 ? old.promise : page([]));
  const work = model.consult(); model.setFilter('from', '2026-10-01'); await model.consult(); old.reject(new Error('SECRET'));
  await work; assert.equal(model.getSnapshot().status, 'ready'); assert.equal(model.getSnapshot().error, ''); model.dispose();
});
test('HU038 dispose/reactivate ignores prior data/catalogs even when transport ignores abort', async () => {
  const old = deferred(), catalogs = deferred(); let calls = 0;
  const model = modelWith(async path => path === 'audit/events' ? (++calls === 1 ? old.promise : page([])) : catalogs.promise);
  const activation = model.activate(), work = model.consult(); model.dispose(); const newActivation = model.activate(); await model.consult();
  old.resolve(page([auditEvent()], 'old-cursor')); catalogs.resolve({ data: [{ id: branch.id, institutionId, name: branch.name }] });
  await Promise.all([activation, newActivation, work]); assert.deepEqual(model.getSnapshot().data, []); assert.equal(model.getSnapshot().nextCursor, null); assert.equal(model.getSnapshot().status, 'ready'); model.dispose();
});
test('HU038 cursor without progress fails safely without looping or corrupting results', async () => {
  const model = modelWith(async () => page([auditEvent()], 'same')); await model.consult(); await model.loadMore();
  assert.deepEqual(model.getSnapshot().data, [auditEvent()]); assert.ok(model.getSnapshot().moreError); assert.equal(model.getSnapshot().loadingMore, false); model.dispose();
});
