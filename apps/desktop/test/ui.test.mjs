import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import { createAuthSession } from '@citajusta/client-core';
import { createMemorySessionStorage } from '../src/auth/memory-session-storage.ts';
import { branch, service, category, profile } from './fixtures/catalog.mjs';
import { professional, account, profile as professionalProfile } from './fixtures/professionals.mjs';

// Render de componentes reales; no sustituye la prueba interactiva de la ventana nativa.
const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom' });
after(() => vite.close());
const { default: App } = await vite.ssrLoadModule('/src/App.tsx');
const { SessionProvider } = await vite.ssrLoadModule('/src/auth/auth-provider.tsx');
const { CatalogView } = await vite.ssrLoadModule('/src/catalog/catalog-page.tsx');
const { BranchForm, ServiceForm, branchPayload, servicePayload, changedFields } = await vite.ssrLoadModule('/src/catalog/catalog-forms.tsx');
const { createCatalogModel } = await vite.ssrLoadModule('/src/catalog/catalog-model.ts');
const { ProfessionalView, ProfessionalPage } = await vite.ssrLoadModule('/src/professionals/professional-page.tsx');
const { ProfessionalForm, professionalPayload } = await vite.ssrLoadModule('/src/professionals/professional-forms.tsx');
const { createProfessionalModel } = await vite.ssrLoadModule('/src/professionals/professional-model.ts');

test('HU-030 professional view renders identity/status/associations and permission-controlled actions', () => {
  const model = createProfessionalModel({}, professionalProfile);
  const state = { ...model.getSnapshot(), status: 'ready', catalogStatus: 'ready', items: [professional], branches: [branch], services: [service] };
  const render = (m = model, s = state) => renderToStaticMarkup(createElement(ProfessionalView, { model: m, state: s }));
  for (const word of ['Ana Profesional', account.email, 'PRO-1', branch.name, service.name, 'Crear profesional', 'Editar profesional']) assert.ok(render().includes(word), word);
  for (const [status, label] of [['ACTIVE', 'Activo'], ['INACTIVE', 'Inactivo'], ['SUSPENDED', 'Suspendido']]) assert.ok(render(model, { ...state, items: [{ ...professional, status }] }).includes(label));
  const readOnly = createProfessionalModel({}, { ...professionalProfile, permissions: ['professionals.read'] });
  assert.doesNotMatch(render(readOnly), /Crear profesional|Editar profesional/);
  for (const [status, message] of [['denied', /Acceso no disponible/], ['loading', /Cargando profesionales/], ['error', /Error controlado/], ['ready', /No hay profesionales/]]) {
    assert.match(render(model, { ...state, status, items: [], error: 'Error controlado' }), message);
  }
});
test('HU-030 forms keep identity readonly, preserve unchanged inactive associations and build minimal PATCH', () => {
  const props = { item: professional, eligible: null, branches: [branch], services: [service], busy: false, save: async () => true, close() {} };
  const html = renderToStaticMarkup(createElement(ProfessionalForm, props));
  assert.match(html, /Cuenta vinculada/); assert.ok(html.includes(account.email));
  assert.doesNotMatch(html, /name="(?:userId|institutionId|password|email|roles)"/);
  assert.match(html, /Hay asociaciones inactivas/);
  for (const value of ['ACTIVE', 'INACTIVE', 'SUSPENDED']) assert.ok(html.includes(`value="${value}"`));
  const data = new FormData(); data.set('status', 'INACTIVE'); data.set('internalCode', professional.internalCode); data.set('titleOrFunction', professional.titleOrFunction);
  data.set('userId', 'foreign'); data.set('institutionId', 'foreign');
  assert.deepEqual(professionalPayload(data, professional.branchIds, professional.serviceIds, professional), { status: 'INACTIVE' });
  assert.deepEqual(professionalPayload(data, [], [], professional), { status: 'INACTIVE', branchIds: [], serviceIds: [] });
  assert.throws(() => professionalPayload(data, [], []));
  const create = professionalPayload(data, [branch.id], [service.id]); assert.equal(create.userId, undefined); assert.equal(create.institutionId, undefined);
  const disabled = renderToStaticMarkup(createElement(ProfessionalForm, { ...props, item: undefined, eligible: null }));
  assert.match(disabled, /Busca y selecciona una cuenta elegible/); assert.match(disabled, /disabled/);
});

test('catalog renders real fields, inactive badges and actions based on explicit permissions', () => {
  const model = createCatalogModel({}, profile);
  const state = { branches: { status: 'ready', items: [branch] }, services: { status: 'ready', items: [service] }, categories: [category], busy: false, feedback: '', failed: false };
  const render = m => renderToStaticMarkup(createElement(CatalogView, { model: m, state }));
  const html = render(model);
  for (const value of ['Sede centro', 'CENTRO', 'Calle principal', 'contact@example.invalid', 'Atención', '30 minutos', 'General', 'Inactivo', 'Crear sede', 'Crear servicio', 'Editar', 'Activar']) assert.ok(html.includes(value), value);
  const readOnly = createCatalogModel({}, { ...profile, permissions: ['branches.read', 'services.read'] });
  assert.doesNotMatch(render(readOnly), /Crear sede|Crear servicio|>Editar<|>Activar</);
  for (const status of ['loading', 'error', 'denied', 'ready']) {
    const empty = { ...state, branches: { status, items: [], error: 'Error controlado' }, services: { status, items: [], error: 'Error controlado' } };
    const markup = renderToStaticMarkup(createElement(CatalogView, { model, state: empty }));
    assert.match(markup, { loading: /Cargando catálogo/, error: /Error controlado.*Reintentar/s, denied: /Acceso no disponible/, ready: /No hay registros/ }[status]);
  }
});

