// Prueba de humo E2E del flujo principal de CitaJusta contra el stack Docker (vía nginx, mismo origen).
// Uso: node smoke-flow.mjs [baseUrl] > salida.txt
const BASE = process.argv[2] || 'http://localhost:8080';
const API = `${BASE}/api/v1`;
const BRANCH = 'd1000000-0000-4000-8000-000000000002';
const SERVICE = 'd1000000-0000-4000-8000-000000000003';
const stamp = Date.now();
const results = [];
let failures = 0;

async function call(step, method, path, { token, body, expect } = {}) {
  const started = performance.now();
  const res = await fetch(path.startsWith('http') ? path : `${API}${path}`, {
    method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const ms = Math.round(performance.now() - started);
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  const ok = expect ? (Array.isArray(expect) ? expect.includes(res.status) : res.status === expect) : res.ok;
  if (!ok) failures++;
  results.push({ step, method, path: path.replace(API, '/api/v1'), status: res.status, ms, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'} | ${step} | ${method} ${path.replace(API, '/api/v1').replace(BASE, '')} | HTTP ${res.status} | ${ms} ms`);
  return { status: res.status, json, headers: res.headers };
}

const user = (n) => ({ email: `demo.${n}.${stamp}@example.test`, password: `Demo-${stamp}-pass!`, firstName: `Usuario${n}`, lastName: 'Demo' });

console.log(`# Prueba de flujo CitaJusta · ${new Date().toISOString()} · base ${BASE}`);
const health = await call('Salud API (directo, puerto 3000)', 'GET', 'http://localhost:3000/health');
console.log(`    /health -> ${JSON.stringify(health.json)}`);
const home = await call('Web SPA sirve index.html', 'GET', `${BASE}/`);
await call('Fallback SPA en ruta profunda', 'GET', `${BASE}/mis-citas`);
console.log(`    cabeceras web: x-content-type-options=${home.headers.get('x-content-type-options')}, x-frame-options=${home.headers.get('x-frame-options')}`);

await call('Acceso sin token rechazado', 'GET', '/appointments/me', { expect: 401 });
await call('Registro con contraseña corta rechazado', 'POST', '/auth/register', { body: { ...user('x'), password: 'corta' }, expect: 400 });
await call('Campo no permitido rechazado (.strict)', 'POST', '/auth/register', { body: { ...user('y'), role: 'ADMIN' }, expect: 400 });

const A = user('a'); const B = user('b'); const C = user('c');
for (const u of [A, B, C]) await call(`Registro ${u.firstName}`, 'POST', '/auth/register', { body: u, expect: 201 });
await call('Login con contraseña incorrecta', 'POST', '/auth/login', { body: { email: A.email, password: 'incorrecta-123456' }, expect: 401 });
const tok = {}; const ref = {};
for (const [k, u] of [['A', A], ['B', B], ['C', C]]) {
  const r = await call(`Login ${u.firstName}`, 'POST', '/auth/login', { body: { email: u.email, password: u.password }, expect: [200, 201] });
  tok[k] = r.json?.data?.accessToken ?? r.json?.accessToken; ref[k] = r.json?.data?.refreshToken ?? r.json?.refreshToken;
}

const inst = await call('Catálogo de instituciones', 'GET', '/institutions', { token: tok.A });
console.log(`    instituciones: ${(inst.json?.data ?? []).map((i) => i.name).join(', ')}`);
const from = new Date().toISOString(); const to = new Date(Date.now() + 30 * 864e5).toISOString();
const av = await call('Disponibilidad próximos 30 días', 'GET', `/branches/${BRANCH}/services/${SERVICE}/availability?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, { token: tok.A });
const slots = (av.json?.data ?? []).flatMap((x) => x.slots ?? x.agendaSlots ?? [x]).filter((s) => s.id && s.startsAt);
console.log(`    cupos disponibles: ${slots.length}${slots[0] ? ` (primero ${slots[0].startsAt})` : ''}`);
if (!slots.length) { console.log('ABORT: sin cupos'); process.exit(1); }
const slot = slots[0];

// Concurrencia: A y C intentan reservar el mismo cupo al mismo tiempo.
const [rA, rC] = await Promise.all([
  call('Reserva concurrente (A)', 'POST', '/appointments', { token: tok.A, body: { agendaSlotId: slot.id }, expect: [201, 409] }),
  call('Reserva concurrente (C)', 'POST', '/appointments', { token: tok.C, body: { agendaSlotId: slot.id }, expect: [201, 409] }),
]);
const winners = [rA, rC].filter((r) => r.status === 201).length;
const integrity = winners === 1 && [rA.status, rC.status].includes(409);
if (!integrity) failures++;
console.log(`${integrity ? 'PASS' : 'FAIL'} | Integridad: exactamente una reserva confirmada (A=${rA.status}, C=${rC.status})`);
const ownerKey = rA.status === 201 ? 'A' : 'C';
const appointment = (ownerKey === 'A' ? rA : rC).json?.data;
await call('Segunda reserva del mismo cupo (secuencial) rechazada', 'POST', '/appointments', { token: tok.B, body: { agendaSlotId: slot.id }, expect: 409 });

const wl = await call('B ingresa a lista de espera', 'POST', '/waitlist', { token: tok.B, body: { serviceId: SERVICE, branchId: BRANCH }, expect: 201 });
const entryId = wl.json?.data?.id;
const local = new Date(new Date(slot.startsAt).toLocaleString('en-US', { timeZone: 'America/Santiago' }));
const isoDay = ((local.getDay() + 6) % 7) + 1;
await call('B define preferencias (día/rango/sede)', 'PUT', `/waitlist/${entryId}/preferences`, { token: tok.B,
  body: { preferredDays: [isoDay], timeRanges: [{ start: '08:00', end: '20:00' }], preferredBranchIds: [BRANCH], allowsOtherBranches: false, acceptsAnyProfessional: true } });
await call('Lista de espera duplicada rechazada', 'POST', '/waitlist', { token: tok.B, body: { serviceId: SERVICE, branchId: BRANCH }, expect: 409 });

await call(`Cancelación por el titular (${ownerKey})`, 'POST', `/appointments/${appointment.id}/cancel`, { token: tok[ownerKey], expect: 200 });
await call('Cancelación repetida es idempotente', 'POST', `/appointments/${appointment.id}/cancel`, { token: tok[ownerKey], expect: 200 });
await call('Otro usuario no puede cancelar cita ajena', 'POST', `/appointments/${appointment.id}/cancel`, { token: tok.B, expect: 404 });

const offers = await call('B consulta sus ofertas (reasignación automática)', 'GET', '/reassignments/offers/me', { token: tok.B });
const offer = (offers.json?.data ?? []).find((o) => o.status === 'PENDING');
console.log(`    oferta: ${offer ? `${offer.status}, expira ${offer.expiresAt}` : 'NO GENERADA'}`);
if (!offer) { failures++; console.log('FAIL | No se generó oferta automática'); }
else {
  await call('Usuario sin oferta no puede aceptarla', 'POST', `/reassignments/offers/${offer.id}/accept`, { token: tok.C, expect: [403, 404] });
  await call('B acepta la oferta', 'POST', `/reassignments/offers/${offer.id}/accept`, { token: tok.B, expect: [200, 201] });
  await call('Aceptación repetida no duplica', 'POST', `/reassignments/offers/${offer.id}/accept`, { token: tok.B, expect: [200, 201, 409] });
  const mine = await call('B ve la cita reasignada en Mis citas', 'GET', '/appointments/me', { token: tok.B });
  const got = (mine.json?.data ?? []).find((a) => a.id === appointment.id);
  console.log(`    cita de B: ${got ? `${got.id} estado ${got.status}` : 'no encontrada'} (misma Appointment transferida: ${!!got})`);
  if (!got) failures++;
}
const notes = await call('Notificaciones internas de B', 'GET', '/notifications/me', { token: tok.B });
console.log(`    notificaciones B: ${(notes.json?.data ?? []).map((n) => n.type).join(', ')}`);
await call('Refresh rota el token (A)', 'POST', '/auth/refresh', { body: { refreshToken: ref.A }, expect: [200, 201] }).then((r) => { ref.A2 = r.json?.refreshToken ?? r.json?.data?.refreshToken; });
await call('Refresh anterior reutilizado es rechazado', 'POST', '/auth/refresh', { body: { refreshToken: ref.A }, expect: 401 });
await call('Logout A revoca la sesión', 'POST', '/auth/logout', { body: { refreshToken: ref.A2 }, expect: [200, 204] });
await call('Refresh tras logout es rechazado', 'POST', '/auth/refresh', { body: { refreshToken: ref.A2 }, expect: 401 });

const times = results.map((r) => r.ms).sort((a, b) => a - b);
console.log(`\nResumen: ${results.length + 1} verificaciones, fallos: ${failures}. Latencia HTTP mediana ${times[Math.floor(times.length / 2)]} ms, p95 ${times[Math.floor(times.length * 0.95)]} ms, máx ${times.at(-1)} ms.`);
process.exit(failures ? 1 : 0);
