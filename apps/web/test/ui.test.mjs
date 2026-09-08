import assert from 'node:assert/strict';
import { open } from 'node:fs/promises';
import { after, test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { createServer } from 'vite';

// Renderiza los componentes reales; no sustituye las pruebas de interacción en navegador.
const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom' });
after(() => vite.close());
const { AppRoutes } = await vite.ssrLoadModule('/src/routes/app-routes.tsx');
const { AsyncState } = await vite.ssrLoadModule('/src/components/ui/async-state.tsx');
const renderRoute = (path) => renderToStaticMarkup(createElement(MemoryRouter, { initialEntries: [path] }, createElement(AppRoutes)));

test('Inicio renderiza el shell, buscador accesible y cuatro tarjetas sin peticiones API', () => {
  const html = renderRoute('/');
  assert.equal((html.match(/<main\b/g) ?? []).length, 1);
  assert.equal((html.match(/<h1\b/g) ?? []).length, 1);
  assert.match(html, /Vista de demostración/);
  assert.match(html, /sin sesión real/);
  for (const field of ['service', 'branch', 'preference']) {
    assert.match(html, new RegExp(`for="${field}"`));
    assert.match(html, new RegExp(`id="${field}"`));
  }
  for (const heading of ['Próxima cita', 'Estado de lista de espera', 'Notificaciones', '¿Cómo funciona?']) assert.ok(html.includes(heading));
  assert.match(html, /aria-expanded="false"/);
  assert.match(html, /Saltar al contenido/);
  assert.match(html, /<footer\b/);
  assert.doesNotMatch(html, /12\.000|Confirmada|Espera Activa/);
  assert.match(html, /<button[^>]*disabled=""[^>]*>Mis citas<\/button>/);
  assert.doesNotMatch(html, /href="\/(auth|appointments|notificaciones|lista-de-espera)/);
});

test('Inicio presenta una plataforma transversal de citas sin terminología médica', () => {
  const html = renderRoute('/');
  for (const label of ['Servicio o atención', 'Sede o sucursal', 'Mis citas', 'Lista de espera', 'Notificaciones', 'Para personas usuarias']) {
    assert.ok(html.includes(label), `Debe mostrar ${label}`);
  }
  assert.ok(html.includes('CitaJusta conecta a las personas con instituciones, empresas y profesionales que gestionan atenciones mediante citas.'));
  for (const example of ['Asesoría general', 'Atención al cliente', 'Orientación de trámites', 'Constanza Rojas', 'Sucursal Centro', 'Sede Norte', 'Oficina Central']) {
    assert.ok(html.includes(example), `Debe mostrar el ejemplo neutral ${example}`);
  }
  assert.doesNotMatch(html, /pacient|m[eé]dic|cl[ií]nic|especialidad|dermatolog|cardiolog|traumatolog|\bDra\.|\bsalud\b|lucide-stethoscope/iu);
});

test('header y footer usan el logo oficial con proporciones y nombre accesibles', async () => {
  const html = renderRoute('/');
  const logos = html.match(/<img\b[^>]*src="\/images\/logo-citajusta\.png"[^>]*>/g) ?? [];
  assert.equal(logos.length, 2);
  for (const logo of logos) {
    assert.match(logo, /\balt="CitaJusta"/);
    assert.match(logo, /\bwidth="2000"/);
    assert.match(logo, /\bheight="2000"/);
  }
  const homeLinks = html.match(/<a\b(?=[^>]*href="\/")(?=[^>]*aria-label="CitaJusta, inicio")[^>]*>/g) ?? [];
  assert.equal(homeLinks.length, 2);

  const file = await open(new URL('../public/images/logo-citajusta.png', import.meta.url));
  try {
    const header = Buffer.alloc(24);
    const { bytesRead } = await file.read(header, 0, header.length, 0);
    assert.equal(bytesRead, header.length);
    assert.deepEqual(header.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    assert.equal(header.toString('ascii', 12, 16), 'IHDR');
    assert.equal(header.readUInt32BE(16), 2000);
    assert.equal(header.readUInt32BE(20), 2000);
  } finally {
    await file.close();
  }
});

test('rutas futuras y desconocidas no simulan pantallas funcionales', () => {
  for (const path of ['/mis-citas', '/buscar', '/sin-horas', '/con-horas', '/desconocida']) {
    const html = renderRoute(path);
    assert.match(html, /Esta página no está disponible/);
    assert.match(html, /Volver al inicio/);
    assert.doesNotMatch(html, /Camila López/);
  }
});

test('estados loading/error/empty tienen semántica accesible y error sin datos internos', () => {
  const loading = renderToStaticMarkup(createElement(AsyncState, { kind: 'loading', title: 'Cargando' }));
  assert.match(loading, /role="status"/);
  assert.match(loading, /aria-busy="true"/);
  const error = renderToStaticMarkup(createElement(AsyncState, { kind: 'error', title: 'No se pudo cargar', onRetry: () => {} }));
  assert.match(error, /role="alert"/);
  assert.match(error, /Reintentar/);
  const empty = renderToStaticMarkup(createElement(AsyncState, { kind: 'empty', title: 'Sin resultados' }));
  assert.match(empty, /role="status"/);
});
