import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import react from '@vitejs/plugin-react';
import { createServer } from 'vite';

const vite = await createServer({ root: fileURLToPath(new URL('..', import.meta.url)), configFile: false, envDir: false,
  optimizeDeps: { noDiscovery: true, include: [] }, plugins: [react()], server: { middlewareMode: true, hmr: false }, appType: 'custom' });
after(() => vite.close());
const { createPrivacyApi, parseNotice } = await vite.ssrLoadModule('/src/features/privacy/privacy-api.ts');
const { createPrivacyModel } = await vite.ssrLoadModule('/src/features/privacy/privacy-model.ts');
const { PrivacyNoticeView } = await vite.ssrLoadModule('/src/features/privacy/privacy-page.tsx');
const { ApiError } = await vite.ssrLoadModule('/src/lib/http-client.ts');
const first = { id: '10000000-0000-4000-8000-000000000001', version: 'v1', publishedOn: '2026-11-02', title: 'Información de privacidad', introduction: 'Información, no consentimiento.', sections: [{ heading: 'Finalidad', paragraphs: ['Datos para gestionar citas.'] }] };
const second = { ...first, id: '10000000-0000-4000-8000-000000000002', version: 'v2' };
const date = '2026-11-02T12:00:00.000Z';
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
function fixture(authenticated = true) {
  const calls = [], source = { notice: first, acknowledgedAt: null, failRead: null, failWrite: null, saving: null };
  const publicApi = { request: async (path, options) => { calls.push({ path, options }); return { data: source.notice }; } };
  const accountApi = { request: async (path, options) => {
    calls.push({ path, options });
    if (options.method === 'POST') {
      if (source.failWrite) throw source.failWrite;
      if (source.saving) return source.saving.promise;
      source.acknowledgedAt = date; return { data: { versionId: source.notice.id, acknowledgedAt: date } };
    }
    if (source.failRead) throw source.failRead;
    return { data: { notice: source.notice, acknowledgedAt: source.acknowledgedAt } };
  } };
  const api = createPrivacyApi(publicApi, accountApi), model = createPrivacyModel(api, authenticated);
  return { api, model, calls, source };
}
const writes = f => f.calls.filter(call => call.options.method === 'POST');
test('anonymous notice consultation never creates acceptance or calls account endpoints', async () => {
  const f = fixture(false); await f.model.load(); await f.model.acknowledge();
  assert.equal(f.model.getSnapshot().notice.version, 'v1');
  assert.deepEqual(f.calls.map(call => call.path), ['privacy-notice']);
});
test('first authenticated access requires an explicit action, sends only version and stops repeats after confirmation', async () => {
  const f = fixture(); await f.model.load();
  assert.equal(f.model.getSnapshot().acknowledgedAt, null); assert.equal(writes(f).length, 0);
  await f.model.acknowledge(); await f.model.acknowledge();
  assert.equal(writes(f).length, 1);
  assert.deepEqual(writes(f)[0].options.body, { versionId: first.id });
  assert.equal(f.model.getSnapshot().acknowledgedAt, date);
});
test('previously recorded version is loaded from server, without writing or local acceptance storage', async () => {
  const f = fixture(); f.source.acknowledgedAt = date; await f.model.load(); await f.model.acknowledge();
  assert.equal(f.model.getSnapshot().acknowledgedAt, date); assert.equal(writes(f).length, 0);
});
test('new version requires another explicit confirmation and never carries prior acknowledgement forward', async () => {
  const f = fixture(); f.source.acknowledgedAt = date; await f.model.load();
  f.source.notice = second; f.source.acknowledgedAt = null; await f.model.load();
  assert.equal(f.model.getSnapshot().acknowledgedAt, null); assert.equal(writes(f).length, 0);
  await f.model.acknowledge(); assert.deepEqual(writes(f)[0].options.body, { versionId: second.id });
});
test('version conflict requires reload and never automatically confirms unseen content', async () => {
  const f = fixture(); await f.model.load(); f.source.failWrite = new ApiError(409);
  await f.model.acknowledge(); assert.equal(f.model.getSnapshot().status, 'error');
  f.source.notice = second; f.source.failWrite = null; await f.model.load();
  assert.equal(writes(f).length, 1); assert.equal(f.model.getSnapshot().acknowledgedAt, null);
});
test('storage outage still offers public information and recovery, without blocking essential navigation', async () => {
  const f = fixture(); f.source.failRead = new ApiError(503); await f.model.load();
  assert.equal(f.model.getSnapshot().status, 'error'); assert.equal(f.model.getSnapshot().notice.id, first.id);
  await f.model.acknowledge(); assert.equal(writes(f).length, 0);
  assert.deepEqual(f.calls.map(call => call.path), ['users/me/privacy-notice', 'privacy-notice']);
});
test('write errors stay visible and sanitized, preserve unconfirmed state and allow retry', async () => {
  const f = fixture(); await f.model.load(); f.source.failWrite = new Error('private-token');
  await f.model.acknowledge(); assert.equal(f.model.getSnapshot().acknowledgedAt, null);
  assert.doesNotMatch(f.model.getSnapshot().error, /private-token/);
  f.source.failWrite = null; await f.model.acknowledge(); assert.equal(f.model.getSnapshot().acknowledgedAt, date);
});
test('concurrent clicks issue one POST; disposed identity never receives its delayed result', async () => {
  const f = fixture(); await f.model.load(); f.source.saving = deferred();
  const saving = f.model.acknowledge(); await f.model.acknowledge(); assert.equal(writes(f).length, 1);
  f.model.dispose(); assert.equal(writes(f)[0].options.signal.aborted, true);
  const other = fixture(); await other.model.load();
  f.source.saving.resolve({ data: { versionId: first.id, acknowledgedAt: date } }); await saving;
  assert.equal(f.model.getSnapshot().acknowledgedAt, null); assert.equal(other.model.getSnapshot().acknowledgedAt, null);
});
test('StrictMode restart and reload ignore stale account/notice responses', async () => {
  const old = deferred(); let count = 0;
  const model = createPrivacyModel({ mine: async () => ++count === 1 ? old.promise : { notice: second, acknowledgedAt: null } }, true);
  const loading = model.load(); model.dispose(); await model.load();
  old.resolve({ notice: first, acknowledgedAt: date }); await loading;
  assert.equal(model.getSnapshot().notice.id, second.id); assert.equal(model.getSnapshot().acknowledgedAt, null);
});
test('transport rejects malformed content and mismatched confirmation version', async () => {
  for (const patch of [{ id: 'bad' }, { sections: [] }, { sections: [{ heading: 'Bad', paragraphs: [false] }] }]) assert.throws(() => parseNotice({ ...first, ...patch }));
  const f = fixture(); await f.model.load(); f.source.notice = second; await f.model.acknowledge();
  assert.equal(f.model.getSnapshot().acknowledgedAt, null); assert.ok(f.model.getSnapshot().error);
});
test('full notice has accessible explicit confirmation, no consent checkbox and no forced navigation', async () => {
  const f = fixture(); await f.model.load();
  const render = (authenticated, state = f.model.getSnapshot()) => renderToStaticMarkup(createElement(MemoryRouter, null,
    createElement(PrivacyNoticeView, { state, authenticated, onRetry() {}, onAcknowledge() {} })));
  const anonymous = render(false); assert.match(anonymous, /Datos para gestionar citas/); assert.doesNotMatch(anonymous, /Ya vi esta información/);
  const existing = render(true); assert.match(existing, /aria-describedby="privacy-confirmation-help"/);
  assert.match(existing, /Ya vi esta información/); assert.match(existing, /href="\/cuenta"/); assert.match(existing, /href="\/"/);
  assert.doesNotMatch(existing, /type="checkbox"|role="dialog"|Acepto/);
  const confirmed = render(true, { ...f.model.getSnapshot(), acknowledgedAt: date });
  assert.match(confirmed, /role="status"/); assert.doesNotMatch(confirmed, /Ya vi esta información/);
});
