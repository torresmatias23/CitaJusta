// Capturas reales de la Web CitaJusta (stack Docker) con Playwright + Microsoft Edge.
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const BASE = 'http://localhost:8080';
const OUT = process.argv[2];
mkdirSync(OUT, { recursive: true });
const stamp = Date.now().toString().slice(-6);
const U1 = { first: 'Camila', last: 'Rojas', email: `camila.rojas.${stamp}@example.test`, password: `CitaJusta-${stamp}-Demo` };
const U2 = { first: 'Tomás', last: 'Fuentes', email: `tomas.fuentes.${stamp}@example.test`, password: `CitaJusta-${stamp}-Demo` };
const log = [];
const note = (m) => { log.push(m); console.log(m); };

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const opts = { viewport: { width: 1366, height: 900 }, locale: 'es-CL', timezoneId: 'America/Santiago', deviceScaleFactor: 1 };
const c1 = await browser.newContext(opts);
const c2 = await browser.newContext(opts);
const p1 = await c1.newPage();
const p2 = await c2.newPage();
for (const [name, p] of [['U1', p1], ['U2', p2]]) {
  p.on('console', (m) => { if (m.type() === 'error') note(`[consola ${name}] ${m.text()}`); });
  p.on('response', (r) => { if (r.url().includes('/api/v1/') && r.status() >= 500) note(`[HTTP ${r.status()} ${name}] ${r.url()}`); });
}
let n = 0;
async function shot(p, name, full = false) {
  n++;
  const file = `${String(n).padStart(2, '0')}-${name}.png`;
  await p.evaluate(() => { if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur(); }).catch(() => {});
  await p.mouse.move(1, 1).catch(() => {});
  if (full) await p.evaluate(() => window.scrollTo(0, 0)).catch(() => {});
  await p.waitForTimeout(400);
  await p.screenshot({ path: join(OUT, file), fullPage: full });
  note(`captura ${file} · ${p.url().replace(BASE, '') || '/'}`);
}
const settle = (p) => p.waitForLoadState('networkidle').catch(() => {});

// 1. Inicio público
await p1.goto(BASE + '/'); await settle(p1);
await shot(p1, 'inicio-publico');

// 2. Ruta protegida sin sesión redirige a login
await p1.goto(BASE + '/mis-citas'); await settle(p1);
await shot(p1, 'ruta-protegida-redirige-login');

// 3. Registro
await p1.goto(BASE + '/registro'); await settle(p1);
await p1.getByLabel('Nombre').fill(U1.first);
await p1.getByLabel('Apellido').fill(U1.last);
await p1.getByLabel('Correo electrónico').fill(U1.email);
await p1.getByLabel('Contraseña').fill(U1.password);
await shot(p1, 'registro-formulario');
await p1.getByRole('button', { name: 'Crear cuenta' }).click();
await p1.waitForURL('**/login**'); await settle(p1);

// 4. Login con contraseña errónea y luego correcta
await p1.getByLabel('Correo electrónico').fill(U1.email);
await p1.getByLabel('Contraseña').fill('contraseña-incorrecta');
await p1.getByRole('button', { name: 'Iniciar sesión' }).click();
await p1.getByRole('alert').first().waitFor({ timeout: 8000 }).catch(() => {});
await shot(p1, 'login-credenciales-invalidas');
await p1.getByLabel('Contraseña').fill(U1.password);
await shot(p1, 'login-formulario');
await p1.getByRole('button', { name: 'Iniciar sesión' }).click();
await p1.waitForURL(BASE + '/'); await settle(p1);
await shot(p1, 'inicio-autenticado');

// 5. Búsqueda flexible
await p1.getByLabel('Institución o empresa').selectOption({ label: 'Institución Demo CitaJusta' });
await settle(p1);
await p1.getByLabel('Sede o sucursal').selectOption({ label: 'Sede Centro Demo' });
await settle(p1);
await p1.getByLabel('Servicio o atención').selectOption({ label: 'Atención General Demo' });
await p1.getByLabel('Soy flexible').check();
await p1.getByLabel('Rango de búsqueda').selectOption('30');
const ubic = p1.getByRole('button', { name: 'Ver ubicación' });
if (await ubic.count()) { await ubic.first().click(); }
await p1.locator('form[aria-label="Buscar horas"]').scrollIntoViewIfNeeded().catch(() => {});
await shot(p1, 'busqueda-flexible-y-ubicacion', true);
await p1.getByRole('button', { name: 'Buscar horas' }).click();
await p1.waitForURL('**/resultados**'); await settle(p1);
await shot(p1, 'resultados-cupos-disponibles', true);

// 6. Reserva
const reservar = p1.getByRole('button', { name: 'Reservar hora' });
const disponibles = await reservar.count();
note(`cupos visibles en resultados: ${disponibles}`);
await reservar.first().click();
await p1.waitForURL('**/confirmacion'); await settle(p1);
await shot(p1, 'confirmacion-reserva', true);
await p1.goto(BASE + '/mis-citas'); await settle(p1);
await shot(p1, 'mis-citas-agendada', true);

