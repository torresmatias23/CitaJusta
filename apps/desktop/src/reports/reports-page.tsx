import { useEffect, useState, useSyncExternalStore } from 'react';
import type { UserProfile } from '@citajusta/client-core';
import { useAuth } from '../auth/auth-provider';
import { InlineAlert } from '../components/ui/inline-alert';
import { createReportsModel } from './reports-model';
import type { ReportsState } from './reports-model';
import type { Indicators } from './reports-api';

export function ReportsPage() {
  const { user, status } = useAuth();
  if (status !== 'authenticated' || !user) return <p role="status">Se requiere una sesión verificada.</p>;
  return <Workspace key={JSON.stringify([user.id, user.context, user.permissions])} user={user} />;
}
function Workspace({ user }: { user: UserProfile }) {
  const { api } = useAuth();
  const [model] = useState(() => createReportsModel(api, user));
  const state = useSyncExternalStore(model.subscribe, model.getSnapshot, model.getSnapshot);
  useEffect(() => { void model.activate(); return () => model.dispose(); }, [model]);
  return <ReportsView model={model} state={state} />;
}
export function ReportsView({ model, state }: { model: ReturnType<typeof createReportsModel>; state: ReportsState }) {
  if (state.status === 'denied') return <InlineAlert>Acceso no disponible. Aplica un contexto institucional en Sedes y servicios y verifica el permiso reports.read.</InlineAlert>;
  return <section className="catalog-page" aria-label="Reportes institucionales">
    <header><h2>Indicadores institucionales</h2><p>Consulta la actividad del período. Indicadores calculados por la API, según la zona horaria de la institución.</p></header>
    <form className="catalog-context" aria-label="Consultar indicadores" onSubmit={event => { event.preventDefault(); void model.consult(); }}>
      <div className="catalog-fields">
        <label className="catalog-field">Desde<input type="date" name="from" required value={state.filters.from} onChange={event => model.setFilter('from', event.target.value)} aria-describedby="reports-period-help" /></label>
        <label className="catalog-field">Hasta<input type="date" name="to" required value={state.filters.to} onChange={event => model.setFilter('to', event.target.value)} aria-describedby="reports-period-help" /></label>
        {state.branchContext ? <div className="catalog-field"><span>Sede del contexto (fija)</span><p>{state.catalogs.branches.find(b => b.id === state.branchContext)?.name ?? 'Sede autorizada en el contexto actual'}</p></div> :
          <label className="catalog-field">Sede (opcional)<select name="branchId" disabled={state.catalogStatus !== 'ready'} value={state.filters.branchId ?? ''} onChange={event => model.setFilter('branchId', event.target.value)}><option value="">Todas las sedes del contexto</option>{state.catalogs.branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>}
        {(['serviceId', 'professionalId'] as const).map(key => <label className="catalog-field" key={key}>{key === 'serviceId' ? 'Servicio (opcional)' : 'Profesional (opcional)'}<select name={key} disabled={state.catalogStatus !== 'ready'} value={state.filters[key] ?? ''} onChange={event => model.setFilter(key, event.target.value)}><option value="">Sin filtro</option>{state.catalogs[key === 'serviceId' ? 'services' : 'professionals'].map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>)}
      </div>
      <p id="reports-period-help" className="field-help">Fechas inclusivas: entre 1 y 366 días. La API aplica los límites del día institucional.</p>
      {state.catalogStatus === 'loading' && <p role="status">Cargando opciones de filtros… Puedes consultar por período.</p>}
      {state.catalogStatus === 'error' && <p role="status">No se pudieron cargar los catálogos. Puedes consultar por período sin filtros opcionales.</p>}
      <p className="field-help">Las opciones de catálogo son ayudas de selección; sin filtro se incluye la actividad histórica del contexto.</p>
      <button className="primary-button" type="submit" disabled={state.status === 'loading'}>{state.status === 'loading' ? 'Consultando…' : 'Consultar indicadores'}</button>
    </form>
    {state.status === 'idle' && <p role="status">Selecciona un período para consultar.</p>}
    {state.status === 'loading' && <p role="status">Cargando indicadores…</p>}
    {state.status === 'error' && <InlineAlert failed>{state.error}</InlineAlert>}
    {state.status === 'ready' && state.data && <ReportsSummary data={state.data} />}
  </section>;
}
function Metrics({ title, rows }: { title: string; rows: [string, number, string, string?][] }) {
  return <section className="catalog-section" aria-label={title}><h2>{title}</h2><dl className="report-metrics">{rows.map(([label, value, description, suffix]) => <div key={label} className="catalog-card"><dt>{label}<p className="field-help">{description}</p></dt><dd>{value}{suffix}</dd></div>)}</dl></section>;
}
export function ReportsSummary({ data: d }: { data: Indicators }) {
  const empty = [...Object.values(d.appointments), ...Object.values(d.slots), ...Object.values(d.offers)].every(value => value === 0);
  return <div className="catalog-page">
    <p>Período consultado: <time dateTime={d.period.from}>{d.period.from}</time> — <time dateTime={d.period.to}>{d.period.to}</time> (inclusive).</p>
    {empty && <InlineAlert>No se registró actividad para los filtros seleccionados.</InlineAlert>}
    <Metrics title="Citas" rows={[
      ['Citas del período', d.appointments.scheduled, 'Citas no eliminadas cuyo inicio corresponde al período; incluye sus distintos estados.'],
      ['Cancelaciones', d.appointments.cancelled, 'Cancelaciones ocurridas dentro del período.'],
      ['Inasistencias', d.appointments.noShows, 'Transiciones de AGENDADA a INASISTENCIA registradas dentro del período.'],
    ]} />
    <Metrics title="Recuperación de cupos" rows={[
      ['Cupos liberados', d.slots.released, 'Cancelaciones que liberaron un cupo dentro del período.'],
      ['Cupos recuperados', d.slots.recovered, 'Reasignaciones completadas con oferta aceptada y resolución válida dentro del período.'],
      ['Tasa de recuperación', d.slots.recoveryRatePct, 'Porcentaje informado por la API.', ' %'],
    ]} />
    <Metrics title="Ofertas" rows={[
      ['Enviadas', d.offers.sent, 'Ofertas creadas dentro del período.'],
      ['Aceptadas', d.offers.accepted, 'Respuestas de aceptación dentro del período.'],
      ['Rechazadas', d.offers.rejected, 'Respuestas de rechazo dentro del período.'],
      ['Expiradas', d.offers.expired, 'Expiraciones reales registradas por el backend.'],
    ]} />
  </div>;
}
