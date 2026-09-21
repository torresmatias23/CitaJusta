import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createNotificationsApi, parseNotification } from '../src/features/notifications/notifications-api.ts';
import { createNotificationsStore } from '../src/features/notifications/notifications-store.ts';
import { createAuthSession } from '../src/features/auth/auth-session.ts';
import { createHttpClient } from '../src/lib/http-client.ts';

const id = '10000000-0000-4000-8000-000000000001', secondId = '10000000-0000-4000-8000-000000000002';
const item = { id, type: 'APPOINTMENT_BOOKED', title: 'Reserva registrada', message: 'Tu reserva quedó agendada.',
  createdAt: '2030-01-01T12:00:00.000Z', readAt: null, resourceType: 'APPOINTMENT', resourceId: secondId, path: '/mis-citas' };
const page = (data = [item], nextCursor = null, unreadCount = data.length) => ({ data, page: { nextCursor }, unreadCount });
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };

test('API validates public DTO, safe paths and counts, discarding private extras', async () => {
  assert.deepEqual(parseNotification({ ...item, email: 'private', dedupeKey: 'private' }), item);
  for (const invalid of [{ ...item, path: 'https://evil.test' }, { ...item, path: '/inventada' }, { ...item, type: 'OTHER' }, { ...item, readAt: 'bad' }]) assert.throws(() => parseNotification(invalid));
  for (const unreadCount of [-1, 1.5, '3']) await assert.rejects(createNotificationsApi({ request: async () => page([], null, unreadCount) }).list());
  const calls = [], signal = new AbortController().signal;
  const api = createNotificationsApi({ request: async (path, options) => { calls.push({ path, options });
    return path.endsWith('/read') ? { data: { id, readAt: item.createdAt } } : path.endsWith('unread-count') ? { data: { unreadCount: 4 } } : page(); } });
  assert.deepEqual(await api.list('a_b-1', signal), page()); assert.equal(await api.unreadCount(signal), 4);
  assert.deepEqual(await api.read(id, signal), { id, readAt: item.createdAt });
  assert.equal(calls[0].path, 'notifications/me'); assert.deepEqual(calls[0].options.query, { cursor: 'a_b-1' }); assert.equal(calls[2].options.method, 'POST');
  assert.ok(calls.every((call) => call.options.signal === signal && !call.options.body && !call.options.headers));
});
test('shared store loads pages, deduplicates overlap, marks read and refreshes authoritative count', async () => {
  let count = 2, reads = 0;
  const store = createNotificationsStore({ list: async (cursor) => cursor ? page([item, { ...item, id: secondId }], null, count) : page([item], 'next', count),
    unreadCount: async () => count, read: async () => { reads++; count = 1; return { id, readAt: item.createdAt }; } });
  let updates = 0; const unsubscribe = store.subscribe(() => updates++);
  await store.refreshCount(); assert.equal(store.getSnapshot().unreadCount, 2);
  await store.load(); assert.equal(store.getSnapshot().status, 'ready');
  await store.load(true); assert.equal(store.getSnapshot().items.length, 2); assert.equal(store.getSnapshot().nextCursor, null);
  await Promise.all([store.read(id), store.read(id)]);
  assert.equal(reads, 1); assert.equal(store.getSnapshot().items[0].readAt, item.createdAt); assert.equal(store.getSnapshot().unreadCount, 1);
  assert.deepEqual(store.getSnapshot().reading, []); assert.ok(updates > 3); unsubscribe(); store.dispose();
});
test('loading, empty, safe error, retry and load-more failure preserve existing rows', async () => {
  const pending = deferred(); let response = pending.promise;
  const store = createNotificationsStore({ list: () => response, unreadCount: async () => 0 });
  const loading = store.load(); assert.equal(store.getSnapshot().status, 'loading');
  pending.reject(new Error('private stack email')); await loading;
  assert.equal(store.getSnapshot().status, 'error'); assert.doesNotMatch(store.getSnapshot().error, /private|stack|email/);
  response = Promise.resolve(page([])); await store.load(); assert.deepEqual(store.getSnapshot().items, []); assert.equal(store.getSnapshot().status, 'ready');
  response = Promise.resolve(page([item], 'cursor')); await store.load();
  response = Promise.reject(new Error('offline')); await store.load(true);
  assert.equal(store.getSnapshot().status, 'ready'); assert.equal(store.getSnapshot().items.length, 1); assert.ok(store.getSnapshot().error);
  response = Promise.resolve(page([{ ...item, id: secondId }])); await store.load(true); assert.equal(store.getSnapshot().items.length, 2);
  store.dispose();
});
test('late list/count responses cannot undo read; focus refreshes without timers', async () => {
  const lateList = deferred(), lateCount = deferred(); let lists = 0, counts = 0;
  const store = createNotificationsStore({ list: async () => ++lists === 2 ? lateList.promise : page(),
    unreadCount: async () => ++counts === 1 ? lateCount.promise : 0, read: async () => ({ id, readAt: item.createdAt }) });
  await store.load(); const oldList = store.load(); const oldCount = store.refreshCount(); await store.read(id);
  lateList.resolve(page()); lateCount.resolve(99); await Promise.all([oldList, oldCount]);
  assert.equal(store.getSnapshot().unreadCount, 0); assert.equal(store.getSnapshot().items[0].readAt, item.createdAt);
  await store.focus(); assert.equal(lists, 3); store.dispose();
});
test('dispose clears all state and pending work; StrictMode activation never revives old responses', async () => {
  const late = deferred(), lateRead = deferred(); let calls = 0;
  const store = createNotificationsStore({ list: async () => ++calls === 1 ? page() : late.promise,
    unreadCount: () => late.promise, read: () => lateRead.promise });
  await store.load(); const loading = store.load(); const reading = store.read(id); const counting = store.refreshCount();
  store.dispose(); assert.equal(store.getSnapshot().items.length, 0); assert.equal(store.getSnapshot().unreadCount, null);
  assert.equal(store.getSnapshot().error, null); assert.deepEqual(store.getSnapshot().reading, []);
  store.activate(); late.resolve(page()); lateRead.resolve({ id, readAt: item.createdAt }); await Promise.all([loading, reading, counting]);
  assert.equal(store.getSnapshot().status, 'idle'); assert.equal(store.getSnapshot().unreadCount, null); assert.deepEqual(store.getSnapshot().items, []);
  store.dispose();
});

