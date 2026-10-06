import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { ApiError, createAuthSession, createHttpClient } from '@citajusta/client-core';
import { createAppointmentsApi, createSubmissionLock } from '../src/features/appointments/appointments-api.ts';
import { CALENDAR_SCOPE, calendarClientId, calendarEligible, calendarErrorMessage, createCalendarCodeClient, CalendarAuthorizationError } from '../src/features/appointments/google-calendar.ts';
import { loadGoogleSdk } from '../src/features/auth/google-sdk.ts';

const id = '10000000-0000-4000-8000-000000000001', eventId = `citajusta${id.replaceAll('-', '')}`;
const clientId = 'test-web.apps.googleusercontent.com';
const code = 'transient-calendar-code';
function oauth() {
  let options, requests = 0;
  const api = { initCodeClient: (value) => { options = value; return { requestCode: () => { requests++; } }; } };
  const client = createCalendarCodeClient(clientId, api);
  return { client, options: () => options, requests: () => requests };
}
test('Calendar is separately opt-in, requires valid client ID and only future AGENDADA intervals qualify', () => {
  assert.equal(calendarClientId('true', clientId), clientId);
  for (const enabled of [undefined, '', 'false', true]) assert.equal(calendarClientId(enabled, clientId), undefined);
  assert.equal(calendarClientId('true', 'invalid'), undefined);
  const row = { status: 'AGENDADA', startsAt: '2030-01-01T12:00:00Z', endsAt: '2030-01-01T12:30:00Z' };
  const now = Date.parse('2030-01-01T11:00:00Z');
  assert.equal(calendarEligible(row, now), true);
  for (const status of ['CANCELADA', 'ATENDIDA', 'INASISTENCIA']) assert.equal(calendarEligible({ ...row, status }, now), false);
  for (const patch of [{ startsAt: 'invalid' }, { endsAt: row.startsAt }, { endsAt: 'invalid' }]) assert.equal(calendarEligible({ ...row, ...patch }, now), false);
  assert.equal(calendarEligible(row, Date.parse(row.startsAt)), false);
});
test('popup code client requests only owned events and opens synchronously only on explicit action', async () => {
  const f = oauth(); assert.equal(f.requests(), 0);
  assert.equal(f.options().scope, CALENDAR_SCOPE); assert.equal(f.options().include_granted_scopes, false);
  assert.equal(f.options().ux_mode, 'popup'); assert.equal(f.options().client_id, clientId);
  assert.equal(f.options().redirect_uri, undefined);
  const result = f.client.requestCode(); assert.equal(f.requests(), 1);
  f.options().callback({ code }); assert.equal(await result, code);
  f.client.dispose();
});
for (const status of ['CREATED', 'ALREADY_EXISTS']) test(`Calendar ${status} uses the same minimal authenticated POST and discards provider extras`, async () => {
  const calls = [];
  const api = createAppointmentsApi({ request: async (path, options) => {
    calls.push({ path, options }); return { data: { appointmentId: id, eventId, status, accessToken: 'provider-private', htmlLink: 'private' } };
  } });
  const signal = new AbortController().signal;
  assert.deepEqual(await api.exportCalendar(id, code, signal), { appointmentId: id, eventId, status });
  assert.deepEqual(calls, [{ path: `appointments/${id}/google-calendar`, options: {
    method: 'POST', body: { code }, requestedWith: 'XmlHttpRequest', retryAfterRefresh: false, signal,
  } }]);
});
test('transport sends internal Bearer and popup header, never Google token, identity override or query', async () => {
  const calls = [];
  const client = createHttpClient({ baseUrl: '/api/v1', getAccessToken: () => 'citajusta-access', fetcher: async (url, options) => {
    calls.push({ url, options }); return Response.json({ data: { appointmentId: id, eventId, status: 'CREATED' } });
  } });
  await createAppointmentsApi(client).exportCalendar(id, code);
  assert.equal(calls[0].url, `/api/v1/appointments/${id}/google-calendar`);
  assert.equal(calls[0].options.headers.get('X-Requested-With'), 'XmlHttpRequest');
  assert.equal(calls[0].options.headers.get('Authorization'), 'Bearer citajusta-access');
  assert.deepEqual(JSON.parse(calls[0].options.body), { code });
  assert.equal(calls[0].options.credentials, 'omit');
});
test('malformed IDs/codes cannot send requests and malformed/mismatched result cannot report success', async () => {
  let calls = 0;
  const api = createAppointmentsApi({ request: async () => { calls++; return {}; } });
  for (const args of [['invalid', code], [id, ''], [id, 'has spaces'], [id, 'a'.repeat(4097)]]) await assert.rejects(api.exportCalendar(...args));
  assert.equal(calls, 0);
  for (const data of [{ appointmentId: id, eventId: '!invalid', status: 'CREATED' }, { appointmentId: id, eventId, status: 'FAILED' },
    { appointmentId: 'another', eventId, status: 'CREATED' }]) {
    await assert.rejects(createAppointmentsApi({ request: async () => ({ data }) }).exportCalendar(id, code));
  }
});
test('double clicks request one popup and one insertion until the whole operation completes', async () => {
  const f = oauth(), lock = createSubmissionLock(); let sent = 0;
  const operation = () => lock.run(async () => { const received = await f.client.requestCode(); assert.equal(received, code); sent++; return 'CREATED'; });
  const first = operation(); assert.equal(await operation(), undefined); assert.equal(f.requests(), 1);
  f.options().callback({ code }); assert.equal(await first, 'CREATED'); assert.equal(sent, 1);
});
for (const reason of ['popup_closed', 'popup_failed_to_open', 'denied']) test(`${reason} is controlled and permits retry without insertion`, async () => {
  const f = oauth(); const result = f.client.requestCode();
  const expected = assert.rejects(result, (error) => {
    assert.ok(error instanceof CalendarAuthorizationError); assert.doesNotMatch(calendarErrorMessage(error), /private|transient/); return true;
  });
  if (reason === 'denied') f.options().callback({ error: 'private-provider-error' });
  else f.options().error_callback({ type: reason });
  await expected;
  const retried = f.client.requestCode(); f.options().callback({ code }); assert.equal(await retried, code);
});
test('unmount/logout disposes pending popup and ignores late credentials', async () => {
  const f = oauth(); const result = f.client.requestCode();
  const rejected = assert.rejects(result, CalendarAuthorizationError); f.client.dispose(); await rejected;
  f.options().callback({ code }); await assert.rejects(f.client.requestCode(), CalendarAuthorizationError);
});
test('backend/network errors are sanitized and never retried or shown verbatim', async () => {
  for (const status of [400, 401, 403, 404, 409, 429, 502, 503]) {
    let calls = 0;
    const client = createHttpClient({ baseUrl: '/api/v1', fetcher: async () => { calls++; return Response.json({ message: code }, { status }); } });
    await assert.rejects(createAppointmentsApi(client).exportCalendar(id, code), (error) => {
      assert.equal(error.status, status); assert.ok(!calendarErrorMessage(error).includes(code)); return true;
    });
    assert.equal(calls, 1);
  }
  assert.ok(!calendarErrorMessage(new Error(code)).includes(code));
});
test('expired internal session refreshes without replaying the one-use Calendar code', async () => {
  const calls = [], saved = [];
  const session = createAuthSession({ publicApi: { request: async (path) => ({ accessToken: 'internal', refreshToken: 'refresh', tokenType: 'Bearer' }) },
    authenticatedApi: () => ({ request: async (path) => {
      calls.push(path);
      if (path.endsWith('/google-calendar')) throw new ApiError(401);
      return { data: { id, email: 'test@example.test', firstName: 'Ana', lastName: 'Pérez', status: 'ACTIVE', roles: [], permissions: [], context: {} } };
    } }), storage: { read() {}, write: (token) => saved.push(token), clear() {} } });
  await session.loginGoogle('identity-credential');
  await assert.rejects(createAppointmentsApi(session.api).exportCalendar(id, code), { status: 401 });
  assert.equal(calls.filter((path) => path.endsWith('/google-calendar')).length, 1);
  assert.ok(!JSON.stringify(saved).includes(code));
});
test('identity and Calendar share exactly one SDK script flight and do not store authorization data', async (t) => {
  let script, appended = 0;
  const localStorage = { setItem: mock.fn() }, sessionStorage = { setItem: mock.fn() };
  t.mock.method(globalThis, 'setTimeout', () => 1); t.mock.method(globalThis, 'clearTimeout', () => {});
  const priorWindow = globalThis.window, priorDocument = globalThis.document;
  globalThis.window = { setTimeout, clearTimeout, localStorage, sessionStorage };
  globalThis.document = { createElement: () => ({ remove() {} }), head: { append: (value) => { appended++; script = value; } } };
  try {
    const first = loadGoogleSdk(), second = loadGoogleSdk(); assert.equal(first, second); assert.equal(appended, 1);
    assert.equal(script.src, 'https://accounts.google.com/gsi/client');
    globalThis.window.google = { accounts: { id: {}, oauth2: {} } }; script.onload(); await first; await loadGoogleSdk();
    assert.equal(appended, 1); assert.equal(localStorage.setItem.mock.callCount(), 0); assert.equal(sessionStorage.setItem.mock.callCount(), 0);
  } finally { if (priorWindow === undefined) delete globalThis.window; else globalThis.window = priorWindow;
    if (priorDocument === undefined) delete globalThis.document; else globalThis.document = priorDocument; }
});