test('branch/service forms expose exact domain fields with accessible labels and numeric validation', () => {
  const props = { busy: false, save: async () => true, close() {} };
  const branchHtml = renderToStaticMarkup(createElement(BranchForm, { ...props, item: branch }));
  for (const name of ['code', 'name', 'addressLine1', 'addressLine2', 'municipality', 'region', 'country', 'latitude', 'longitude', 'phone', 'email', 'status']) assert.ok(branchHtml.includes(`name="${name}"`));
  assert.match(branchHtml, /type="email"/);
  assert.match(branchHtml, /step="0.0000001"/);
  const serviceHtml = renderToStaticMarkup(createElement(ServiceForm, { ...props, item: service, branches: [branch], categories: [category], canSelectBranches: true }));
  for (const name of ['code', 'name', 'description', 'categoryId', 'durationMinutes', 'minimumAdvanceMinutes', 'maximumAdvanceDays', 'allowsWaitlist', 'requiresConfirmation', 'active', 'branchIds']) assert.ok(serviceHtml.includes(`name="${name}"`));
  assert.match(serviceHtml, /General/);
  assert.match(serviceHtml, /Sedes asociadas/);
  assert.doesNotMatch(branchHtml + serviceHtml, /name="institutionId"/);
  const data = new FormData();
  for (const [k, v] of Object.entries({ code: 'CODE', name: 'Nombre', durationMinutes: '30', minimumAdvanceMinutes: '0', institutionId: 'foreign' })) data.set(k, v);
  assert.equal(branchPayload(data).institutionId, undefined);
  const input = servicePayload(data, true);
  assert.equal(input.institutionId, undefined);
  assert.deepEqual(input.branchIds, []);
  assert.equal(input.maximumAdvanceDays, null);
  assert.equal(servicePayload(data, false).branchIds, undefined);
  data.set('durationMinutes', '1.5'); assert.throws(() => servicePayload(data, true));
  data.set('durationMinutes', '30'); data.set('minimumAdvanceMinutes', '1441'); data.set('maximumAdvanceDays', '1');
  assert.throws(() => servicePayload(data, true));
  assert.deepEqual(changedFields({ name: 'Nuevo', categoryId: service.categoryId, branchIds: service.branchIds }, service), { name: 'Nuevo' });
  assert.deepEqual(changedFields({ latitude: Number(branch.latitude), phone: null }, branch), { phone: null });
  data.set('code', ' ');
  assert.throws(() => branchPayload(data));
});

test('login/shell/logout renderizan sólo el estado y perfil reales, sin tokens ni permisos inventados', async () => {
  const profile = { id: 'controlled', firstName: 'Ana', lastName: 'Prueba', email: 'controlled@example.invalid', status: 'ACTIVE', context: {}, roles: [], permissions: [] };
  const publicApi = { request: async path => path === 'auth/login'
    ? { accessToken: 'secret-access-test', refreshToken: 'secret-refresh-test', tokenType: 'Bearer' }
    : undefined };
  const session = createAuthSession({ publicApi, authenticatedApi: () => ({ request: async () => ({ data: profile }) }), storage: createMemorySessionStorage() });
  const render = () => renderToStaticMarkup(createElement(SessionProvider, { session }, createElement(App)));
  const professionalRoute = () => renderToStaticMarkup(createElement(SessionProvider, { session }, createElement(ProfessionalPage)));
  assert.match(professionalRoute(), /Se requiere una sesión verificada/);
  assert.match(render(), /Verificando sesión/);
  assert.doesNotMatch(render(), /Módulos institucionales/);
  await session.restore();
  const login = render();
  assert.match(login, /type="email"/);
  assert.match(login, /type="password"/);
  assert.match(login, /Iniciar sesión/);
  assert.doesNotMatch(login, /Módulos institucionales/);
  await session.login({ email: profile.email, password: 'test-only-password' });
  const shell = render();
  assert.match(shell, /Ana Prueba/);
  assert.match(shell, /controlled@example.invalid/);
  assert.match(shell, /Sin contexto institucional/);
  assert.match(shell, /Sin sede asignada/);
  assert.match(shell, /Sin roles asignados/);
  assert.match(shell, /Módulos institucionales/);
  assert.match(shell, /Cerrar sesión/);
  assert.doesNotMatch(shell, /secret-access-test|secret-refresh-test|test-only-password/);
  const logout = session.logout();
  assert.match(render(), /Iniciar sesión/);
  assert.doesNotMatch(render(), /controlled@example.invalid|Módulos institucionales/);
  await logout;
});
