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
function listingRow(patch = {}) {
  const process = processFixture();
  return { id: process.id, status: process.status, detectedAt: process.detectedAt, startedAt: process.startedAt, finishedAt: process.finishedAt,
    closureReasonCode: process.closureReasonCode, branch: process.branch, service: process.service,
    agendaSlot: { id: process.agendaSlot.id, startsAt: process.agendaSlot.startsAt, endsAt: process.agendaSlot.endsAt }, ...patch };
}

test('RF038 detalle existente conserva resumen, política y evaluación controlada', () => {
  const html = render(processFixture());
  for (const value of ['Atención controlada', 'Sede controlada', 'Institución controlada', 'OFFERING', 'PRIORITY_FIFO', 'COMPATIBILITY', 'v1', 'AUTHORIZED_REQUEST', 'America/Santiago', 'ISO UTC']) assert.ok(html.includes(value), value);
  assert.match(html, /<time dateTime=|<time datetime=/); assert.doesNotMatch(html, /<button|<pre|password|token/);
});
test('RF038 detalle existente conserva legado, candidatos y ofertas de servidor', () => {
  const data = processFixture(); data.policy = null;
  let html = render(data);
  for (const text of ['Proceso legado', 'Sin posición', 'EXCLUDED', 'SPECIFIC_PROFESSIONAL_UNDEFINED', '123.450000', 'PRIORITY_LEVEL', 'ENTERED_AT', 'Preferencias registradas', '09:00']) assert.ok(html.includes(text), text);
  assert.ok(html.indexOf('Posición: 2') < html.indexOf('Sin posición')); assert.match(html, /<details>/);
  data.activeOfferId = id(16); assert.match(render(data), /Oferta activa según el servidor/);
  data.offers[0].expiresAt = '2000-01-01T00:00:00.000Z'; data.activeOfferId = null; html = render(data);
  assert.match(html, /No hay oferta activa/); assert.match(html, /Oferta PENDING persistida/); assert.doesNotMatch(html, /Aceptar|Rechazar|Generar oferta/);
});
test('RF038 detalle existente no inventa candidatos u ofertas vacías', () => {
  const data = processFixture(); data.candidates = []; data.offers = []; data.activeOfferId = null; data.pendingOfferId = null;
  const html = render(data); assert.match(html, /No hay candidatos registrados/); assert.match(html, /No hay ofertas registrados|No hay ofertas registradas/);
});
test('RF038 listado accesible muestra siete estados, resumen público, vacío y paginación', () => {
  const model = createReassignmentModel({}, profile), state = model.getSnapshot();
  const view = patch => renderToStaticMarkup(createElement(ReassignmentView, { model, state: { ...state, ...patch } }));
  const ready = view({ status: 'ready', data: [listingRow()], nextCursor: 'cursor_1' });
  assert.match(ready, /name="status"/); for (const status of ['PENDING', 'EVALUATING', 'OFFERING', 'COMPLETED', 'EXHAUSTED', 'CANCELLED', 'FAILED']) assert.match(ready, new RegExp(`>${status}<`));
  for (const text of ['Atención controlada', 'Sede: Sede controlada', 'Detectada', 'Abrir detalle', 'Cargar más']) assert.match(ready, new RegExp(text));
  assert.doesNotMatch(ready, /Candidatos|Ofertas|recipient|password|token/);
  assert.match(view({ status: 'loading' }), /Cargando reasignaciones/); assert.match(view({ status: 'ready', data: [] }), /No se encontraron reasignaciones/);
  assert.match(view({ status: 'error', error: 'Error controlado' }), /role="alert">Error controlado/); assert.match(view({ status: 'denied' }), /reassignments.read/);
  assert.match(ready, /name="reassignmentId"/); assert.match(ready, /aria-label="Consultar por UUID"/);
  assert.match(view({ status: 'error', error: 'Error controlado' }), /Reintentar carga/);
  assert.doesNotMatch(view({ status: 'loading' }), /Reintentar carga/);
  assert.doesNotMatch(view({ status: 'denied' }), /<form|<input|<button/);
  model.dispose();
});

