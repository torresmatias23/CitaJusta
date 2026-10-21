// Prueba de concurrencia (N usuarios reservan el mismo cupo) y carga básica de lectura.
// No es una prueba de rendimiento formal: entorno local Docker Desktop, una instancia de API.
const BASE = process.argv[2] || 'http://localhost:8080';
const API = `${BASE}/api/v1`;
const BRANCH = 'd1000000-0000-4000-8000-000000000002';
const SERVICE = 'd1000000-0000-4000-8000-000000000003';
const N = 10, READS = 300, PARALLEL = 20;
const stamp = Date.now();
const json = { 'content-type': 'application/json' };
const pct = (arr, q) => arr[Math.min(arr.length - 1, Math.floor(arr.length * q))];

console.log(`# Concurrencia y carga · ${new Date().toISOString()} · ${BASE}`);
const tokens = [];
for (let i = 0; i < N; i++) {
  const u = { email: `carga.${i}.${stamp}@example.test`, password: `Carga-${stamp}-pass!`, firstName: `Carga${i}`, lastName: 'Demo' };
  await fetch(`${API}/auth/register`, { method: 'POST', headers: json, body: JSON.stringify(u) });
  const r = await fetch(`${API}/auth/login`, { method: 'POST', headers: json, body: JSON.stringify({ email: u.email, password: u.password }) });
  const lj = await r.json(); tokens.push(lj.accessToken ?? lj.data?.accessToken);
}
const from = new Date().toISOString(), to = new Date(Date.now() + 30 * 864e5).toISOString();
const availUrl = `${API}/branches/${BRANCH}/services/${SERVICE}/availability?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
const av = await (await fetch(availUrl, { headers: { authorization: `Bearer ${tokens[0]}` } })).json();
const slots = (av.data ?? []).flatMap((x) => x.slots ?? x.agendaSlots ?? [x]).filter((s) => s.id && s.startsAt);
if (!slots.length) { console.log('ABORT: sin cupos disponibles'); process.exit(1); }
const slot = slots[0];
console.log(`Cupo objetivo: ${slot.id} (${slot.startsAt}); ${N} usuarios distintos reservan simultáneamente`);

const statuses = await Promise.all(tokens.map((t) => fetch(`${API}/appointments`, {
  method: 'POST', headers: { ...json, authorization: `Bearer ${t}` }, body: JSON.stringify({ agendaSlotId: slot.id }),
}).then((r) => r.status)));
const count = statuses.reduce((m, s) => ({ ...m, [s]: (m[s] || 0) + 1 }), {});
const ok = (count[201] || 0) === 1 && (count[201] + (count[409] || 0)) === N;
console.log(`${ok ? 'PASS' : 'FAIL'} | Resultado: ${JSON.stringify(count)} -> ${count[201] || 0} reserva confirmada, ${count[409] || 0} conflictos 409, sin doble asignación`);

const latencies = []; let errors = 0, next = 0;
const t0 = performance.now();
await Promise.all(Array.from({ length: PARALLEL }, async () => {
  while (next < READS) {
    next++;
    const s = performance.now();
    const r = await fetch(availUrl, { headers: { authorization: `Bearer ${tokens[next % N]}` } });
    await r.arrayBuffer();
    latencies.push(performance.now() - s);
    if (r.status !== 200) errors++;
  }
}));
const total = (performance.now() - t0) / 1000;
latencies.sort((a, b) => a - b);
console.log(`Carga lectura disponibilidad: ${READS} solicitudes, ${PARALLEL} concurrentes, ${total.toFixed(2)} s, ${(READS / total).toFixed(1)} req/s, errores ${errors}`);
console.log(`Latencia ms: p50 ${pct(latencies, 0.5).toFixed(0)} · p95 ${pct(latencies, 0.95).toFixed(0)} · p99 ${pct(latencies, 0.99).toFixed(0)} · máx ${latencies.at(-1).toFixed(0)}`);
process.exit(ok && !errors ? 0 : 1);
