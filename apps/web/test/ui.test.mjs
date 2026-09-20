import assert from 'node:assert/strict';
import { open } from 'node:fs/promises';
import { after, test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { createServer } from 'vite';

// Renderiza los componentes reales; no sustituye las pruebas de interacción en navegador.
// El servidor middleware de estas pruebas no realiza llamadas a la API.
const previousProxy = process.env.API_PROXY_TARGET;
process.env.API_PROXY_TARGET = 'http://localhost:3000';
const vite = await createServer({
  server: { middlewareMode: true },
  appType: 'custom',
});
if (previousProxy === undefined) delete process.env.API_PROXY_TARGET;
else process.env.API_PROXY_TARGET = previousProxy;

after(() => vite.close());

const { AppRoutes } = await vite.ssrLoadModule('/src/routes/app-routes.tsx');
const { OfferCard } = await vite.ssrLoadModule('/src/features/offers/offers-page.tsx');
const { AsyncState } = await vite.ssrLoadModule(
  '/src/components/ui/async-state.tsx',
);
const { AuthProvider } = await vite.ssrLoadModule(
  '/src/features/auth/auth-provider.tsx',
);

const renderRoute = (path) =>
  renderToStaticMarkup(
    createElement(
      MemoryRouter,
      { initialEntries: [path] },
      createElement(
        AuthProvider,
        null,
        createElement(AppRoutes),
      ),
    ),
  );

test('ofertas exige sesión y nunca muestra datos o acciones sin verificarla', () => {
  const html = renderRoute('/ofertas');
  assert.match(html, /Verificando tu sesión/);
  assert.doesNotMatch(html, /Aceptar hora|Mis ofertas de atención|Esta página no está disponible/);
});

test('oferta vigente renderiza datos reales y acciones; vencida mantiene estado sin acciones habilitadas', () => {
  const offer = { id: '10000000-0000-4000-8000-000000000001', status: 'PENDING',
    startsAt: '2030-05-28T15:00:00Z', endsAt: '2030-05-28T15:30:00Z', expiresAt: '2030-05-27T13:07:00Z',
    createdAt: '2030-05-27T13:00:00Z', respondedAt: null,
    service: { name: 'Orientación' }, branch: { name: 'Centro' }, professional: { firstNames: 'Ana', lastNames: 'Pérez' } };
  const render = (now, busy = false) => renderToStaticMarkup(createElement(OfferCard, { offer, now, busy, onRespond() {} }));
  const active = render(Date.parse('2030-05-27T13:01:00Z'));
  for (const text of ['Orientación', 'Centro', 'Ana Pérez']) assert.ok(active.includes(text));
  assert.match(active, /Aceptar hora/); assert.match(active, /No puedo asistir/);
  assert.doesNotMatch(active, /disabled/);
  assert.match(active, /datetime="2030-05-27T13:07:00Z"/i);
  assert.equal((render(Date.parse(offer.expiresAt)).match(/disabled/g) ?? []).length, 2);
  assert.match(render(Date.parse(offer.expiresAt)), /estado registrado sigue pendiente/);
  assert.equal((render(Date.parse(offer.createdAt), true).match(/disabled/g) ?? []).length, 2);
  assert.equal(offer.status, 'PENDING');
});

test('estados finales de ofertas tienen etiquetas y no permiten aceptar/rechazar', () => {
  for (const [status, label] of Object.entries({ ACCEPTED: 'Aceptada', REJECTED: 'Rechazada', EXPIRED: 'Vencida', INVALIDATED: 'Invalidada', CANCELLED: 'Cancelada' })) {
    const offer = { id: '1', status, startsAt: '2030-05-28T15:00:00Z', endsAt: '2030-05-28T15:30:00Z', expiresAt: '2030-05-27T13:07:00Z',
      respondedAt: null, service: { name: 'Atención' }, branch: { name: 'Centro' }, professional: { firstNames: 'Ana', lastNames: 'Pérez' } };
    const html = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(OfferCard, { offer, now: 0, busy: false, onRespond() {} })));
    assert.match(html, new RegExp(label)); assert.doesNotMatch(html, /Aceptar hora|No puedo asistir/);
    if (status === 'ACCEPTED') assert.match(html, /href="\/mis-citas"/);
  }
});

test('lista de espera exige verificar sesión antes de mostrar datos o formularios', () => {
  const html = renderRoute('/lista-de-espera');
  assert.match(html, /Verificando tu sesión/);
  assert.doesNotMatch(html, /Ingresar a una lista de espera|Tus solicitudes abiertas|Esta página no está disponible/);
});

test('Inicio enlaza al flujo de waitlist y conserva notificaciones como funcionalidad futura', () => {
  const html = renderRoute('/');
  assert.match(html, /href="\/lista-de-espera"/);
  assert.match(html, /Ver mi lista de espera/);
  assert.match(html, /Próximamente/);
  assert.doesNotMatch(html, /Podrás indicar tus preferencias/);
});

