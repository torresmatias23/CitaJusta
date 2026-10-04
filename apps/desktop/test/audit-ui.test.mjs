import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import { createAuthSession } from '@citajusta/client-core';
import { createMemorySessionStorage } from '../src/auth/memory-session-storage.ts';
import { createAuditModel } from '../src/audit/audit-model.ts';
import { parseAuditPage, auditActions, auditResources } from '../src/audit/audit-api.ts';
import { profile, branch, auditEvent, page } from './fixtures/audit.mjs';
const vite = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom' });
after(() => vite.close());
const { AuditEventCard, AuditView, AuditPage } = await vite.ssrLoadModule('/src/audit/audit-page.tsx');
const { SessionProvider } = await vite.ssrLoadModule('/src/auth/auth-provider.tsx');
const { InstitutionalNavigation } = await vite.ssrLoadModule('/src/components/institutional-navigation.tsx');
const renderEvent = value => renderToStaticMarkup(createElement(AuditEventCard, { event: parseAuditPage(page([value])).data[0] }));
function view(patch = {}, user = profile) {
  const model = createAuditModel({ request: async () => page() }, user);
  const html = renderToStaticMarkup(createElement(AuditView, { model, state: { ...model.getSnapshot(), ...patch } }));
  model.dispose(); return html;
}

