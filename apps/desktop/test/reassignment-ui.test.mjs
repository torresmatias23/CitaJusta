import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import { createAuthSession } from '@citajusta/client-core';
import { createMemorySessionStorage } from '../src/auth/memory-session-storage.ts';
import { createReassignmentModel } from '../src/reassignments/reassignment-model.ts';
import { parseReassignment } from '../src/reassignments/reassignment-api.ts';
import { id, profile, processFixture } from './fixtures/reassignment.mjs';
const vite = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom' });
after(() => vite.close());
const { ReassignmentDetail, ReassignmentView, ReassignmentPage } = await vite.ssrLoadModule('/src/reassignments/reassignment-page.tsx');
const { SessionProvider } = await vite.ssrLoadModule('/src/auth/auth-provider.tsx');
const { InstitutionalNavigation } = await vite.ssrLoadModule('/src/components/institutional-navigation.tsx');
const render = value => renderToStaticMarkup(createElement(ReassignmentDetail, { data: parseReassignment(value) }));

test('HU036 resumen, política y evaluación controlada con fechas UTC', () => {
  const html = render(processFixture());
  for (const value of ['Atención controlada', 'Sede controlada', 'Institución controlada', 'OFFERING', 'PRIORITY_FIFO', 'COMPATIBILITY', 'v1', 'AUTHORIZED_REQUEST', 'America/Santiago', 'ISO UTC']) assert.ok(html.includes(value), value);
  assert.match(html, /<time dateTime=|<time datetime=/); assert.doesNotMatch(html, /<button|<pre|password|token/);
});
test('HU036 legado, candidatos excluidos y orden backend se conservan', () => {
  const d = processFixture(); d.policy = null;
  const html = render(d);
  for (const text of ['Proceso legado', 'Sin posición', 'EXCLUDED', 'SPECIFIC_PROFESSIONAL_UNDEFINED', '123.450000', 'PRIORITY_LEVEL', 'ENTERED_AT', 'Preferencias registradas', '09:00']) assert.ok(html.includes(text), text);
  assert.ok(html.indexOf('Posición: 2') < html.indexOf('Sin posición'));
  assert.match(html, /<details>/);
});
test('HU036 ofertas usa sólo flags del servidor y no recalcula expiración', () => {
  const d = processFixture(); d.offers[0].expiresAt = '2000-01-01T00:00:00.000Z';
  assert.match(render(d), /Oferta activa según el servidor/);
  d.activeOfferId = null;
  const html = render(d); assert.match(html, /No hay oferta activa/); assert.match(html, /Oferta PENDING persistida/); assert.match(html, /PENDING/);
  assert.doesNotMatch(html, /Oferta activa según el servidor|Aceptar|Rechazar|Generar oferta|<button/);
});
test('HU036 empty de candidatos/ofertas no inventa resultados', () => {
  const d = processFixture(); d.candidates = []; d.offers = []; d.activeOfferId = null; d.pendingOfferId = null;
  const html = render(d); assert.match(html, /No hay candidatos registrados/); assert.match(html, /No hay ofertas registradas/);
});
test('HU036 consulta UUID, estados loading/error y denegación accesibles', () => {
  const model = createReassignmentModel({}, profile), state = model.getSnapshot();
  const view = patch => renderToStaticMarkup(createElement(ReassignmentView, { model, state: { ...state, ...patch } }));
  assert.match(view({}), /name="reassignmentId"/); assert.match(view({}), /Consultar proceso/); assert.doesNotMatch(view({}), /name="institutionId"|name="branchId"/);
  assert.match(view({ status: 'loading' }), /disabled=""/); assert.match(view({ status: 'loading' }), /Cargando proceso/);
  assert.match(view({ status: 'error', error: 'Introduce un UUID válido.' }), /role="alert">Introduce un UUID válido/);
  assert.doesNotMatch(view({ status: 'denied' }), /<form|<input/); assert.match(view({ status: 'denied' }), /reassignments.read/);
  model.dispose();
});
test('HU036 sesión verificada y navegación real sin placeholder Reasignaciones', async () => {
  const session = createAuthSession({ publicApi: { request: async () => ({ accessToken: 'test-access', refreshToken: 'test-refresh', tokenType: 'Bearer' }) }, authenticatedApi: () => ({ request: async () => ({ data: profile }) }), storage: createMemorySessionStorage() });
  const page = () => renderToStaticMarkup(createElement(SessionProvider, { session }, createElement(ReassignmentPage)));
  assert.match(page(), /sesión verificada/); await session.restore(); await session.login({ email: profile.email, password: 'test-only' });
  assert.match(page(), /Consultar proceso/); assert.doesNotMatch(page(), /test-access|test-refresh/);
  const nav = renderToStaticMarkup(createElement(InstitutionalNavigation, { selected: 'Reasignaciones', onSelect() {} }));
  assert.match(nav, /aria-pressed="true"><span>Reasignaciones<\/span><\/button>/);
  assert.equal((nav.match(/En preparación/g) ?? []).length, 2);
});