// 7. Usuario 2: registro y login, lista de espera y preferencias
await p2.goto(BASE + '/registro'); await settle(p2);
await p2.getByLabel('Nombre').fill(U2.first);
await p2.getByLabel('Apellido').fill(U2.last);
await p2.getByLabel('Correo electrónico').fill(U2.email);
await p2.getByLabel('Contraseña').fill(U2.password);
await p2.getByRole('button', { name: 'Crear cuenta' }).click();
await p2.waitForURL('**/login**'); await settle(p2);
await p2.getByLabel('Correo electrónico').fill(U2.email);
await p2.getByLabel('Contraseña').fill(U2.password);
await p2.getByRole('button', { name: 'Iniciar sesión' }).click();
await p2.waitForURL(BASE + '/'); await settle(p2);
await p2.goto(BASE + '/lista-de-espera'); await settle(p2);
await p2.getByLabel('Servicio o atención').selectOption({ index: 1 });
await settle(p2);
await p2.getByLabel('Sede o sucursal (opcional)').selectOption({ label: 'Sede Centro Demo' });
await shot(p2, 'lista-espera-ingreso');
await p2.getByRole('button', { name: 'Ingresar a lista de espera' }).click();
await settle(p2);
await p2.getByRole('button', { name: /^Preferencias de/ }).first().click();
await settle(p2);
for (const day of ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo']) await p2.getByLabel(day, { exact: true }).check();
if (!(await p2.getByLabel('Desde · rango 1').count())) await p2.getByRole('button', { name: 'Agregar rango' }).click();
await p2.getByLabel('Desde · rango 1').fill('08:00');
await p2.getByLabel('Hasta · rango 1').fill('20:00');
const agregarSede = p2.getByLabel('Agregar sede');
if (await agregarSede.count()) { await agregarSede.selectOption({ label: 'Sede Centro Demo' }).catch(() => {}); await p2.getByRole('button', { name: 'Agregar sede' }).click().catch(() => {}); }
await p2.getByRole('button', { name: 'Guardar preferencias' }).click();
await settle(p2);
await p2.getByRole('status').first().waitFor({ timeout: 5000 }).catch(() => {});
await shot(p2, 'lista-espera-preferencias-guardadas', true);

// 8. Usuario 1 cancela -> reasignación automática
await p1.goto(BASE + '/mis-citas'); await settle(p1);
await p1.getByRole('button', { name: /^Cancelar cita de/ }).first().click();
await shot(p1, 'cancelacion-dialogo-confirmacion');
await p1.getByRole('button', { name: 'Sí, cancelar cita' }).click();
await settle(p1); await p1.waitForTimeout(800);
await shot(p1, 'mis-citas-cancelada', true);

// 9. Usuario 2 recibe y acepta la oferta
await p2.goto(BASE + '/ofertas'); await settle(p2);
await shot(p2, 'oferta-disponible-con-plazo', true);
const aceptar = p2.getByRole('button', { name: 'Aceptar hora' });
if (await aceptar.count()) {
  await aceptar.first().click(); await settle(p2); await p2.waitForTimeout(800);
  await shot(p2, 'oferta-aceptada', true);
} else note('SIN OFERTA DISPONIBLE para U2');
await p2.goto(BASE + '/mis-citas'); await settle(p2);
await shot(p2, 'mis-citas-cita-reasignada', true);
await p2.goto(BASE + '/notificaciones'); await settle(p2);
await shot(p2, 'notificaciones', true);
await p2.goto(BASE + '/cuenta'); await settle(p2);
await shot(p2, 'mi-cuenta');

// 10. Vista móvil
const cm = await browser.newContext({ ...opts, viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const pm = await cm.newPage();
await pm.goto(BASE + '/login'); await settle(pm);
await pm.getByLabel('Correo electrónico').fill(U2.email);
await pm.getByLabel('Contraseña').fill(U2.password);
await pm.getByRole('button', { name: 'Iniciar sesión' }).click();
await pm.waitForURL(BASE + '/'); await settle(pm);
await shot(pm, 'movil-inicio');
await pm.goto(BASE + '/mis-citas'); await settle(pm);
await shot(pm, 'movil-mis-citas', true);
await pm.goto(BASE + '/ofertas'); await settle(pm);
await shot(pm, 'movil-ofertas', true);

writeFileSync(join(OUT, '..', 'capturas-web-log.txt'), [`# Capturas Web · ${new Date().toISOString()} · ${BASE} · Edge headless (Playwright)`, `# Usuarios ficticios: ${U1.first} ${U1.last} y ${U2.first} ${U2.last} (dominio example.test)`, ...log].join('\n'));
await browser.close();
