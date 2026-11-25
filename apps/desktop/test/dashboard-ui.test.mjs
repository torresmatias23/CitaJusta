import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import { createDashboardModel } from '../src/dashboard/dashboard-model.ts';
import { profile, dashboard } from './fixtures/dashboard.mjs';
import { branch } from './fixtures/agenda.mjs';
const vite = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom' });
after(() => vite.close());
const { DashboardContent, DashboardView, TrendChart } = await vite.ssrLoadModule('/src/dashboard/dashboard-page.tsx');
const { InstitutionalNavigation } = await vite.ssrLoadModule('/src/components/institutional-navigation.tsx');
const render = data => renderToStaticMarkup(createElement(DashboardContent, { data }));

test('HU037 Panel de gestión is a real module in Análisis, before Reportes', () => {
  const html = renderToStaticMarkup(createElement(InstitutionalNavigation, { selected: 'Panel de gestión', onSelect() {} }));
  assert.match(html, /aria-pressed="true"><span>Panel de gestión<\/span><\/button>/);
  assert.ok(html.indexOf('Panel de gestión') < html.indexOf('Reportes'));
  assert.equal((html.match(/aria-pressed="true"/g) ?? []).length, 1);
});
test('HU037 recommendations come first with severity as text, not color alone', () => {
  const html = render(dashboard().data);
  assert.ok(html.indexOf('Recomendaciones para decidir') < html.indexOf('Indicadores clave'));
  assert.match(html, /tone-danger">Prioridad alta<\/span><h3>Inasistencia de 25 %/);
  assert.match(html, /tone-info">Informativo/);
  assert.match(html, /Acción sugerida:<\/strong> Exigir confirmación anticipada/);
});
test('HU037 KPI tiles render API rates in es-CL format without recalculating them', () => {
  const html = render(dashboard().data);
  for (const label of ['Citas del período', 'Asistencia', 'Inasistencia', 'Cancelación', 'Recuperación de cupos', 'Ocupación de agenda', 'Personas en espera']) assert.ok(html.includes(`<dt>${label}</dt>`), label);
  assert.match(html, /<dd>75 %<\/dd>/); assert.match(html, /<dd>90 %<\/dd>/); assert.match(html, /1 de 4 liberados/);
  assert.match(html, /Promedio 3,3 días/); assert.match(html, /11,1 %/);
});
test('HU037 trend chart: three keyed series, legend, accessible label and a table view', () => {
  const data = dashboard().data;
  const html = renderToStaticMarkup(createElement(TrendChart, { trend: data.trend, granularity: 'day' }));
  assert.equal((html.match(/<path /g) ?? []).length, 3); assert.equal((html.match(/stroke-width="2"/g) ?? []).length, 3);
  for (const label of ['Citas', 'Cancelaciones', 'Inasistencias']) assert.ok(html.includes(label));
  assert.match(html, /role="img" aria-label="Tendencia de citas/);
  assert.match(html, /<summary>Ver datos en tabla<\/summary>/); assert.equal((html.match(/<tr><th scope="row">2026-11-0\d<\/th>/g) ?? []).length, 7);
  assert.match(html, /<title>2026-11-07 · Citas: 7 · Cancelaciones: 0 · Inasistencias: 1<\/title>/);
  assert.match(html, />01-11<\/text>/); assert.match(html, />07-11<\/text>/);
  const weekly = renderToStaticMarkup(createElement(TrendChart, { trend: data.trend.slice(0, 1), granularity: 'week' }));
  assert.match(weekly, /Semana del 2026-11-01/); assert.match(weekly, /<th scope="col">Semana<\/th>/);
});
test('HU037 status and capacity bars keep zero parts in the legend and label every segment', () => {
  const data = dashboard().data;
  const html = render(data);
  assert.match(html, /aria-label="Estado de las citas: Agendadas 4, Atendidas 9, Inasistencias 3, Canceladas 3, Otros estados 1"/);
  assert.match(html, /aria-label="Cupos del período: Reservados 36, En reasignación 1, Disponibles 2, Expirados 1"/);
  const empty = structuredClone(data); empty.capacity = { total: 0, reserved: 0, available: 0, inProcess: 0, expired: 0 };
  assert.match(render(empty), /dashboard-segment is-empty/);
});
test('HU037 rankings show demand, no-show rate and waitlist without personal data', () => {
  const html = render(dashboard().data);
  assert.match(html, /<th scope="row">Kinesiología<\/th>/); assert.match(html, /33,3 %/); assert.match(html, /<th scope="col">En espera<\/th>/);
  assert.match(html, /<th scope="row">Ana Pérez<\/th>/); assert.match(html, /Estándar<\/span><strong>5<\/strong>/);
  assert.doesNotMatch(html, /email|token|rut|password/i);
});
test('HU037 filters, presets and states are accessible; branch context cannot be widened', () => {
  const model = createDashboardModel({ request: async () => { throw new Error(); } }, profile, () => new Date(2026, 10, 24));
  const view = patch => renderToStaticMarkup(createElement(DashboardView, { model, state: { ...model.getSnapshot(), ...patch } }));
  const idle = view({});
  assert.match(idle, /aria-pressed="true">Últimos 30 días/); assert.match(idle, /value="2026-10-26"/);
  assert.match(idle, /name="serviceId"/); assert.match(idle, /name="branchId"/); assert.doesNotMatch(idle, /name="institutionId"|name="userId"/);
  assert.match(view({ status: 'loading' }), /type="submit" disabled="">Actualizando/);
  assert.match(view({ status: 'error', error: 'Error controlado' }), /role="alert">Error controlado/);
  assert.doesNotMatch(view({ status: 'denied' }), /<form|<input/);
  model.dispose();
  const fixed = createDashboardModel({ request: async () => {} }, { ...profile, context: { ...profile.context, branchId: branch.id } });
  const html = renderToStaticMarkup(createElement(DashboardView, { model: fixed, state: fixed.getSnapshot() }));
  assert.match(html, /Sede del contexto \(fija\)/); assert.doesNotMatch(html, /name="branchId"/); fixed.dispose();
});
