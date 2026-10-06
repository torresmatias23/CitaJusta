import { useEffect, useState, useSyncExternalStore } from 'react';
import type { UserProfile } from '@citajusta/client-core';
import { useAuth } from '../auth/auth-provider';
import { InlineAlert } from '../components/ui/inline-alert';
import { StatusBadge } from '../components/ui/status-badge';
import { auditActions, auditResources } from './audit-api';
import type { AuditEvent } from './audit-api';
import { createAuditModel } from './audit-model';
import type { AuditState } from './audit-model';

const actionLabels: Record<typeof auditActions[number], string> = {
  AUTH_LOGIN_SUCCESS: 'Inicio de sesión exitoso', AUTH_LOGIN_FAILURE: 'Inicio de sesión fallido', AUTH_LOGOUT: 'Cierre de sesión', AUTH_GOOGLE_LINKED: 'Cuenta Google vinculada',
  GOOGLE_CALENDAR_EVENT_CREATED: 'Cita agregada a Google Calendar',
  APPOINTMENT_CREATED: 'Cita creada', APPOINTMENT_CANCELLED: 'Cita cancelada', ATTENDANCE_RECORDED: 'Asistencia registrada', NO_SHOW_RECORDED: 'Inasistencia registrada',
  OFFER_CREATED: 'Oferta creada', OFFER_ACCEPTED: 'Oferta aceptada', OFFER_REJECTED: 'Oferta rechazada', OFFER_EXPIRED: 'Oferta expirada',
  REASSIGNMENT_STARTED: 'Reasignación iniciada', REASSIGNMENT_COMPLETED: 'Reasignación completada', REASSIGNMENT_EXHAUSTED: 'Reasignación agotada',
  BRANCH_CREATED: 'Sede creada', BRANCH_UPDATED: 'Sede actualizada', SERVICE_CREATED: 'Servicio creado', SERVICE_UPDATED: 'Servicio actualizado',
  PROFESSIONAL_CREATED: 'Profesional creado', PROFESSIONAL_UPDATED: 'Profesional actualizado', AVAILABILITY_CREATED: 'Disponibilidad creada', AVAILABILITY_UPDATED: 'Disponibilidad actualizada',
  SCHEDULE_BLOCK_CREATED: 'Bloqueo de agenda creado', REASSIGNMENT_POLICY_VERSION_CREATED: 'Versión de política de reasignación creada',
};
export function AuditPage() {
  const { user, status } = useAuth();
  if (status !== 'authenticated' || !user) return <p role="status">Se requiere una sesión verificada.</p>;
  return <Workspace key={JSON.stringify([user.id, user.context, user.permissions])} user={user} />;
}
function Workspace({ user }: { user: UserProfile }) {
  const { api } = useAuth();
  const [model] = useState(() => createAuditModel(api, user));
  const state = useSyncExternalStore(model.subscribe, model.getSnapshot, model.getSnapshot);
  useEffect(() => { void model.activate(); return () => model.dispose(); }, [model]);
  return <AuditView model={model} state={state} />;
}
export function AuditView({ model, state }: { model: ReturnType<typeof createAuditModel>; state: AuditState }) {
  if (state.status === 'denied') return <InlineAlert>Acceso no disponible. Aplica un contexto institucional en Sedes y servicios y verifica el permiso audit.read.</InlineAlert>;
  const busy = state.status === 'loading' || state.loadingMore;
  return <section className="catalog-page" aria-label="Auditoría institucional">
    <header><h2>Auditoría institucional</h2><p>Consulta de sólo lectura de eventos registrados por CitaJusta dentro del ámbito autorizado.</p></header>
    <form className="catalog-context" aria-label="Consultar eventos de auditoría" onSubmit={event => { event.preventDefault(); void model.consult(); }}>
      <div className="catalog-fields">
        <label className="catalog-field">Desde (opcional)<input type="date" name="from" value={state.filters.from ?? ''} onChange={event => model.setFilter('from', event.target.value)} aria-describedby="audit-dates-help" /></label>
        <label className="catalog-field">Hasta (opcional)<input type="date" name="to" value={state.filters.to ?? ''} onChange={event => model.setFilter('to', event.target.value)} aria-describedby="audit-dates-help" /></label>
        {state.branchContext ? <div className="catalog-field"><span>Sede del contexto (fija)</span><code className="audit-id">{state.branchContext}</code></div> :
          <label className="catalog-field">Sede (opcional)<select name="branchId" disabled={state.catalogStatus !== 'ready'} value={state.filters.branchId ?? ''} onChange={event => model.setFilter('branchId', event.target.value)}><option value="">Todas las sedes del contexto</option>{state.branches.map(branch => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label>}
        <label className="catalog-field">Usuario actor (opcional)<input name="actorUserId" value={state.filters.actorUserId ?? ''} onChange={event => model.setFilter('actorUserId', event.target.value)} aria-describedby="audit-actor-help" /><span id="audit-actor-help" className="field-help">UUID del usuario actor. Los eventos del sistema pueden no tener usuario asociado.</span></label>
        <label className="catalog-field">Acción (opcional)<select name="action" value={state.filters.action ?? ''} onChange={event => model.setFilter('action', event.target.value)}><option value="">Todas las acciones</option>{auditActions.map(action => <option value={action} key={action}>{actionLabels[action]} · {action}</option>)}</select></label>
        <label className="catalog-field">Tipo de recurso (opcional)<select name="resourceType" value={state.filters.resourceType ?? ''} onChange={event => model.setFilter('resourceType', event.target.value)}><option value="">Todos los tipos</option>{auditResources.map(resource => <option value={resource} key={resource}>{resource}</option>)}</select></label>
      </div>
      <p id="audit-dates-help" className="field-help">Fechas civiles inclusivas, interpretadas por la API según la zona horaria institucional. Puedes usar una, ambas o ninguna.</p>
      {state.catalogStatus === 'loading' && <p role="status">Cargando sedes… Puedes consultar sin este filtro.</p>}
      {state.catalogStatus === 'error' && <p role="status">No se pudieron cargar las sedes. Puedes consultar eventos sin el filtro opcional de sede.</p>}
      <button type="submit" className="primary-button" disabled={busy}>{state.status === 'loading' ? 'Consultando…' : 'Consultar eventos'}</button>
    </form>
    {state.status === 'idle' && <p role="status">Consulta los eventos del contexto actual, con o sin filtros.</p>}
    {state.status === 'loading' && <p role="status">Cargando eventos…</p>}
    {state.status === 'error' && <InlineAlert failed>{state.error}</InlineAlert>}
    {state.status === 'ready' && <section className="catalog-section" aria-label="Eventos registrados" aria-busy={state.loadingMore}>
      <h2>Eventos registrados</h2>
      <p className="field-help">Orden del servidor: más recientes primero. Instantes ISO UTC; sin nombres de actores o recursos añadidos. Hasta 50 eventos por consulta.</p>
      {!state.data.length && <InlineAlert>No se encontraron eventos para los filtros seleccionados.</InlineAlert>}
      <ol className="audit-events">{state.data.map(row => <li key={row.id}><AuditEventCard event={row} /></li>)}</ol>
      {state.moreError && <InlineAlert failed>{state.moreError} Los eventos ya consultados se conservan.</InlineAlert>}
      {state.loadingMore && <p role="status">Cargando más eventos…</p>}
      {state.nextCursor !== null && <button type="button" className="primary-button" disabled={state.loadingMore} onClick={() => { void model.loadMore(); }}>{state.loadingMore ? 'Cargando…' : 'Cargar más'}</button>}
    </section>}
  </section>;
}
export function AuditEventCard({ event: row }: { event: AuditEvent }) {
  return <article className="catalog-card audit-event">
    <div className="catalog-heading"><h3>{actionLabels[row.actionCode]}</h3><StatusBadge code={row.outcome}>{row.outcome === 'SUCCESS' ? 'Éxito' : 'Fallo'} · {row.outcome}</StatusBadge></div>
    <code className="field-help">{row.actionCode}</code>
    <dl className="catalog-fields supervision-fields">
      <div><dt>Fecha/hora (UTC)</dt><dd><time dateTime={row.occurredAt}>{row.occurredAt}</time></dd></div>
      <div><dt>Actor</dt><dd>{row.actorType === 'SYSTEM' ? 'Sistema · SYSTEM' : 'Usuario · USER'}{row.actorUserId && <code className="audit-id">{row.actorUserId}</code>}</dd></div>
      <div><dt>Recurso</dt><dd>{row.resourceType}{row.resourceId && <code className="audit-id">{row.resourceId}</code>}</dd></div>
      {(row.previousState !== null || row.newState !== null) && <div><dt>Transición registrada</dt><dd>{row.previousState ?? 'Sin estado anterior'} → {row.newState ?? 'Sin estado nuevo'}</dd></div>}
      {row.reasonCode && <div><dt>Motivo</dt><dd><code className="audit-id">{row.reasonCode}</code></dd></div>}
    </dl>
    <details><summary>Identificadores del evento</summary><dl className="catalog-fields supervision-fields">
      <div><dt>Evento</dt><dd className="audit-id">{row.id}</dd></div>
      <div><dt>Institución</dt><dd className="audit-id">{row.institutionId ?? 'No registrada'}</dd></div>
      <div><dt>Sede</dt><dd className="audit-id">{row.branchId ?? 'No registrada'}</dd></div>
    </dl></details>
  </article>;
}
