import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import { createAuthSession } from '@citajusta/client-core';
import { createMemorySessionStorage } from '../src/auth/memory-session-storage.ts';
import { createAgendaModel } from '../src/agenda/agenda-model.ts';
import { profile, appointment, institutionId, branch } from './fixtures/agenda.mjs';

const vite = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom' });
after(() => vite.close());
const { AgendaView, AgendaPage } = await vite.ssrLoadModule('/src/agenda/agenda-page.tsx');
const { SessionProvider } = await vite.ssrLoadModule('/src/auth/auth-provider.tsx');
const render = (model, state = model.getSnapshot()) => renderToStaticMarkup(createElement(AgendaView, { model, state }));

test('agenda UI: filtros controlados completos, fecha requerida y status libre sin select cerrado', () => {
  const model = createAgendaModel({}, profile); const html = render(model);
  assert.match(html, /type="date" required/);
  for (const name of ['date', 'branchId', 'serviceId', 'professionalId', 'status']) assert.ok(html.includes(`name="${name}"`));
  assert.match(html, /Estado \(código exacto\)/); assert.match(html, /maxLength="60"/);
  assert.doesNotMatch(html, /<select name="status"|name="institutionId"|name="userId"|name="actor"/);
  assert.match(html, /Consultar agenda/); assert.match(html, /disabled/);
});

test('agenda UI: loading, empty, error, success con datos públicos y zona explícita', () => {
  const model = createAgendaModel({}, profile), base = { ...model.getSnapshot(), catalogStatus: 'ready', zoneStatus: 'ready', timeZone: 'America/Bogota' };
  assert.match(render(model, { ...base, status: 'loading' }), /Cargando agenda/);
  assert.match(render(model, { ...base, status: 'ready' }), /No hay citas/);
  assert.match(render(model, { ...base, status: 'error', error: 'Error controlado' }), /role="alert">Error controlado/);
  const html = render(model, { ...base, status: 'ready', items: [appointment] });
  for (const expected of ['08:00', '08:30', 'America/Bogota', 'Agendada (AGENDADA)', branch.name, appointment.service.name, 'Persona Profesional', 'Usuario Atendido', 'WEB']) assert.ok(html.includes(expected), expected);
  assert.doesNotMatch(html, new RegExp(appointment.id));
  assert.doesNotMatch(html, /Crear cita|Cancelar|Registrar asistencia|En preparación/);
  const fallback = render(model, { ...base, status: 'ready', timeZone: null, zoneStatus: 'error', items: [appointment] });
  assert.match(fallback, /UTC/); assert.match(fallback, /13:00/); assert.match(fallback, /Reintentar catálogos/);
});

test('agenda UI: sede contextual fija; sin permisos no expone formulario ni datos', () => {
  const model = createAgendaModel({}, { ...profile, context: { institutionId, branchId: branch.id } });
  const html = render(model); assert.match(html, /<select name="branchId" disabled/); assert.match(html, /Sede del contexto/);
  const denied = render(createAgendaModel({}, { ...profile, permissions: [] }));
  assert.match(denied, /agenda.read/); assert.doesNotMatch(denied, /<form|Consultar agenda/);
});

test('agenda Page exige sesión verificada y shell enlaza Agenda al módulo funcional', async () => {
  const session = createAuthSession({ publicApi: { request: async () => ({ accessToken: 'test-access', refreshToken: 'test-refresh', tokenType: 'Bearer' }) },
    authenticatedApi: () => ({ request: async () => ({ data: profile }) }), storage: createMemorySessionStorage() });
  const page = () => renderToStaticMarkup(createElement(SessionProvider, { session }, createElement(AgendaPage)));
  assert.match(page(), /sesión verificada/);
  await session.restore(); assert.match(page(), /sesión verificada/);
  await session.login({ email: profile.email, password: 'test-only' });
  assert.match(page(), /Consultar agenda/); assert.doesNotMatch(page(), /En preparación/);
  // Comprueba el cableado del shell, además del render real del módulo autenticado.
  const shell = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');
  assert.match(shell, /selected === 'Agenda' \? <AgendaPage \/>/);
});
