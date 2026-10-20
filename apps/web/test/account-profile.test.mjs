import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { createServer } from 'vite';

const previous = process.env.API_PROXY_TARGET;
process.env.API_PROXY_TARGET = 'http://localhost:3000';
const vite = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom' });
if (previous === undefined) delete process.env.API_PROXY_TARGET; else process.env.API_PROXY_TARGET = previous;
after(() => vite.close());
const { createAccountApi, accountError } = await vite.ssrLoadModule('/src/features/auth/account-api.ts');
const { createAccountModel } = await vite.ssrLoadModule('/src/features/auth/account-model.ts');
const { AccountView } = await vite.ssrLoadModule('/src/features/auth/account-page.tsx');
const { ApiError } = await vite.ssrLoadModule('/src/lib/http-client.ts');
const id = '10000000-0000-4000-8000-000000000001';
const prefs = { appointmentEmailsEnabled: true, offerEmailsEnabled: false };
const user = { id, email: 'profile@example.test', firstName: 'Ana', lastName: 'Pérez', phone: null, status: 'ACTIVE', notificationPreferences: prefs };
function deferred() { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; }
function fixture(handler) {
  const calls = []; let refreshed = 0;
  const client = { request: async (path, options = {}) => {
    calls.push({ path, options }); if (handler) return handler(path, options);
    if (!options.method) return { data: { ...user, passwordHash: 'private' } };
    return { data: options.body };
  } };
  const model = createAccountModel(client, async () => { refreshed++; }, id);
  return { model, calls, refreshed: () => refreshed, client };
}
test('real profile parser strips extras and rejects malformed/foreign identity responses', async () => {
  const f = fixture(); await f.model.load(); assert.equal(f.model.getSnapshot().data.id, id);
  assert.equal(f.model.getSnapshot().data.passwordHash, undefined);
  for (const data of [{ ...user, phone: 123 }, { ...user, notificationPreferences: { appointmentEmailsEnabled: 'false' } }, { ...user, status: 'BLOCKED' }, { ...user, id: '10000000-0000-4000-8000-000000000002' }]) {
    const invalid = fixture(async () => ({ data })); await invalid.model.load(); assert.equal(invalid.model.getSnapshot().status, 'error');
  }
});
test('profile save trims fields, phone blank becomes null, refreshes shared profile without reload', async () => {
  const f = fixture(); await f.model.load(); f.model.setPersonal('firstName', ' Nueva '); f.model.setPersonal('phone', '  ');
  await f.model.savePersonal();
  assert.deepEqual(f.calls[1].options.body, { firstName: 'Nueva', lastName: 'Pérez', phone: null });
  assert.equal(f.calls[1].options.method, 'PATCH'); assert.equal(f.calls[1].options.retryAfterRefresh, false);
  assert.equal(f.refreshed(), 1); assert.equal(f.model.getSnapshot().data.firstName, 'Nueva');
  assert.match(f.model.getSnapshot().profileMessage, /guardada/);
});
test('preference save uses exact boolean body and independent controls', async () => {
  const f = fixture(); await f.model.load(); f.model.setPreference('appointmentEmailsEnabled', false);
  await f.model.savePreferences();
  assert.equal(f.calls[1].path, 'users/me/notification-preferences'); assert.equal(f.calls[1].options.method, 'PUT');
  assert.deepEqual(f.calls[1].options.body, { appointmentEmailsEnabled: false, offerEmailsEnabled: false });
  assert.equal(f.calls[1].options.retryAfterRefresh, false); assert.match(f.model.getSnapshot().preferencesMessage, /internas/);
});
test('profile and preferences each prevent double submit while allowing independent sections', async () => {
  for (const method of ['savePersonal', 'savePreferences']) {
    const pending = deferred(); const f = fixture(async (_path, options) => options.method ? pending.promise : { data: user });
    await f.model.load(); const first = f.model[method](), second = f.model[method]();
    assert.equal(f.calls.length, 2); pending.resolve({ data: method === 'savePersonal' ? { firstName: 'Ana', lastName: 'Pérez', phone: null } : prefs });
    await Promise.all([first, second]); assert.equal(f.calls.length, 2);
  }
});
test('invalid local names prevent requests; failure/invalid server data preserve saved profile', async () => {
  const f = fixture(); await f.model.load(); f.model.setPersonal('lastName', ' '); await f.model.savePersonal();
  assert.equal(f.calls.length, 1); assert.ok(f.model.getSnapshot().profileError);
  const invalid = fixture(async (_path, options) => options.method ? { data: { passwordHash: 'private' } } : { data: user });
  await invalid.model.load(); await invalid.model.savePersonal(); await invalid.model.savePreferences();
  assert.equal(invalid.model.getSnapshot().data.firstName, 'Ana'); assert.ok(invalid.model.getSnapshot().profileError); assert.ok(invalid.model.getSnapshot().preferencesError);
  for (const status of [400, 401, 409, 503]) assert.ok(accountError(new ApiError(status)));
  assert.doesNotMatch(accountError(new Error('secret token')), /secret|token/);
});
test('dispose aborts requests and StrictMode effect restart ignores older load', async () => {
  const old = deferred(); let count = 0;
  const f = fixture(async () => ++count === 1 ? old.promise : { data: { ...user, firstName: 'Actual' } });
  const first = f.model.load(); f.model.dispose(); assert.equal(f.calls[0].options.signal.aborted, true);
  await f.model.load(); old.resolve({ data: user }); await first;
  assert.equal(f.model.getSnapshot().data.firstName, 'Actual');
});
test('account layout has real identity, associated labels, readonly email and independent accessible preferences', async () => {
  const f = fixture(); await f.model.load();
  const html = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(AccountView, { state: f.model.getSnapshot(), model: f.model, google: createElement('button', null, 'Vincular Google') })));
  assert.match(html, /Ana Pérez/); assert.match(html, /profile@example.test/); assert.match(html, /readOnly=""/i);
  for (const field of ['account-first-name', 'account-last-name', 'account-phone']) assert.ok(html.includes(`for="${field}"`) && html.includes(`id="${field}"`));
  assert.equal((html.match(/type="checkbox"/g) ?? []).length, 2); assert.match(html, /notificaciones internas/i); assert.match(html, /Vincular Google/);
  assert.doesNotMatch(html, /type="password"|passwordHash|Vinculada a Google/);
});