function authFixture(stored) {
  let activeUser = id, saved = stored, expired = false, refreshFails = false; const calls = [];
  const fetcher = async (url, options) => {
    const path = new URL(url).pathname.replace('/api/v1/', ''); calls.push({ path, options });
    let payload;
    if (path === 'auth/login' || path === 'auth/refresh') {
      if (path === 'auth/refresh' && refreshFails) return Response.json({}, { status: 401 });
      expired = false; payload = { accessToken: `access-${activeUser}`, refreshToken: `refresh-${activeUser}`, tokenType: 'Bearer' };
    } else if (path === 'users/me') payload = { data: { id: activeUser, email: 'person@example.test', firstName: 'Test', lastName: 'User', status: 'ACTIVE', context: {}, roles: [], permissions: [] } };
    else if (path === 'auth/logout') return new Response(null, { status: 204 });
    else if (expired) return Response.json({}, { status: 401 });
    else if (path.endsWith('/read')) payload = { data: { id, readAt: item.createdAt } };
    else if (path.endsWith('unread-count')) payload = { data: { unreadCount: activeUser === id ? 1 : 0 } };
    else payload = page(activeUser === id ? [item] : []);
    return Response.json(payload);
  };
  const transport = (getAccessToken) => createHttpClient({ baseUrl: 'http://localhost/api/v1', getAccessToken, fetcher });
  const session = createAuthSession({ publicApi: transport(), authenticatedApi: transport,
    storage: { read: () => saved, write: (value) => { saved = value; }, clear: () => { saved = undefined; } } });
  return { session, calls, account: (value) => { activeUser = value; }, expire: (fail) => { expired = true; refreshFails = fail; } };
}
test('real auth + HTTP client: anonymous sends no protected requests; login, refresh and idempotent read', async () => {
  const fixture = authFixture(); await fixture.session.restore(); assert.equal(fixture.calls.length, 0);
  await fixture.session.login({ email: 'person@example.test', password: 'test' });
  const api = createNotificationsApi(fixture.session.api), store = createNotificationsStore(api);
  await store.refreshCount(); assert.equal(store.getSnapshot().unreadCount, 1);
  fixture.expire(false); await store.load(); assert.equal(store.getSnapshot().items.length, 1);
  fixture.expire(false); await store.read(id); assert.equal(store.getSnapshot().items[0].readAt, item.createdAt);
  assert.equal(fixture.calls.filter((call) => call.path.endsWith('/read')).length, 2);
  const call = fixture.calls.find((call) => call.path === 'notifications/me');
  assert.equal(new Headers(call.options.headers).get('authorization'), `Bearer access-${id}`);
  store.dispose();
});
test('logout/account switch/invalid session dispose old store and isolate delayed responses', async () => {
  const fixture = authFixture(); let identity, store;
  // Mirrors the provider's identity boundary using real auth transitions.
  const unsubscribe = fixture.session.subscribe(() => {
    const auth = fixture.session.getSnapshot(), next = auth.status === 'authenticated' ? auth.user.id : undefined;
    if (next !== identity) { store?.dispose(); identity = next; store = next ? createNotificationsStore(createNotificationsApi(fixture.session.api)) : undefined; }
  });
  await fixture.session.login({ email: 'a@example.test', password: 'test' }); await store.load(); const old = store;
  const logout = fixture.session.logout(); assert.equal(old.getSnapshot().items.length, 0); assert.equal(store, undefined); await logout;
  fixture.account(secondId); await fixture.session.login({ email: 'b@example.test', password: 'test' });
  assert.deepEqual(store.getSnapshot().items, []); await store.load(); assert.equal(store.getSnapshot().unreadCount, 0);
  const second = store; fixture.expire(true); await store.load();
  assert.equal(fixture.session.getSnapshot().status, 'anonymous'); assert.equal(store, undefined); assert.deepEqual(second.getSnapshot().items, []);
  unsubscribe();
});
test('restoration supplies real token to count; count failure never shows a stale badge', async () => {
  const fixture = authFixture('stored-refresh'); await fixture.session.restore();
  assert.equal(fixture.session.getSnapshot().status, 'authenticated');
  const store = createNotificationsStore(createNotificationsApi(fixture.session.api));
  await store.refreshCount(); assert.equal(store.getSnapshot().unreadCount, 1);
  assert.equal(fixture.calls[0].path, 'auth/refresh');
  store.dispose();
  let fails = false;
  const failedStore = createNotificationsStore({ unreadCount: async () => { if (fails) throw new Error('offline'); return 3; } });
  await failedStore.refreshCount(); fails = true; await failedStore.refreshCount();
  assert.equal(failedStore.getSnapshot().unreadCount, null); assert.equal(failedStore.getSnapshot().countError, true);
  failedStore.dispose();
});
