import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import { createAuthSession } from '@citajusta/client-core';
import { createMemorySessionStorage } from '../src/auth/memory-session-storage.ts';
import { createAttendanceModel } from '../src/attendance/attendance-model.ts';
import { profile as reader, appointment, branch, institutionId } from './fixtures/agenda.mjs';
const profile = { ...reader, permissions: ['agenda.read', 'appointments.attendance'] };
const vite = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom' });
after(() => vite.close());
const { AttendanceView, AttendancePage } = await vite.ssrLoadModule('/src/attendance/attendance-page.tsx');
const { SessionProvider } = await vite.ssrLoadModule('/src/auth/auth-provider.tsx');
const render = (model, state = model.getSnapshot()) => renderToStaticMarkup(createElement(AttendanceView, { model, state }));
const ready = model => ({ ...model.getSnapshot(), agenda: { ...model.getSnapshot().agenda, status: 'ready', catalogStatus: 'ready', zoneStatus: 'ready', timeZone: 'America/Bogota', items: [appointment] } });

test('HU033 UI accessible date/filters, fixed contextual branch, no identity inputs', () => {
  const model = createAttendanceModel({}, { ...profile, context: { institutionId, branchId: branch.id } }); const html = render(model);
  assert.match(html, /type="date" required/); assert.match(html, /<select name="branchId" disabled/);
  for (const name of ['date','branchId','serviceId','professionalId','status']) assert.ok(html.includes(`name="${name}"`));
  assert.match(html, /Selecciona una fecha/); assert.doesNotMatch(html, /name="userId"|name="actor"|name="institutionId"/); model.dispose();
});
test('HU033 UI denied/read-only/eligible obey explicit permissions', () => {
  const denied = createAttendanceModel({}, { ...profile, permissions: ['appointments.attendance'] }); const deniedHtml = render(denied);
  assert.match(deniedHtml, /agenda.read/); assert.doesNotMatch(deniedHtml, /<form|Registrar atendida|Registrar inasistencia/);
  const read = createAttendanceModel({}, reader), readHtml = render(read, ready(read));
  assert.match(readHtml, /Modo de sólo lectura/); assert.match(readHtml, /Usuario Atendido/); assert.doesNotMatch(readHtml, /Registrar atendida|Registrar inasistencia/);
  const full = createAttendanceModel({}, profile), html = render(full, ready(full));
  assert.match(html, /Registrar atendida/); assert.match(html, /Registrar inasistencia/);
  for (const model of [denied, read, full]) model.dispose();
});
test('HU033 UI final/cancelled/unknown states never offer transitions', () => {
  const model = createAttendanceModel({}, profile);
  for (const code of ['ATENDIDA','INASISTENCIA','CANCELADA','OTHER_FINAL']) {
    const state = ready(model); state.agenda.items = [{ ...appointment, status: { code, name: code } }];
    const html = render(model, state); assert.match(html, new RegExp(code)); assert.doesNotMatch(html, /Registrar atendida|Registrar inasistencia/);
  }
  model.dispose();
});
test('HU033 UI loading, empty, error, success and explicit institutional timezone without device conversion', () => {
  const model = createAttendanceModel({}, profile), state = ready(model);
  assert.match(render(model, { ...state, agenda: { ...state.agenda, status: 'loading', items: [] } }), /Cargando citas/);
  assert.match(render(model, { ...state, agenda: { ...state.agenda, items: [] } }), /No hay citas/);
  assert.match(render(model, { ...state, agenda: { ...state.agenda, status: 'error', error: 'Error controlado' } }), /role="alert">Error controlado/);
  const html = render(model, state);
  for (const value of ['08:00','08:30','America/Bogota', appointment.service.name, branch.name, 'Persona Profesional', 'Usuario Atendido', 'AGENDADA']) assert.ok(html.includes(value), value);
  assert.doesNotMatch(html, new RegExp(appointment.id));
  const fallback = render(model, { ...state, agenda: { ...state.agenda, timeZone: null, zoneStatus: 'error' } });
  assert.match(fallback, /UTC/); assert.match(fallback, /13:00/); assert.match(fallback, /Reintentar catálogos/); model.dispose();
});
test('HU033 UI disables double actions/filters while busy and separates success from failure feedback', () => {
  const model = createAttendanceModel({}, profile), state = ready(model);
  const busy = render(model, { ...state, busyId: appointment.id });
  assert.match(busy, /Guardando resultado/); assert.match(busy, /<fieldset disabled/);
  assert.match(busy, /<button type="button" disabled="">Registrar atendida/); assert.match(busy, /<button type="button" disabled="">Registrar inasistencia/);
  assert.match(render(model, { ...state, failed: true, feedback: 'Vuelve a consultar' }), /role="alert">Vuelve a consultar/);
  assert.match(render(model, { ...state, feedback: 'Asistencia registrada.' }), /role="status">Asistencia registrada/); model.dispose();
});
test('HU033 Page requires verified session and renders the real attendance module after login', async () => {
  const session = createAuthSession({ publicApi: { request: async () => ({ accessToken: 'test-access', refreshToken: 'test-refresh', tokenType: 'Bearer' }) },
    authenticatedApi: () => ({ request: async () => ({ data: profile }) }), storage: createMemorySessionStorage() });
  const page = () => renderToStaticMarkup(createElement(SessionProvider, { session }, createElement(AttendancePage)));
  assert.match(page(), /sesión verificada/); await session.restore(); await session.login({ email: profile.email, password: 'test-only' });
  assert.match(page(), /Registro de asistencia institucional/); assert.match(page(), /Consultar citas/); assert.doesNotMatch(page(), /En preparación|test-access|test-refresh/);
});
