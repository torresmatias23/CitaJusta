import { useEffect, useState, useSyncExternalStore } from 'react';
import type { UserProfile } from '@citajusta/client-core';
import { useAuth } from '../auth/auth-provider';
import { InlineAlert } from '../components/ui/inline-alert';
import { createDashboardModel, presets } from './dashboard-model';
import type { DashboardState } from './dashboard-model';
import type { Dashboard, InsightSeverity, TrendBucket } from './dashboard-api';

const number = new Intl.NumberFormat('es-CL', { maximumFractionDigits: 1 });
const pct = (value: number) => `${number.format(value)} %`;
const shortDate = (value: string) => `${value.slice(8, 10)}-${value.slice(5, 7)}`;
const severityLabel: Record<InsightSeverity, string> = { high: 'Prioridad alta', medium: 'Prioridad media', info: 'Informativo' };
const severityTone: Record<InsightSeverity, string> = { high: 'danger', medium: 'warning', info: 'info' };

export function DashboardPage() {
  const { user, status } = useAuth();
  if (status !== 'authenticated' || !user) return <p role="status">Se requiere una sesión verificada.</p>;
  return <Workspace key={JSON.stringify([user.id, user.context, user.permissions])} user={user} />;
}
function Workspace({ user }: { user: UserProfile }) {
  const { api } = useAuth();
  const [model] = useState(() => createDashboardModel(api, user));
  const state = useSyncExternalStore(model.subscribe, model.getSnapshot, model.getSnapshot);
  useEffect(() => { void model.activate(); return () => model.dispose(); }, [model]);
  return <DashboardView model={model} state={state} />;
}

