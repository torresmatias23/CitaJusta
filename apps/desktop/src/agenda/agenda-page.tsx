import { useEffect, useState, useSyncExternalStore } from 'react';
import type { UserProfile } from '@citajusta/client-core';
import { useAuth } from '../auth/auth-provider';
import { createAgendaModel } from './agenda-model';
import type { AgendaState } from './agenda-model';
import { formatAgendaTime } from './agenda-api';

export function AgendaPage() {
  const { user, status } = useAuth();
  if (status !== 'authenticated' || !user) return <p role="status">Se requiere una sesión verificada.</p>;
  return <AgendaWorkspace key={JSON.stringify([user.id, user.context, user.permissions])} user={user} />;
}
function AgendaWorkspace({ user }: { user: UserProfile }) {
  const { api } = useAuth();
  const [model] = useState(() => createAgendaModel(api, user));
  const state = useSyncExternalStore(model.subscribe, model.getSnapshot, model.getSnapshot);
  useEffect(() => { void model.activate(); return () => model.dispose(); }, [model]);
  return <AgendaView model={model} state={state} />;
}
export function AgendaView({ model, state }: { model: ReturnType<typeof createAgendaModel>; state: AgendaState }) {
  if (state.status === 'denied') return <p role="status">Acceso no disponible. Aplica un contexto institucional en Sedes y servicios y verifica el permiso agenda.read.</p>;
  return <section className="catalog-page" aria-label="Consulta de agenda institucional">
    <p>Consulta de sólo lectura. La API determina las citas del día institucional.</p>
    <form className="catalog-context" aria-label="Filtros de agenda" onSubmit={event => { event.preventDefault(); void model.consult(); }}>
      <div className="catalog-fields">
        <label className="catalog-field">Fecha institucional<input name="date" type="date" required value={state.filters.date} onChange={event => model.setFilters({ date: event.target.value })} /></label>
        <label className="catalog-field">Sede<select name="branchId" value={state.filters.branchId ?? ''} disabled={Boolean(model.branchContext)} onChange={event => model.setFilters({ branchId: event.target.value })}>
          {!model.branchContext && <option value="">Todas las sedes del contexto</option>}
          {model.branchContext && !state.catalogs.branches.some(branch => branch.id === model.branchContext) && <option value={model.branchContext}>Sede del contexto (fija)</option>}
          {state.catalogs.branches.map(branch => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
        </select></label>
        <label className="catalog-field">Servicio<select name="serviceId" value={state.filters.serviceId ?? ''} onChange={event => model.setFilters({ serviceId: event.target.value })}>
          <option value="">Todos los servicios</option>{state.catalogs.services.map(service => <option key={service.id} value={service.id}>{service.name}</option>)}
        </select></label>
        <label className="catalog-field">Profesional<select name="professionalId" value={state.filters.professionalId ?? ''} onChange={event => model.setFilters({ professionalId: event.target.value })}>
          <option value="">Todos los profesionales</option>{state.catalogs.professionals.map(professional => <option key={professional.id} value={professional.id}>{professional.name}</option>)}
        </select></label>
        <label className="catalog-field">Estado (código exacto)<input name="status" maxLength={60} placeholder="Ej.: AGENDADA, CANCELADA" value={state.filters.status ?? ''} onChange={event => model.setFilters({ status: event.target.value })} /></label>
      </div>
      <button type="submit" disabled={!state.filters.date || state.status === 'loading'}>{state.status === 'loading' ? 'Consultando…' : 'Consultar agenda'}</button>
    </form>
    <p>Horarios mostrados en {state.timeZone ?? 'UTC'}{state.zoneStatus !== 'ready' ? ' (zona institucional no disponible; la consulta conserva el día definido por la API)' : ''}.</p>
    <p>Los catálogos son ayudas de selección. Las citas históricas no se excluyen por actividad actual; sus opciones se incorporan al consultar.</p>
    {state.catalogStatus === 'loading' && <p role="status">Cargando opciones de filtros…</p>}
    {(state.catalogStatus === 'error' || state.zoneStatus === 'error') && <div role="alert"><p>No pudimos cargar todas las ayudas de filtros o la zona horaria. Puedes consultar por fecha.</p><button type="button" onClick={() => { void model.reloadCatalogs(); }}>Reintentar catálogos</button></div>}
    {state.status === 'idle' && <p role="status">Selecciona una fecha y consulta la agenda.</p>}
    {state.status === 'loading' && <p role="status">Cargando agenda…</p>}
    {state.status === 'error' && <p role="alert">{state.error}</p>}
    {state.status === 'ready' && !state.items.length && <p role="status">No hay citas para los filtros consultados.</p>}
    {state.status === 'ready' && <ul className="catalog-list">{state.items.map(item => <li className="catalog-card" key={item.id}>
      <h2>{item.service.name}</h2>
      <p>Inicio: <time dateTime={item.startsAt}>{formatAgendaTime(item.startsAt, state.timeZone)}</time><br />Fin: <time dateTime={item.endsAt}>{formatAgendaTime(item.endsAt, state.timeZone)}</time></p>
      <p>Estado: <span className="catalog-status">{item.status.name} ({item.status.code})</span></p>
      <p>Sede: {item.branch.name}</p>
      <p>Profesional: {item.professional.firstNames} {item.professional.lastNames}{item.professional.titleOrFunction ? ` · ${item.professional.titleOrFunction}` : ''}</p>
      <p>Usuario atendido: {item.user.firstNames} {item.user.lastNames}</p>
      <p>Origen: {item.origin}</p>
    </li>)}</ul>}
  </section>;
}