test('HU038 Auditoría navigation active; all modules available, exactly one selected', async () => {
  const html = renderToStaticMarkup(createElement(InstitutionalNavigation, { selected: 'Auditoría', onSelect() {} }));
  assert.match(html, /aria-pressed="true"><span>Auditoría<\/span><\/button>/);
  assert.equal((html.match(/aria-pressed="true"/g) ?? []).length, 1); assert.doesNotMatch(html, /En preparación/);
  const source = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');
  assert.match(source, /selected === 'Auditoría' \? <AuditPage \/>/);
});
test('HU038 civil dates optional and filters accessible with closed action/resource selects', () => {
  const html = view();
  for (const name of ['from', 'to']) {
    const input = html.match(new RegExp('<input[^>]*name="' + name + '"[^>]*>'))?.[0];
    assert.ok(input); assert.match(input, /type="date"/); assert.doesNotMatch(input, /required/);
  }
  for (const name of ['from', 'to', 'branchId', 'actorUserId', 'action', 'resourceType']) assert.ok(html.includes(`name="${name}"`), name);
  assert.match(html, /<label[^>]*>Usuario actor/); assert.match(html, /audit-actor-help/);
  assert.match(html, /<select name="action"/); assert.match(html, /<select name="resourceType"/);
  for (const code of [...auditActions, ...auditResources]) assert.ok(html.includes(`value="${code}"`), code);
  assert.doesNotMatch(html, /name="institutionId"|name="userId"|name="offset"|name="page"|366/);
});
test('HU038 branch scope fixed with real UUID and no editable branch selector', () => {
  const html = view({}, { ...profile, context: { ...profile.context, branchId: branch.id } });
  assert.match(html, /Sede del contexto \(fija\)/); assert.ok(html.includes(branch.id)); assert.doesNotMatch(html, /name="branchId"/);
});
test('HU038 denied has no functional form/data; loading disables duplicate submission', () => {
  const denied = view({ status: 'denied' }); assert.match(denied, /audit.read/); assert.doesNotMatch(denied, /<form|<input|<article/);
  const loading = view({ status: 'loading' }); assert.match(loading, /type="submit"[^>]*disabled=""/); assert.match(loading, /Cargando eventos/);
  assert.match(view({ status: 'error', error: 'Error controlado' }), /role="alert">Error controlado/);
});
test('HU038 catalog failure leaves consultation available and empty page is informative', () => {
  const html = view({ status: 'ready', data: [], catalogStatus: 'error' });
  assert.match(html, /No se pudieron cargar las sedes/); assert.match(html, /Consultar eventos/); assert.match(html, /No se encontraron eventos/);
  assert.doesNotMatch(html, /Cargar más/);
});
test('HU038 USER and SYSTEM actors, resource type/id and ISO UTC time are factual', () => {
  const user = auditEvent(); const html = renderEvent(user);
  for (const value of ['Usuario · USER', user.actorUserId, 'APPOINTMENT', user.resourceId, user.occurredAt, 'Fecha/hora (UTC)', user.actionCode, user.id, user.branchId]) assert.ok(html.includes(value), value);
  assert.match(html, /<time (?:dateTime|datetime)="2026-10-01T12:30:00.000Z"/);
  const system = renderEvent(auditEvent({ actorType: 'SYSTEM', actorUserId: null, resourceId: null }));
  assert.match(system, /Sistema · SYSTEM/); assert.doesNotMatch(system, new RegExp(user.actorUserId));
});
test('HU038 outcome SUCCESS/FAILURE, real transition and reasonCode remain traceable', () => {
  const success = renderEvent(auditEvent()); assert.match(success, /Éxito · SUCCESS/); assert.match(success, /AGENDADA → CANCELADA/);
  const failure = renderEvent(auditEvent({ actionCode: 'AUTH_LOGIN_FAILURE', resourceType: 'AUTH', outcome: 'FAILURE', previousState: null, newState: null, reasonCode: 'INVALID_CREDENTIALS' }));
  assert.match(failure, /Fallo · FAILURE/); assert.match(failure, /AUTH_LOGIN_FAILURE/); assert.match(failure, /INVALID_CREDENTIALS/); assert.doesNotMatch(failure, /Transición registrada/);
});
test('HU038 load-more only with cursor; busy disables it; failure retains event and exposes retry', () => {
  const data = [parseAuditPage(page()).data[0]];
  assert.doesNotMatch(view({ status: 'ready', data, nextCursor: null }), /Cargar más/);
  assert.match(view({ status: 'ready', data, nextCursor: 'opaque' }), /Cargar más/);
  const busy = view({ status: 'ready', data, nextCursor: 'opaque', loadingMore: true }); assert.match(busy, /type="button"[^>]*disabled=""/); assert.match(busy, /Cargando más eventos/);
  const failed = view({ status: 'ready', data, nextCursor: 'opaque', moreError: 'Error controlado' });
  assert.match(failed, /Los eventos ya consultados se conservan/); assert.match(failed, /Cargar más/); assert.ok(failed.includes(data[0].id));
  assert.doesNotMatch(failed, /opaque/);
});
test('HU038 read-only rendering excludes mutation buttons, graphs and received private extras', () => {
  const html = renderEvent({ ...auditEvent(), email: 'PRIVATE_EMAIL', passwordHash: 'PRIVATE_PASSWORD', token: 'PRIVATE_TOKEN', Authorization: 'PRIVATE_HEADER', payload: 'PRIVATE_PAYLOAD' });
  assert.doesNotMatch(html, /PRIVATE_|<button|<canvas|<svg|<pre|password|token|email|Authorization/);
  const full = view({ status: 'ready', data: parseAuditPage(page()).data, nextCursor: 'opaque' });
  const buttons = [...full.matchAll(/<button[^>]*>([^<]*)<\/button>/g)].map(match => match[1]);
  assert.deepEqual(buttons, ['Consultar eventos', 'Cargar más']); assert.doesNotMatch(full, /Eliminar|Guardar|Editar evento|tendencia/);
});
test('HU038 verified session gate, institutional context and current permission used', async () => {
  const session = createAuthSession({ publicApi: { request: async () => ({ accessToken: 'private-access', refreshToken: 'private-refresh', tokenType: 'Bearer' }) },
    authenticatedApi: () => ({ request: async () => ({ data: profile }) }), storage: createMemorySessionStorage() });
  const render = () => renderToStaticMarkup(createElement(SessionProvider, { session }, createElement(AuditPage)));
  assert.match(render(), /sesión verificada/); await session.restore(); await session.login({ email: profile.email, password: 'test-only' });
  assert.match(render(), /Consultar eventos/); assert.doesNotMatch(render(), /private-access|private-refresh|controlled@example/);
});
