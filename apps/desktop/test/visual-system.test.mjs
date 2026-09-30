import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import { readFile } from 'node:fs/promises';

const server = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom' });
after(() => server.close());
const { InstitutionalNavigation } = await server.ssrLoadModule('/src/components/institutional-navigation.tsx');
const { InstitutionalHome } = await server.ssrLoadModule('/src/components/institutional-home.tsx');
const { StatusBadge } = await server.ssrLoadModule('/src/components/ui/status-badge.tsx');
const { InlineAlert } = await server.ssrLoadModule('/src/components/ui/inline-alert.tsx');
const render = (component, props) => renderToStaticMarkup(createElement(component, props));

test('HU034 marca Desktop reutiliza exactamente el PNG oficial de Web', async () => {
  const [desktop, web] = await Promise.all([
    readFile(new URL('../src/assets/logo-citajusta.png', import.meta.url)),
    readFile(new URL('../../web/public/images/logo-citajusta.png', import.meta.url)),
  ]);
  assert.deepEqual(desktop, web);
});

test('HU034 navegación agrupa módulos, selección única y módulos futuros explícitos', () => {
  const html = render(InstitutionalNavigation, { selected: 'Agenda', onSelect() {} });
  for (const label of ['Catálogo', 'Operación', 'Análisis', 'Sedes y servicios', 'Profesionales', 'Asistencia']) assert.ok(html.includes(label));
  assert.equal((html.match(/aria-pressed="true"/g) ?? []).length, 1);
  assert.match(html, /aria-pressed="true"><span>Agenda/);
  assert.equal((html.match(/En preparación/g) ?? []).length, 2);
});

test('HU034 Inicio usa perfil/contexto reales y sus cuatro accesos seleccionan módulos existentes', () => {
  const selected = [];
  const props = { firstName: 'Ana', hasContext: false, onSelect: module => selected.push(module) };
  const html = render(InstitutionalHome, props);
  assert.match(html, /bienvenida, Ana/); assert.match(html, /Selecciona tu contexto/);
  assert.match(render(InstitutionalHome, { ...props, hasContext: true }), /Contexto institucional seleccionado/);
  const tree = InstitutionalHome(props);
  const buttons = tree.props.children[1].props.children[1].props.children;
  for (const button of buttons) button.props.onClick();
  assert.deepEqual(selected, ['Sedes y servicios', 'Profesionales', 'Agenda', 'Asistencia']);
  assert.equal((html.match(/Abrir módulo/g) ?? []).length, 4);
});

test('HU034 estados tienen texto y tono; feedback distingue éxito/error sin ocultar el mensaje', () => {
  for (const [code, tone] of [['AGENDADA','info'], ['ATENDIDA','success'], ['ACTIVE','success'], ['INASISTENCIA','warning'], ['CANCELADA','danger'], ['INACTIVE','neutral'], ['OTHER','neutral']]) {
    const html = render(StatusBadge, { code, children: code });
    assert.match(html, new RegExp(`tone-${tone}`)); assert.ok(html.includes(`>${code}</span>`));
  }
  assert.match(render(InlineAlert, { children: 'Registro confirmado' }), /tone-success.*role="status">Registro confirmado/);
  assert.match(render(InlineAlert, { failed: true, children: 'Error controlado' }), /tone-danger.*role="alert">Error controlado/);
});
