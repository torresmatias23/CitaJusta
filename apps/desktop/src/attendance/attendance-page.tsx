import { useEffect, useState, useSyncExternalStore } from 'react';
import type { UserProfile } from '@citajusta/client-core';
import { useAuth } from '../auth/auth-provider';
import { formatAgendaTime } from '../agenda/agenda-api';
import { createAttendanceModel } from './attendance-model';
import type { AttendanceState } from './attendance-model';

export function AttendancePage() {
  const { user, status } = useAuth();
  if (status !== 'authenticated' || !user) return <p role="status">Se requiere una sesión verificada.</p>;
  return <AttendanceWorkspace key={JSON.stringify([user.id, user.context, user.permissions])} user={user} />;
}
function AttendanceWorkspace({ user }: { user: UserProfile }) {
  const { api } = useAuth();
  const [model] = useState(() => createAttendanceModel(api, user));
  const state = useSyncExternalStore(model.subscribe, model.getSnapshot, model.getSnapshot);
  useEffect(() => { void model.activate(); return () => model.dispose(); }, [model]);
  return <AttendanceView model={model} state={state} />;
}
export function AttendanceView({ model, state }: { model: ReturnType<typeof createAttendanceModel>; state: AttendanceState }) {
  const { agenda } = state, busy = state.busyId !== null;
  if (agenda.status === 'denied') return <p role="status">Acceso no disponible. Aplica un contexto institucional en Sedes y servicios y verifica el permiso agenda.read.</p>;
  return <section className="catalog-page" aria-label="Registro de asistencia institucional">
    <p>Consulta citas y registra su resultado. La API valida el estado y los permisos antes de guardar.</p>
    {!model.permissions.record && <p role="status">Modo de sólo lectura. Registrar resultados requiere appointments.attendance.</p>}
    <form className="catalog-context" aria-label="Filtros de asistencia" onSubmit={event => { event.preventDefault(); void model.consult(); }}>
      <fieldset disabled={busy}><legend>Buscar citas</legend><div className="catalog-fields">
        <label className="catalog-field">Fecha institucional<input name="date" type="date" required value={agenda.filters.date} onChange={e => model.setFilters({ date: e.target.value })} /></label>
        <label className="catalog-field">Sede<select name="branchId" disabled={Boolean(model.branchContext)} value={agenda.filters.branchId ?? ''} onChange={e => model.setFilters({ branchId: e.target.value })}>
          {!model.branchContext && <option value="">Todas las sedes del contexto</option>}
          {model.branchContext && !agenda.catalogs.branches.some(item => item.id === model.branchContext) && <option value={model.branchContext}>Sede del contexto (fija)</option>}
          {agenda.catalogs.branches.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select></label>
        <label className="catalog-field">Servicio<select name="serviceId" value={agenda.filters.serviceId ?? ''} onChange={e => model.setFilters({ serviceId: e.target.value })}><option value="">Todos los servicios</option>{agenda.catalogs.services.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label className="catalog-field">Profesional<select name="professionalId" value={agenda.filters.professionalId ?? ''} onChange={e => model.setFilters({ professionalId: e.target.value })}><option value="">Todos los profesionales</option>{agenda.catalogs.professionals.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label className="catalog-field">Estado (código exacto)<input name="status" maxLength={60} placeholder="Ej.: AGENDADA, ATENDIDA" value={agenda.filters.status ?? ''} onChange={e => model.setFilters({ status: e.target.value })} /></label>
      </div><button type="submit" disabled={!agenda.filters.date || agenda.status === 'loading'}>Consultar citas</button></fieldset>
    </form>
    <p>Horarios mostrados en {agenda.timeZone ?? 'UTC'}{agenda.zoneStatus !== 'ready' ? ' (zona institucional no disponible; el día consultado sigue definido por la API)' : ''}.</p>
    {agenda.catalogStatus === 'loading' && <p role="status">Cargando opciones de filtros…</p>}
    {(agenda.catalogStatus === 'error' || agenda.zoneStatus === 'error') && <div role="alert"><p>No pudimos cargar todas las ayudas o la zona. Puedes consultar por fecha.</p><button type="button" onClick={() => void model.reloadCatalogs()}>Reintentar catálogos</button></div>}
    {state.feedback && <p role={state.failed ? 'alert' : 'status'}>{state.feedback}</p>}
    {busy && <p role="status">Guardando resultado…</p>}
    {agenda.status === 'idle' && <p role="status">Selecciona una fecha para consultar citas.</p>}
    {agenda.status === 'loading' && <p role="status">Cargando citas…</p>}
    {agenda.status === 'error' && <p role="alert">{agenda.error}</p>}
    {agenda.status === 'ready' && !agenda.items.length && <p role="status">No hay citas para los filtros consultados.</p>}
    {agenda.status === 'ready' && <ul className="catalog-list">{agenda.items.map(item => <li className="catalog-card" key={item.id}>
      <h2>{item.service.name}</h2>
      <p>Inicio: <time dateTime={item.startsAt}>{formatAgendaTime(item.startsAt, agenda.timeZone)}</time><br />Fin: <time dateTime={item.endsAt}>{formatAgendaTime(item.endsAt, agenda.timeZone)}</time></p>
      <p>Estado: <span className="catalog-status">{item.status.name} ({item.status.code})</span></p>
      <p>Sede: {item.branch.name}</p><p>Profesional: {item.professional.firstNames} {item.professional.lastNames}</p>
      <p>Usuario atendido: {item.user.firstNames} {item.user.lastNames}</p>
      {model.canRecord(item) && <div className="catalog-actions" role="group" aria-label={`Resultado de ${item.user.firstNames} ${item.user.lastNames}`}>
        <button type="button" disabled={busy} onClick={() => void model.record(item.id, 'ATENDIDA')}>Registrar atendida</button>
        <button type="button" disabled={busy} onClick={() => void model.record(item.id, 'INASISTENCIA')}>Registrar inasistencia</button>
      </div>}
    </li>)}</ul>}
  </section>;
}
