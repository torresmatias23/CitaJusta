import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

const vite = await createServer({ configFile: false, server: { middlewareMode: true }, appType: 'custom', esbuild: { jsx: 'automatic' } });
after(() => vite.close());
const { BranchLocationPanel } = await vite.ssrLoadModule('/src/features/locations/branch-location-panel.tsx');
const { SelectedBranchLocation } = await vite.ssrLoadModule('/src/features/home/search-form.tsx');
const empty = { id: 'branch', institutionId: 'institution', name: 'Sede Centro', addressLine1: null, addressLine2: null,
  municipality: null, region: null, country: null, latitude: null, longitude: null };
const branch = { ...empty, latitude: -33.45, longitude: -70.66 };
const render = (props) => renderToStaticMarkup(createElement(BranchLocationPanel, props));
test('location collapsed by default avoids iframe requests; selected branch only', () => {
  assert.doesNotMatch(render({ branch }), /<iframe/); assert.match(render({ branch }), /aria-expanded="false"/);
  assert.equal(renderToStaticMarkup(createElement(SelectedBranchLocation, { branches: [branch], branchId: 'other' })), '');
  assert.match(renderToStaticMarkup(createElement(SelectedBranchLocation, { branches: [branch], branchId: branch.id })), /Ubicación de Sede Centro/);
});
test('expanded map is responsive, titled/lazy, attributed and routes use safe new tab', () => {
  const html = render({ branch, initiallyExpanded: true });
  assert.match(html, /<iframe.*title="Mapa de ubicación de Sede Centro".*loading="lazy"/);
  assert.match(html, /w-full/); assert.match(html, /OpenStreetMap contributors/);
  assert.match(html, /noopener noreferrer/); assert.match(html, /Cómo llegar \(Google Maps\)/);
  assert.doesNotMatch(html, /geolocation|origin=/);
});
test('specific address without coordinates has directions but no map; country alone has neither', () => {
  const address = render({ branch: { ...empty, addressLine1: 'Calle Centro 123', municipality: 'Santiago', country: 'Chile' }, initiallyExpanded: true });
  assert.doesNotMatch(address, /<iframe/); assert.match(address, /Cómo llegar/); assert.match(address, /verifica el resultado/);
  const missing = render({ branch: { ...empty, country: 'Chile' }, initiallyExpanded: true });
  assert.doesNotMatch(missing, /<iframe|maps\/dir/); assert.match(missing, /No hay información suficientemente específica/);
});
