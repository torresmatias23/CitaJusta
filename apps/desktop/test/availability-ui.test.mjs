import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import { createAvailabilityModel } from '../src/availability/availability-model.ts';
import { profile, availability, block, branch, institutionId } from './fixtures/availability.mjs';
const vite = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom' });
after(() => vite.close());
const { AvailabilityView, AvailabilityPage, AvailabilityEditor } = await vite.ssrLoadModule('/src/availability/availability-page.tsx');
const { AgendaSection } = await vite.ssrLoadModule('/src/agenda/agenda-section.tsx');
const { SessionProvider } = await vite.ssrLoadModule('/src/auth/auth-provider.tsx');
const render = (model, state = model.getSnapshot()) => renderToStaticMarkup(createElement(AvailabilityView, { model, state }));
test('HU032 UI labels and strict filter fields; branch fixed, no identity or AttentionPoint selector', () => {
  const model = createAvailabilityModel({}, { ...profile, context: { institutionId, branchId: branch.id } }); const html = render(model);
  for (const name of ['date','branchId','serviceId','professionalId']) assert.ok(html.includes(`name="${name}"`));
  assert.match(html, /<select name="branchId" disabled/); assert.match(html, /Crear disponibilidad/); assert.match(html, /Crear bloqueo/);
  assert.doesNotMatch(html, /name="institutionId"|name="userId"|name="attentionPointId"/);
});
test('HU032 UI statuses, historical rows, safe text, optional point and no block edit/delete', () => {
  const model = createAvailabilityModel({}, profile), base = { ...model.getSnapshot(), catalogStatus: 'ready', timeZone: 'America/Bogota' };
  assert.match(render(model, { ...base, status: 'loading' }), /Cargando disponibilidades/);
  assert.match(render(model, { ...base, status: 'error', error: 'Error controlado' }), /role="alert">Error controlado/);
  assert.match(render(model, { ...base, status: 'ready' }), /No hay disponibilidades/);
  const html = render(model, { ...base, status: 'ready', items: [{ ...availability, active: false, attentionPoint: { id: branch.id, name: 'Sala Uno' } }], blocks: [{ ...block, reason: '<script>unsafe</script>' }] });
  for (const value of ['Inactiva','Sala Uno','America/Bogota','09:00','Sin profesional específico','Editar horario']) assert.ok(html.includes(value), value);
  assert.match(html, /&lt;script&gt;/); assert.doesNotMatch(html, /<script>|Eliminar|Editar bloqueo/);
});
test('HU032 permission gates independently hide reading and writes', () => {
  const read = render(createAvailabilityModel({}, { ...profile, permissions: ['availability.read'] }));
  assert.doesNotMatch(read, /Crear disponibilidad|Crear bloqueo/); assert.match(read, /Filtros administrativos/);
  const create = render(createAvailabilityModel({}, { ...profile, permissions: ['availability.create'] }));
  assert.match(create, /Crear disponibilidad/); assert.doesNotMatch(create, /Filtros administrativos|Crear bloqueo/);
});
test('HU032 authenticated page and Agenda integration keep HU031 default', () => {
  const session = { api: {}, subscribe: () => () => {}, getSnapshot: () => ({ status: 'anonymous', user: null, error: null }) };
  const wrapped = Component => renderToStaticMarkup(createElement(SessionProvider, { session }, createElement(Component)));
  assert.match(wrapped(AvailabilityPage), /sesión verificada/);
  const html = wrapped(AgendaSection); assert.match(html, /Secciones de Agenda/); assert.match(html, /Disponibilidad y bloqueos/); assert.match(html, /Consulta de citas/);
});

test('HU032 real forms: institutional minute inputs, immutable edit identity, explicit reactivation and exact block types', () => {
  const model = createAvailabilityModel({}, profile), state = { ...model.getSnapshot(), timeZone: 'America/Bogota', catalogStatus: 'ready' };
  const form = mode => renderToStaticMarkup(createElement(AvailabilityEditor, { model, state, mode, close() {} }));
  const create = form('create');
  assert.match(create, /type="date" required/); assert.match(create, /type="time" step="60" required/);
  assert.match(create, /Seleccionar servicio/); assert.match(create, /Seleccionar profesional/);
  assert.doesNotMatch(create, /attentionPointId|institutionId|userId/);
  const edit = form({ ...availability, active: false, attentionPoint: { id: branch.id, name: 'Sala histórica' } });
  assert.match(edit, /Identidad fija/); assert.match(edit, /Sala histórica/); assert.match(edit, /Reactivar con este intervalo explícito/);
  assert.doesNotMatch(edit, /Seleccionar sede|Seleccionar servicio|Seleccionar profesional/);
  const blockForm = form('block');
  for (const value of ['VACATION','LEAVE','MEETING','MAINTENANCE','MANUAL','OTHER']) assert.ok(blockForm.includes(`value="${value}"`));
  assert.match(blockForm, /Motivo \(opcional\)/); assert.match(blockForm, /maxLength="2000"/); assert.doesNotMatch(blockForm, /Seleccionar servicio/);
});