test('Inicio renderiza el shell, buscador accesible y cuatro tarjetas', () => {
  const html = renderRoute('/');

  assert.equal((html.match(/<main\b/g) ?? []).length, 1);
  assert.equal((html.match(/<h1\b/g) ?? []).length, 1);

  for (const label of ['Servicio o atención', 'Sede o sucursal']) {
    assert.ok(html.includes(label), `Debe mostrar ${label}`);
  }

  for (const heading of [
    'Mis citas',
    'Lista de espera',
    'Notificaciones',
    '¿Cómo funciona?',
  ]) {
    assert.ok(html.includes(heading), `Debe mostrar ${heading}`);
  }

  assert.match(html, /Saltar al contenido/);
  assert.match(html, /<footer\b/);
  assert.doesNotMatch(html, /12\.000|Confirmada|Espera Activa|demostración|de ejemplo|sin sesión real|Vista previa|Camila López/);
  const navigation = html.match(/<nav\b[^>]*>[\s\S]*?<\/nav>/)?.[0];
  assert.ok(navigation);
  assert.match(navigation, /Inicio/);
  assert.match(navigation, /Iniciar sesión/);
  assert.match(navigation, /Crear cuenta/);
  assert.doesNotMatch(navigation, /Mis citas|Lista de espera|Notificaciones|Cerrar sesión/);
});

test(
  'Inicio presenta una plataforma transversal de citas sin terminología médica',
  () => {
    const html = renderRoute('/');

    for (const label of [
  'Servicio o atención',
  'Sede o sucursal',
  'Lista de espera',
  'Notificaciones',
  'Para personas usuarias',
]) {
      assert.ok(html.includes(label), `Debe mostrar ${label}`);
    }

    assert.ok(
      html.includes(
        'CitaJusta conecta a las personas con instituciones, empresas y profesionales que gestionan atenciones mediante citas.',
      ),
    );

    assert.doesNotMatch(
      html,
      /pacient|m[eé]dic|cl[ií]nic|especialidad|dermatolog|cardiolog|traumatolog|\bDra\.|\bsalud\b|lucide-stethoscope/iu,
    );
  },
);

test(
  'header y footer usan el logo oficial con proporciones y nombre accesibles',
  async () => {
    const html = renderRoute('/');

    const logos =
      html.match(
        /<img\b[^>]*src="\/images\/logo-citajusta\.png"[^>]*>/g,
      ) ?? [];

    assert.equal(logos.length, 2);

    for (const logo of logos) {
      assert.match(logo, /\balt="CitaJusta"/);
      assert.match(logo, /\bwidth="2000"/);
      assert.match(logo, /\bheight="2000"/);
    }

    const homeLinks =
      html.match(
        /<a\b(?=[^>]*href="\/")(?=[^>]*aria-label="CitaJusta, inicio")[^>]*>/g,
      ) ?? [];

    assert.equal(homeLinks.length, 2);

    const file = await open(
      new URL('../public/images/logo-citajusta.png', import.meta.url),
    );

    try {
      const header = Buffer.alloc(24);
      const { bytesRead } = await file.read(
        header,
        0,
        header.length,
        0,
      );

      assert.equal(bytesRead, header.length);

      assert.deepEqual(
        header.subarray(0, 8),
        Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      );

      assert.equal(header.toString('ascii', 12, 16), 'IHDR');
      assert.equal(header.readUInt32BE(16), 2000);
      assert.equal(header.readUInt32BE(20), 2000);
    } finally {
      await file.close();
    }
  },
);

test(
  'rutas futuras y desconocidas no simulan pantallas funcionales',
  () => {
    for (const path of [
      '/buscar',
      '/sin-horas',
      '/con-horas',
      '/desconocida',
    ]) {
      const html = renderRoute(path);

      assert.match(html, /Esta página no está disponible/);
      assert.match(html, /Volver al inicio/);
      assert.doesNotMatch(html, /Camila López/);
    }
  },
);

test(
  'estados loading/error/empty tienen semántica accesible y error sin datos internos',
  () => {
    const loading = renderToStaticMarkup(
      createElement(AsyncState, {
        kind: 'loading',
        title: 'Cargando',
      }),
    );

    assert.match(loading, /role="status"/);
    assert.match(loading, /aria-busy="true"/);

    const error = renderToStaticMarkup(
      createElement(AsyncState, {
        kind: 'error',
        title: 'No se pudo cargar',
        onRetry: () => {},
      }),
    );

    assert.match(error, /role="alert"/);
    assert.match(error, /Reintentar/);

    const empty = renderToStaticMarkup(
      createElement(AsyncState, {
        kind: 'empty',
        title: 'Sin resultados',
      }),
    );

    assert.match(empty, /role="status"/);
  },
);
