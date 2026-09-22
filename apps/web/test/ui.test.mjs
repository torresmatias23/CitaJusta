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
const { SearchDateFields } = await vite.ssrLoadModule('/src/features/home/search-form.tsx');
const { initialSelection } = await vite.ssrLoadModule('/src/features/availability/search-selection.ts');
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

test('búsqueda flexible muestra ambas opciones y sólo el selector 7/14/30', () => {
  const html = renderToStaticMarkup(createElement(SearchDateFields, {
    selection: initialSelection, update() {}, disabled: false, now: new Date(2030, 5, 1, 12),
  }));
  assert.match(html, /<legend>¿Cuándo quieres tu atención\?<\/legend>/);
  assert.match(html, /Fecha específica/);
  assert.match(html, /Soy flexible/);
  assert.match(html, /checked="" value="flexible"/);
  for (const days of [7, 14, 30]) assert.ok(html.includes(`Próximos ${days} días`));
  assert.doesNotMatch(html, /type="date"/);
});

test('fecha específica muestra calendario requerido con mínimo local y errores accesibles', () => {
  const render = (date, disabled = false) => renderToStaticMarkup(createElement(SearchDateFields, {
    selection: { ...initialSelection, mode: 'specific', date }, update() {}, disabled, now: new Date(2030, 5, 1, 12),
  }));
  const html = render('2030-06-02');
  assert.match(html, /for="specific-date"/);
  assert.match(html, /type="date" required=""/);
  assert.match(html, /min="2030-06-01"/);
  assert.match(html, /aria-describedby="search-date-help"/);
  assert.doesNotMatch(html, /<select|aria-invalid="true"/);
  assert.match(render('2030-05-31'), /aria-invalid="true"/);
  assert.match(render('2030-05-31'), /Selecciona una fecha válida desde hoy/);
  assert.match(render('', true), /<fieldset[^>]*disabled=""/);
});

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

test('Inicio enlaza al flujo de waitlist y ofrece notificaciones mediante sesión real', () => {
  const html = renderRoute('/');
  assert.match(html, /href="\/lista-de-espera"/);
  assert.match(html, /Ver mi lista de espera/);
  assert.match(html, /Notificaciones/);
  assert.doesNotMatch(html, /Próximamente/);
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

// HU-024 shares the existing SSR server; no second HMR listener.
{
const h = createElement;
const { NotificationsView, NotificationCard, NotificationCount } = await vite.ssrLoadModule('/src/features/notifications/notifications-page.tsx');
const item = { id: '10000000-0000-4000-8000-000000000001', type: 'WAITLIST_ENTERED', title: 'Ingreso a lista de espera',
  message: 'Tu solicitud fue registrada.', createdAt: '2030-01-01T12:00:00Z', readAt: null, path: '/lista-de-espera' };
const state = { items: [item], status: 'ready', error: null, nextCursor: null, unreadCount: 1, countError: false, loadingMore: false, reading: [] };
const render = (element) => renderToStaticMarkup(h(MemoryRouter, null, element));
const view = (patch = {}) => render(h(NotificationsView, { state: { ...state, ...patch }, onLoad() {}, onRead() {} }));

test('notification route protects unverified session and anonymous Home has no center link', () => {
  const route = (path) => renderToStaticMarkup(h(MemoryRouter, { initialEntries: [path] }, h(AuthProvider, null, h(AppRoutes))));
  assert.match(route('/notificaciones'), /Verificando tu sesión/);
  assert.doesNotMatch(route('/notificaciones'), /Notificaciones propias|Marcar como leída/);
  assert.doesNotMatch(route('/'), /href="\/notificaciones"/);
});
test('badge hides 0/unknown and announces positive full count, capping only visual text', () => {
  for (const count of [0, null]) assert.equal(render(h(NotificationCount, { count })), '');
  assert.match(render(h(NotificationCount, { count: 3 })), /aria-label="3 notificaciones sin leer"/);
  assert.match(render(h(NotificationCount, { count: 125 })), /125 notificaciones sin leer.*99\+/);
});
test('list shows unread/read, date and safe navigation; busy read disables button', () => {
  const html = view(); assert.match(html, /Sin leer/); assert.match(html, /Marcar como leída/);
  assert.match(html, /datetime="2030-01-01T12:00:00Z"/i); assert.match(html, /href="\/lista-de-espera"/);
  assert.match(html, /Tu solicitud fue registrada/);
  const read = render(h(NotificationCard, { item: { ...item, readAt: item.createdAt }, busy: false, onRead() {} }));
  assert.match(read, /Leída/); assert.doesNotMatch(read, /Marcar como leída/);
  assert.match(render(h(NotificationCard, { item, busy: true, onRead() {} })), /disabled/);
});
test('empty, loading, error/retry, load more and zero unread render coherent states', () => {
  assert.match(view({ items: [], unreadCount: 0 }), /Aún no tienes notificaciones/);
  assert.match(view({ items: [], unreadCount: 0 }), /No tienes notificaciones sin leer/);
  assert.match(view({ status: 'loading' }), /Cargando notificaciones/);
  assert.match(view({ status: 'error', error: 'Error controlado' }), /Error controlado/);
  assert.match(view({ status: 'error' }), /Reintentar/);
  assert.match(view({ nextCursor: 'next' }), /Cargar más/);
  assert.match(view({ nextCursor: 'next', loadingMore: true }), /Cargando/);
});
}