function elements(node) {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!node || typeof node !== 'object' || !node.props) return [];
  return [node, ...elements(node.props.children)];
}

test('RF038 formulario UUID permanece habilitado con listado fallido y envía/refresca el detalle', async () => {
  const paths = [];
  const model = createReassignmentModel({ request: async (path) => {
    paths.push(path); return { data: processFixture() };
  } }, profile);
  const view = () => ReassignmentView({ model, state: { ...model.getSnapshot(), status: 'error', error: 'Fallo listado' } });
  const input = elements(view()).find(node => node.type === 'input' && node.props.name === 'reassignmentId');
  input.props.onChange({ target: { value: id(3) } });
  assert.equal(model.getSnapshot().id, id(3));
  let prevented = 0;
  const submit = () => elements(view()).find(node => node.type === 'form').props.onSubmit({ preventDefault() { prevented++; } });
  submit();
  const loading = elements(view()).find(node => node.type === 'button' && node.props.type === 'submit');
  assert.equal(loading.props.disabled, true);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(model.getSnapshot().detailStatus, 'ready');
  submit(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(prevented, 2); assert.deepEqual(paths, [`reassignments/${id(3)}`, `reassignments/${id(3)}`]);
  assert.match(renderToStaticMarkup(view()), /Fallo listado/); assert.match(renderToStaticMarkup(view()), /Detalle de reasignación/);
  model.dispose();
});

test('RF038 botón de reintento ejecuta la carga y recupera el listado', async () => {
  let fail = true;
  const model = createReassignmentModel({ request: async () => {
    if (fail) throw new Error('Private network error');
    return { data: [listingRow()], page: { nextCursor: null } };
  } }, profile);
  await model.consult();
  const view = () => ReassignmentView({ model, state: model.getSnapshot() });
  const retry = elements(view()).find(node => node.type === 'button' && node.props.children === 'Reintentar carga');
  assert.ok(retry); fail = false; retry.props.onClick();
  assert.equal(model.getSnapshot().status, 'loading');
  assert.equal(elements(view()).some(node => node.type === 'button' && node.props.children === 'Reintentar carga'), false);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(model.getSnapshot().status, 'ready'); assert.match(renderToStaticMarkup(view()), /Abrir detalle/);
  model.dispose();
});
test('RF038 carga de detalle desde fila y estados de detalle son accesibles', () => {
  const model = createReassignmentModel({}, profile), state = model.getSnapshot(), detail = parseReassignment(processFixture());
  const view = patch => renderToStaticMarkup(createElement(ReassignmentView, { model, state: { ...state, ...patch } }));
  assert.match(view({ detailStatus: 'loading' }), /Cargando detalle del proceso/); assert.match(view({ detailStatus: 'error', detailError: 'Error controlado' }), /role="alert">Error controlado/);
  const html = view({ detailStatus: 'ready', detail }); assert.match(html, /Cerrar detalle/); assert.match(html, /Candidatos/); assert.match(html, /Ofertas/); model.dispose();
});
test('RF038 sesión verificada y navegación usan el listado real sin IDs de alcance editables', async () => {
  const session = createAuthSession({ publicApi: { request: async () => ({ accessToken: 'test-access', refreshToken: 'test-refresh', tokenType: 'Bearer' }) }, authenticatedApi: () => ({ request: async () => ({ data: profile }) }), storage: createMemorySessionStorage() });
  const page = () => renderToStaticMarkup(createElement(SessionProvider, { session }, createElement(ReassignmentPage)));
  assert.match(page(), /sesión verificada/); await session.restore(); await session.login({ email: profile.email, password: 'test-only' });
  const html = page(); assert.match(html, /Reasignaciones institucionales/); assert.match(html, /Todos los estados/); assert.doesNotMatch(html, /name="institutionId"|name="branchId"|test-access|test-refresh/);
  const nav = renderToStaticMarkup(createElement(InstitutionalNavigation, { selected: 'Reasignaciones', onSelect() {} }));
  assert.match(nav, /aria-pressed="true"><span>Reasignaciones<\/span><\/button>/); assert.equal((nav.match(/En preparación/g) ?? []).length, 0);
});
