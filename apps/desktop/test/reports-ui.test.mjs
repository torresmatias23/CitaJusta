import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import { createReportsModel } from '../src/reports/reports-model.ts';
import { profile as base, branch } from './fixtures/agenda.mjs';
const vite = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom' });
after(() => vite.close());
const { ReportsSummary, ReportsView } = await vite.ssrLoadModule('/src/reports/reports-page.tsx');
const { InstitutionalNavigation } = await vite.ssrLoadModule('/src/components/institutional-navigation.tsx');
const data = { period: { from: '2026-09-01', to: '2026-09-30' }, appointments: { scheduled: 11, cancelled: 7, noShows: 3 },
  slots: { released: 5, recovered: 2, recoveryRatePct: 37.19 }, offers: { sent: 23, accepted: 2, rejected: 9, expired: 12 } };
const render = d => renderToStaticMarkup(createElement(ReportsSummary, { data: d }));
test('HU037 real navigation activates Reportes; Auditoría is also available', () => {
  const html = renderToStaticMarkup(createElement(InstitutionalNavigation, { selected: 'Reportes', onSelect() {} }));
  assert.match(html, /aria-pressed="true"><span>Reportes<\/span><\/button>/);
  assert.equal((html.match(/En preparación/g) ?? []).length, 0);
  assert.match(html, /<span>Auditoría<\/span><\/button>/);
});
test('HU037 ten cards render backend numbers/rate without invented series or trends', () => {
  const html = render(data);
  for (const label of ['Citas del período', 'Cancelaciones', 'Inasistencias', 'Cupos liberados', 'Cupos recuperados', 'Tasa de recuperación', 'Enviadas', 'Aceptadas', 'Rechazadas', 'Expiradas']) assert.ok(html.includes(label), label);
  assert.equal((html.match(/<dt>/g) ?? []).length, 10); assert.match(html, /37.19 %/); assert.doesNotMatch(html, /40 %/);
  assert.match(html, /2026-09-01/); assert.match(html, /incluye sus distintos estados/);
  assert.doesNotMatch(html, /<svg|<canvas|tendencia|período anterior|token|email/);
});
test('HU037 zero activity message retains all ten visible zero metrics', () => {
  const zeros = structuredClone(data); for (const key of ['appointments', 'slots', 'offers']) for (const name of Object.keys(zeros[key])) zeros[key][name] = 0;
  const html = render(zeros); assert.match(html, /No se registró actividad/); assert.equal((html.match(/<dd>0(?: %)?<\/dd>/g) ?? []).length, 10);
});
test('HU037 accessible filters, loading/error/denied and catalog fallback states', () => {
  const model = createReportsModel({ request: async () => { throw new Error(); } }, { ...base, permissions: ['reports.read'] });
  const view = patch => renderToStaticMarkup(createElement(ReportsView, { model, state: { ...model.getSnapshot(), ...patch } }));
  const idle = view({});
  for (const name of ['from', 'to']) {
    const input = idle.match(new RegExp('<input[^>]*name="' + name + '"[^>]*>'))?.[0];
    assert.ok(input); assert.match(input, /type="date"/); assert.match(input, /required=""/);
  }
  assert.match(idle, /name="serviceId"/); assert.match(idle, /name="professionalId"/);
  assert.doesNotMatch(idle, /name="institutionId"|name="userId"/);
  assert.match(view({ status: 'loading' }), /type="submit" disabled=""/);
  assert.match(view({ status: 'error', error: 'Error controlado' }), /role="alert">Error controlado/);
  assert.match(view({ catalogStatus: 'error' }), /Puedes consultar por período/);
  assert.doesNotMatch(view({ status: 'denied' }), /<form|<input/); model.dispose();
});
test('HU037 branch context rendered fixed with no selector to widen it', () => {
  const model = createReportsModel({ request: async () => {} }, { ...base, permissions: ['reports.read'], context: { ...base.context, branchId: branch.id } });
  const html = renderToStaticMarkup(createElement(ReportsView, { model, state: model.getSnapshot() }));
  assert.match(html, /Sede del contexto \(fija\)/); assert.doesNotMatch(html, /name="branchId"/); model.dispose();
});
