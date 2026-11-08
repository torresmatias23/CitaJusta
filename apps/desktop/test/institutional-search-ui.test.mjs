import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import { createAuthSession } from '@citajusta/client-core';
import { createMemorySessionStorage } from '../src/auth/memory-session-storage.ts';
import { createInstitutionalSearchModel } from '../src/institutional-search/institutional-search-model.ts';
import { parseInstitutionalSearchPage } from '../src/institutional-search/institutional-search-api.ts';
import { profile, branch, userId, entryId, person, waiting, page } from './fixtures/institutional-search.mjs';

const vite = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom' });
after(() => vite.close());
const { InstitutionalSearchView, InstitutionalSearchCard, InstitutionalSearchPage } = await vite.ssrLoadModule('/src/institutional-search/institutional-search-page.tsx');
const { SessionProvider } = await vite.ssrLoadModule('/src/auth/auth-provider.tsx');
const { InstitutionalNavigation } = await vite.ssrLoadModule('/src/components/institutional-navigation.tsx');
const render = (component, props) => renderToStaticMarkup(createElement(component, props));
function view(resource, patch = {}, user = profile) {
  const model = createInstitutionalSearchModel(resource, { request: async () => page(resource) }, user);
  const html = render(InstitutionalSearchView, { model, state: { ...model.getSnapshot(), ...patch } }); model.dispose(); return html;
}

