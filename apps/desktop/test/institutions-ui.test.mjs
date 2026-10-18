import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
const vite = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom' });
after(() => vite.close());
const { InstitutionsView, InstitutionForm } = await vite.ssrLoadModule('/src/institutions/institutions-page.tsx');
const { InstitutionalNavigation } = await vite.ssrLoadModule('/src/components/institutional-navigation.tsx');
const render = (component, props) => renderToStaticMarkup(createElement(component, props));
const state = { status: 'ready', items: [], permissions: { create: true, update: true }, busy: false, feedback: '', failed: false };
const model = { reload() {}, save() {} };
test('RF005 UI does not expose operations before server verification or without authorization', () => {
  for (const patch of [{ status: 'loading' }, { status: 'error' }, { permissions: { create: false, update: false } }]) {
    const html = render(InstitutionsView, { model, state: { ...state, ...patch } });
    assert.doesNotMatch(html, />Registrar institución<|>Editar institución</);
  }
  assert.match(render(InstitutionsView, { model, state }), />Registrar institución</);
});
test('RF005 separate global navigation is absent by default and preserves existing modules', () => {
  const props = { selected: 'Inicio', onSelect() {} };
  assert.doesNotMatch(render(InstitutionalNavigation, props), /Administración general/);
  assert.match(render(InstitutionalNavigation, { ...props, canRequestInstitutions: true }), /Administración general/);
});
test('RF005 accessible form only exposes allowed fields; edit has no state/zone/privilege inputs', () => {
  const props = { busy: false, save: async () => {}, cancel() {} };
  const create = render(InstitutionForm, props);
  for (const name of ['name','legalName','taxIdentifier','contactEmail','phone','timeZone']) assert.ok(create.includes(`name="${name}"`));
  const edit = render(InstitutionForm, { ...props, item: { name: 'A', timeZone: 'America/Santiago' } });
  assert.doesNotMatch(edit, /name="(?:timeZone|status|userId|roles|permissions|institutionId)"/);
  assert.match(edit, /primary-button/); assert.match(render(InstitutionForm, { ...props, busy: true }), /fieldset disabled/);
});