export function DashboardView({ model, state }: { model: ReturnType<typeof createDashboardModel>; state: DashboardState }) {
  if (state.status === 'denied') return <InlineAlert>Acceso no disponible. Aplica un contexto institucional en Sedes y servicios y verifica el permiso reports.read.</InlineAlert>;
  return <section className="catalog-page dashboard" aria-label="Panel de gestión">
    <header><h2>Panel de gestión</h2><p>Indicadores de la operación para decidir dónde abrir cupos, reforzar la asistencia y mejorar la recuperación de horas. Calculados por la API en la zona horaria de la institución.</p></header>
    <form className="catalog-context" aria-label="Filtros del panel" onSubmit={event => { event.preventDefault(); void model.consult(); }}>
      <div className="dashboard-presets" role="group" aria-label="Períodos rápidos">
        {presets.map(preset => <button key={preset.id} type="button" aria-pressed={state.preset === preset.id} onClick={() => { void model.applyPreset(preset.id); }}>{preset.label}</button>)}
      </div>
      <div className="catalog-fields">
        <label className="catalog-field">Desde<input type="date" name="from" required value={state.filters.from} onChange={event => model.setFilter('from', event.target.value)} /></label>
        <label className="catalog-field">Hasta<input type="date" name="to" required value={state.filters.to} onChange={event => model.setFilter('to', event.target.value)} /></label>
        {state.branchContext ? <div className="catalog-field"><span>Sede del contexto (fija)</span><p>{state.catalogs.branches.find(b => b.id === state.branchContext)?.name ?? 'Sede autorizada en el contexto actual'}</p></div> :
          <label className="catalog-field">Sede<select name="branchId" disabled={state.catalogStatus !== 'ready'} value={state.filters.branchId ?? ''} onChange={event => model.setFilter('branchId', event.target.value)}><option value="">Todas las sedes</option>{state.catalogs.branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>}
        {(['serviceId', 'professionalId'] as const).map(key => <label className="catalog-field" key={key}>{key === 'serviceId' ? 'Servicio' : 'Profesional'}<select name={key} disabled={state.catalogStatus !== 'ready'} value={state.filters[key] ?? ''} onChange={event => model.setFilter(key, event.target.value)}><option value="">Todos</option>{state.catalogs[key === 'serviceId' ? 'services' : 'professionals'].map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>)}
      </div>
      <button className="primary-button" type="submit" disabled={state.status === 'loading'}>{state.status === 'loading' ? 'Actualizando…' : 'Actualizar panel'}</button>
    </form>
    {state.status === 'idle' && <p role="status">Ajusta el período y presiona Actualizar panel.</p>}
    {state.status === 'loading' && <p role="status">Cargando panel…</p>}
    {state.status === 'error' && <InlineAlert failed>{state.error}</InlineAlert>}
    {state.status === 'ready' && state.data && <DashboardContent data={state.data} />}
  </section>;
}

export function DashboardContent({ data: d }: { data: Dashboard }) {
  return <div className="dashboard-content">
    <p className="dashboard-period">Período: <time dateTime={d.period.from}>{d.period.from}</time> al <time dateTime={d.period.to}>{d.period.to}</time> (inclusive).</p>
    <Insights data={d} />
    <dl className="dashboard-kpis" aria-label="Indicadores clave">
      <Kpi label="Citas del período" value={number.format(d.appointmentStatus.total)} note={`${d.appointmentStatus.attended} atendidas`} />
      <Kpi label="Asistencia" value={pct(d.rates.attendanceRatePct)} note="Sobre citas cerradas" />
      <Kpi label="Inasistencia" value={pct(d.rates.noShowRatePct)} note={`${d.appointmentStatus.noShows} citas`} />
      <Kpi label="Cancelación" value={pct(d.rates.cancellationRatePct)} note={`${d.appointmentStatus.cancelled} citas`} />
      <Kpi label="Recuperación de cupos" value={pct(d.rates.recoveryRatePct)} note={`${d.indicators.slots.recovered} de ${d.indicators.slots.released} liberados`} />
      <Kpi label="Ocupación de agenda" value={pct(d.rates.occupancyPct)} note={`${d.capacity.reserved} de ${d.capacity.total} cupos`} />
      <Kpi label="Personas en espera" value={number.format(d.waitlist.active)} note={d.waitlist.active ? `Promedio ${number.format(d.waitlist.averageWaitDays)} días` : 'Sin espera activa'} />
    </dl>
    <section className="catalog-section" aria-labelledby="trend-title">
      <h2 id="trend-title">Actividad {d.granularity === 'day' ? 'diaria' : 'semanal'}</h2>
      <p className="field-help">Citas por fecha de atención; cancelaciones e inasistencias por fecha de registro.</p>
      <TrendChart trend={d.trend} granularity={d.granularity} />
    </section>
    <div className="dashboard-columns">
      <section className="catalog-section" aria-labelledby="status-title">
        <h2 id="status-title">Estado de las citas del período</h2>
        <SegmentedBar label="Estado de las citas" parts={[
          ['Agendadas', d.appointmentStatus.booked, 'var(--viz-1)'], ['Atendidas', d.appointmentStatus.attended, 'var(--viz-good)'],
          ['Inasistencias', d.appointmentStatus.noShows, 'var(--viz-warning)'], ['Canceladas', d.appointmentStatus.cancelled, 'var(--viz-critical)'],
          ['Otros estados', d.appointmentStatus.other, 'var(--viz-muted)']]} />
      </section>
      <section className="catalog-section" aria-labelledby="capacity-title">
        <h2 id="capacity-title">Uso de la agenda</h2>
        <SegmentedBar label="Cupos del período" parts={[
          ['Reservados', d.capacity.reserved, 'var(--viz-1)'], ['En reasignación', d.capacity.inProcess, 'var(--viz-2)'],
          ['Disponibles', d.capacity.available, 'var(--viz-3)'], ['Expirados', d.capacity.expired, 'var(--viz-muted)']]} />
        <p className="field-help">Ofertas: {d.indicators.offers.sent} enviadas, {d.indicators.offers.accepted} aceptadas ({pct(d.rates.offerAcceptanceRatePct)} de las resueltas), {d.indicators.offers.expired} expiradas.</p>
      </section>
    </div>
    <section className="catalog-section" aria-labelledby="services-title">
      <h2 id="services-title">Servicios con más demanda</h2>
      {d.services.length ? <RankingTable rows={d.services} waiting /> : <p className="field-help">Sin citas ni lista de espera para los filtros.</p>}
    </section>
    <div className="dashboard-columns">
      <section className="catalog-section" aria-labelledby="professionals-title">
        <h2 id="professionals-title">Profesionales</h2>
        {d.professionals.length ? <RankingTable rows={d.professionals} /> : <p className="field-help">Sin citas en el período.</p>}
      </section>
      <section className="catalog-section" aria-labelledby="waitlist-title">
        <h2 id="waitlist-title">Lista de espera actual</h2>
        <dl className="dashboard-waitlist">
          <div><dt>Personas esperando</dt><dd>{number.format(d.waitlist.active)}</dd></div>
          <div><dt>Espera promedio</dt><dd>{number.format(d.waitlist.averageWaitDays)} días</dd></div>
          <div><dt>Espera más larga</dt><dd>{number.format(d.waitlist.oldestWaitDays)} días</dd></div>
        </dl>
        {d.waitlist.byPriority.length > 0 && <ul className="dashboard-priorities" aria-label="Personas por prioridad">
          {d.waitlist.byPriority.map(row => <li key={`${row.level}-${row.name}`}><span>{row.name}</span><strong>{row.count}</strong></li>)}
        </ul>}
        <p className="field-help">Estado actual, no limitado al período ni al profesional.</p>
      </section>
    </div>
  </div>;
}

function Kpi({ label, value, note }: { label: string; value: string; note: string }) {
  return <div className="dashboard-kpi"><dt>{label}</dt><dd>{value}</dd><p>{note}</p></div>;
}

function Insights({ data }: { data: Dashboard }) {
  return <section className="catalog-section dashboard-insights" aria-labelledby="insights-title">
    <h2 id="insights-title">Recomendaciones para decidir</h2>
    <ul>{data.insights.map(insight => <li key={insight.code} className={`dashboard-insight is-${insight.severity}`}>
      <span className={`status-badge tone-${severityTone[insight.severity]}`}>{severityLabel[insight.severity]}</span>
      <h3>{insight.title}</h3>
      <p>{insight.detail}</p>
      <p><strong>Acción sugerida:</strong> {insight.action}</p>
    </li>)}</ul>
  </section>;
}

function SegmentedBar({ label, parts }: { label: string; parts: [string, number, string][] }) {
  const total = parts.reduce((sum, [, value]) => sum + value, 0);
  const visible = parts.filter(([, value]) => value > 0);
  return <figure className="dashboard-segmented">
    <div className="dashboard-segments" role="img" aria-label={`${label}: ${parts.map(([name, value]) => `${name} ${value}`).join(', ')}`}>
      {total === 0 ? <span className="dashboard-segment is-empty" /> : visible.map(([name, value, color]) =>
        <span key={name} className="dashboard-segment" style={{ flexGrow: value, background: color }} title={`${name}: ${value} (${pct(Math.round(value / total * 1000) / 10)})`} />)}
    </div>
    <figcaption><ul className="dashboard-legend">{parts.map(([name, value, color]) => <li key={name}>
      <span className="dashboard-swatch" style={{ background: color }} aria-hidden="true" />{name}<strong>{value}</strong>
    </li>)}</ul></figcaption>
  </figure>;
}

function RankingTable({ rows, waiting = false }: { rows: (Dashboard['professionals'][number] & { waiting?: number })[]; waiting?: boolean }) {
  const max = Math.max(1, ...rows.map(row => row.scheduled));
  return <table className="dashboard-table">
    <thead><tr><th scope="col">Nombre</th><th scope="col">Citas</th><th scope="col">Inasistencia</th><th scope="col">Canceladas</th>{waiting && <th scope="col">En espera</th>}</tr></thead>
    <tbody>{rows.map(row => <tr key={row.id}>
      <th scope="row">{row.name}</th>
      <td><span className="dashboard-bar"><span style={{ width: `${row.scheduled / max * 100}%` }} /></span>{row.scheduled}</td>
      <td>{pct(row.noShowRatePct)}</td><td>{row.cancelled}</td>{waiting && <td>{row.waiting ?? 0}</td>}
    </tr>)}</tbody>
  </table>;
}

const series = [
  { key: 'scheduled', label: 'Citas', color: 'var(--viz-1)' },
  { key: 'cancelled', label: 'Cancelaciones', color: 'var(--viz-2)' },
  { key: 'noShows', label: 'Inasistencias', color: 'var(--viz-3)' },
] as const;
function niceMax(value: number) {
  const magnitude = 10 ** Math.floor(Math.log10(Math.max(1, value)));
  return [1, 2, 5, 10].map(step => step * magnitude).find(limit => limit >= value) ?? 10 * magnitude;
}

export function TrendChart({ trend, granularity }: { trend: TrendBucket[]; granularity: Dashboard['granularity'] }) {
  const [hover, setHover] = useState<number | null>(null);
  const width = 720, height = 240, left = 44, right = 16, top = 16, bottom = 32;
  const max = niceMax(Math.max(1, ...trend.flatMap(bucket => [bucket.scheduled, bucket.cancelled, bucket.noShows])));
  const step = trend.length > 1 ? (width - left - right) / (trend.length - 1) : 0;
  const x = (index: number) => trend.length > 1 ? left + index * step : (left + width - right) / 2;
  const y = (value: number) => top + (1 - value / max) * (height - top - bottom);
  const ticks = [0, max / 2, max];
  const labels = [...new Set([0, Math.floor((trend.length - 1) / 2), trend.length - 1])].filter(index => index >= 0);
  const active = hover === null ? null : trend[hover];
  const prefix = granularity === 'week' ? 'Semana del ' : '';
  return <figure className="dashboard-chart">
    <ul className="dashboard-legend">{series.map(item => <li key={item.key}><span className="dashboard-line-key" style={{ background: item.color }} aria-hidden="true" />{item.label}</li>)}</ul>
    <div className="dashboard-plot" onMouseLeave={() => setHover(null)}>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Tendencia de citas, cancelaciones e inasistencias del período">
        {ticks.map(tick => <g key={tick}>
          <line x1={left} x2={width - right} y1={y(tick)} y2={y(tick)} className="dashboard-grid" />
          <text x={left - 8} y={y(tick) + 4} textAnchor="end" className="dashboard-axis">{number.format(tick)}</text>
        </g>)}
        {labels.map(index => <text key={index} x={x(index)} y={height - 10} textAnchor="middle" className="dashboard-axis">{shortDate(trend[index].start)}</text>)}
        {active && hover !== null && <line x1={x(hover)} x2={x(hover)} y1={top} y2={height - bottom} className="dashboard-crosshair" />}
        {series.map(item => <g key={item.key}>
          <path d={trend.map((bucket, index) => `${index ? 'L' : 'M'}${x(index).toFixed(1)},${y(bucket[item.key]).toFixed(1)}`).join(' ')}
            fill="none" stroke={item.color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
          {trend.length > 0 && <circle cx={x(hover ?? trend.length - 1).toFixed(1)} cy={y(trend[hover ?? trend.length - 1][item.key]).toFixed(1)} r="4" fill={item.color} className="dashboard-dot" />}
        </g>)}
        {trend.map((bucket, index) => <rect key={bucket.start} x={x(index) - Math.max(step, 24) / 2} y={top} width={Math.max(step, 24)} height={height - top - bottom}
          fill="transparent" onMouseEnter={() => setHover(index)}><title>{`${prefix}${bucket.start} · Citas: ${bucket.scheduled} · Cancelaciones: ${bucket.cancelled} · Inasistencias: ${bucket.noShows}`}</title></rect>)}
      </svg>
      {active && hover !== null && <div className="dashboard-tooltip" style={{ left: `${x(hover) / width * 100}%` }} role="status">
        <strong>{prefix}{active.start}</strong>
        {series.map(item => <span key={item.key}><i style={{ background: item.color }} aria-hidden="true" />{item.label}: {active[item.key]}</span>)}
      </div>}
    </div>
    <details className="dashboard-data"><summary>Ver datos en tabla</summary>
      <table className="dashboard-table"><thead><tr><th scope="col">{granularity === 'week' ? 'Semana' : 'Fecha'}</th>{series.map(item => <th key={item.key} scope="col">{item.label}</th>)}</tr></thead>
        <tbody>{trend.map(bucket => <tr key={bucket.start}><th scope="row">{bucket.start}</th>{series.map(item => <td key={item.key}>{bucket[item.key]}</td>)}</tr>)}</tbody></table>
    </details>
  </figure>;
}