for (const resource of ['users', 'waitlist']) {
  const label = resource === 'users' ? 'Usuarios' : 'Lista de espera';
  const permission = resource === 'users' ? 'users.read' : 'waitlist.read';
  const row = resource === 'users' ? person() : waiting();

  test(`${resource}: navigation selects exactly one real section and App wires the correct resource`, async () => {
    const html = render(InstitutionalNavigation, { selected: label, onSelect() {} });
    assert.ok(html.includes(`<span>${label}</span>`)); assert.equal((html.match(/aria-pressed="true"/g) ?? []).length, 1);
    const source = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');
    assert.ok(source.includes(`selected === '${label}' ? <InstitutionalSearchPage resource="${resource}" />`));
  });

  test(`${resource}: accessible optional filters match the API; fixed branch has no editable scope input`, () => {
    const html = view(resource, { catalogStatus: 'ready', branches: [branch] });
    for (const key of resource === 'users' ? ['q', 'branchId'] : ['status', 'serviceId', 'userId', 'branchId']) {
      assert.ok(html.includes(`name="${key}"`)); assert.match(html, /<label/);
    }
    assert.doesNotMatch(html, /name="institutionId"|name="actorUserId"|name="limit"|name="cursor"|name="offset"|required=""/);
    assert.match(html, /Páginas de hasta 50/);
    const fixed = view(resource, {}, { ...profile, context: { ...profile.context, branchId: branch.id } });
    assert.match(fixed, /Sede del contexto \(fija\)/); assert.ok(fixed.includes(branch.id)); assert.doesNotMatch(fixed, /name="branchId"/);
    if (resource === 'users') { assert.match(html, /minLength="2"/); assert.match(html, /maxLength="120"/); }
    else { assert.match(html, /maxLength="60"/); assert.match(html, /no cambia la identidad autenticada/); }
  });

  test(`${resource}: denied has no controls/data; idle, loading, errors and empty results are explicit`, () => {
    const denied = view(resource, { status: 'denied', data: [row] });
    assert.ok(denied.includes(permission)); assert.doesNotMatch(denied, /<form|<input|<article/);
    assert.match(view(resource), /Aplica los filtros opcionales/);
    assert.match(view(resource, { status: 'loading' }), /Cargando registros/);
    assert.match(view(resource, { status: 'loading' }), /type="submit"[^>]*disabled=""/);
    assert.match(view(resource, { status: 'error', error: 'Error controlado' }), /role="alert">Error controlado/);
    assert.match(view(resource, { status: 'ready', data: [] }), /No se encontraron registros/);
    assert.doesNotMatch(view(resource, { status: 'ready', data: [] }), /Cargar más/);
    assert.match(view(resource, { catalogStatus: 'error' }), /No se pudieron cargar las sedes/);
  });

  test(`${resource}: pagination affordances preserve rows and expose safe retry without leaking the cursor`, () => {
    const html = view(resource, { status: 'ready', data: [row], nextCursor: 'PRIVATE_CURSOR', moreError: 'Error controlado' });
    assert.match(html, /Cargar más/); assert.match(html, /Los registros ya consultados se conservan/); assert.ok(html.includes(row.id));
    assert.doesNotMatch(html, /PRIVATE_CURSOR/);
    const busy = view(resource, { status: 'ready', data: [row], nextCursor: 'next', loadingMore: true });
    assert.match(busy, /Cargando más registros/); assert.match(busy, /type="button"[^>]*disabled=""/);
    assert.doesNotMatch(view(resource, { status: 'ready', data: [row] }), /Cargar más/);
  });

  test(`${resource}: public DTO only, React escapes untrusted names; no mutation actions or private fields`, () => {
    const extra = { email: 'PRIVATE_EMAIL', phone: 'PRIVATE_PHONE', passwordHash: 'PRIVATE_HASH', token: 'PRIVATE_TOKEN', payload: 'PRIVATE_PAYLOAD', priorityId: 'PRIVATE_PRIORITY' };
    const malicious = resource === 'users' ? person({ firstNames: '<script>attack()</script>' }) : waiting({ user: { ...person({ firstNames: '<script>attack()</script>' }), ...extra }, status: { code: 'CUSTOM_FINAL', name: 'Estado histórico' } });
    const decoded = parseInstitutionalSearchPage(resource, page(resource, [{ ...malicious, ...extra }])).data[0];
    const html = render(InstitutionalSearchCard, { item: decoded });
    assert.match(html, /&lt;script&gt;attack\(\)&lt;\/script&gt;/); assert.doesNotMatch(html, /<script|PRIVATE_|<button|<form/);
    assert.ok(html.includes(userId));
    if (resource === 'waitlist') { assert.ok(html.includes(entryId)); assert.match(html, /CUSTOM_FINAL/); assert.match(html, /Ingreso \(UTC\)/); assert.match(html, /2026-11-01T12:30:00.000Z/); }
    assert.doesNotMatch(view(resource, { status: 'ready', data: [decoded] }), />Eliminar<|>Guardar<|>Editar<|>Aceptar<|>Rechazar</);
  });

  test(`${resource}: verified session required and current permission determines the mounted screen`, async () => {
    const session = createAuthSession({ publicApi: { request: async () => ({ accessToken: 'private-access', refreshToken: 'private-refresh', tokenType: 'Bearer' }) },
      authenticatedApi: () => ({ request: async () => ({ data: profile }) }), storage: createMemorySessionStorage() });
    const screen = () => renderToStaticMarkup(createElement(SessionProvider, { session }, createElement(InstitutionalSearchPage, { resource })));
    assert.match(screen(), /sesión verificada/); await session.restore(); await session.login({ email: profile.email, password: 'test-only' });
    assert.match(screen(), /Filtros de consulta institucional/); assert.doesNotMatch(screen(), /private-access|private-refresh|controlled@example/);
    const deniedSession = createAuthSession({ publicApi: { request: async () => ({ accessToken: 'unused', refreshToken: 'unused', tokenType: 'Bearer' }) },
      authenticatedApi: () => ({ request: async () => ({ data: { ...profile, permissions: [] } }) }), storage: createMemorySessionStorage() });
    await deniedSession.login({ email: profile.email, password: 'test-only' });
    const denied = renderToStaticMarkup(createElement(SessionProvider, { session: deniedSession }, createElement(InstitutionalSearchPage, { resource })));
    assert.ok(denied.includes(permission)); assert.doesNotMatch(denied, /<form/);
  });
}

test('waitlist branchless history is explicit, not invented cross-branch eligibility', () => {
  assert.match(render(InstitutionalSearchCard, { item: waiting({ branch: null }) }), /Sin sede asociada/);
});
