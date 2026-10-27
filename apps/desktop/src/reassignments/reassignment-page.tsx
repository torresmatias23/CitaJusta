import { useEffect, useState, useSyncExternalStore } from 'react';
import type { UserProfile } from '@citajusta/client-core';
import { useAuth } from '../auth/auth-provider';
import { InlineAlert } from '../components/ui/inline-alert';
import { StatusBadge } from '../components/ui/status-badge';
import { reassignmentStatuses } from './reassignment-api';
import { createReassignmentModel } from './reassignment-model';
import type { ReassignmentState } from './reassignment-model';
import type { Reassignment, ReassignmentListing } from './reassignment-api';

type Value = string | number | boolean | null | undefined;
function Fields({ rows }: { rows: [string, Value][] }) {
  return <dl className="catalog-fields supervision-fields">{rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value === null || value === undefined ? 'No registrado' : typeof value === 'boolean' ? (value ? 'Sí' : 'No') : value}</dd></div>)}</dl>;
}
export function ReassignmentPage() {
  const { user, status } = useAuth();
  if (status !== 'authenticated' || !user) return <p role="status">Se requiere una sesión verificada.</p>;
  return <Workspace key={JSON.stringify([user.id, user.context, user.permissions])} user={user} />;
}
function Workspace({ user }: { user: UserProfile }) {
  const { api } = useAuth();
  const [model] = useState(() => createReassignmentModel(api, user));
  const state = useSyncExternalStore(model.subscribe, model.getSnapshot, model.getSnapshot);
  useEffect(() => { model.activate(); return () => model.dispose(); }, [model]);
  return <ReassignmentView model={model} state={state} />;
}
export function ReassignmentView({ model, state }: { model: ReturnType<typeof createReassignmentModel>; state: ReassignmentState }) {
  if (state.status === 'denied') return <InlineAlert>Acceso no disponible. Aplica un contexto institucional y verifica el permiso reassignments.read.</InlineAlert>;
  const busy = state.status === 'loading' || state.loadingMore;
  return <section className="catalog-page" aria-label="Supervisión de reasignaciones">
    <header><h2>Reasignaciones institucionales</h2><p>Vista de solo lectura. El backend determina estados, ranking, ofertas y alcance institucional.</p></header>
    <label className="catalog-field">Estado
      <select name="status" value={state.filter ?? ''} disabled={busy} onChange={event => model.setFilter(event.target.value)}>
        <option value="">Todos los estados</option>{reassignmentStatuses.map(status => <option value={status} key={status}>{status}</option>)}
      </select>
    </label>
    {state.status === 'idle' && <p role="status">Preparando el listado de reasignaciones…</p>}
    {state.status === 'loading' && <p role="status">Cargando reasignaciones…</p>}
    {state.status === 'error' && <InlineAlert failed>{state.error}</InlineAlert>}
    {state.status === 'ready' && <section className="catalog-section" aria-label="Procesos de reasignación" aria-busy={state.loadingMore}>
      <p className="field-help">Orden del servidor: detección más reciente primero. Los horarios y fechas se muestran en ISO UTC.</p>
      {!state.data.length && <InlineAlert>No se encontraron reasignaciones para el estado seleccionado.</InlineAlert>}
      <ol className="catalog-list">{state.data.map(row => <li key={row.id}><ReassignmentListingCard row={row} disabled={state.detailStatus === 'loading'} open={() => { void model.openDetail(row.id); }} /></li>)}</ol>
      {state.moreError && <InlineAlert failed>{state.moreError} Los resultados ya consultados se conservan.</InlineAlert>}
      {state.loadingMore && <p role="status">Cargando más reasignaciones…</p>}
      {state.nextCursor !== null && <button type="button" className="primary-button" disabled={state.loadingMore} onClick={() => { void model.loadMore(); }}>{state.loadingMore ? 'Cargando…' : 'Cargar más'}</button>}
    </section>}
    {state.detailStatus === 'loading' && <p role="status">Cargando detalle del proceso…</p>}
    {state.detailStatus === 'error' && <InlineAlert failed>{state.detailError}</InlineAlert>}
    {state.detailStatus === 'ready' && state.detail && <section className="catalog-section" aria-label="Detalle de reasignación"><button type="button" onClick={() => model.closeDetail()}>Cerrar detalle</button><ReassignmentDetail data={state.detail} /></section>}
  </section>;
}
export function ReassignmentListingCard({ row, disabled, open }: { row: ReassignmentListing; disabled: boolean; open: () => void }) {
  return <article className="catalog-card">
    <div className="catalog-heading"><h3>{row.service.name}</h3><StatusBadge code={row.status}>{row.status}</StatusBadge></div>
    <p>Sede: {row.branch.name}</p>
    <dl className="catalog-fields supervision-fields">
      <div><dt>Horario (UTC)</dt><dd><time dateTime={row.agendaSlot.startsAt}>{row.agendaSlot.startsAt}</time> — <time dateTime={row.agendaSlot.endsAt}>{row.agendaSlot.endsAt}</time></dd></div>
      <div><dt>Detectada (UTC)</dt><dd><time dateTime={row.detectedAt}>{row.detectedAt}</time></dd></div>
    </dl>
    <button type="button" disabled={disabled} onClick={open}>Abrir detalle</button>
  </article>;
}
export function ReassignmentDetail({ data: d }: { data: Reassignment }) {
  const criteria = d.evaluation.criteriaSnapshot;
  return <div className="supervision-result">
    <p className="field-help">Fechas y horarios en ISO UTC. Observación del servidor: <time dateTime={d.observedAt}>{d.observedAt}</time>. Consulta nuevamente para actualizar.</p>
    <section className="catalog-section" aria-label="Resumen del proceso">
      <div className="catalog-heading"><h2>{d.service.name}</h2><StatusBadge code={d.status}>{d.status}</StatusBadge></div>
      <p>{d.institution.name} · {d.branch.name}</p>
      <p><time dateTime={d.agendaSlot.startsAt}>{d.agendaSlot.startsAt}</time> — <time dateTime={d.agendaSlot.endsAt}>{d.agendaSlot.endsAt}</time></p>
      <h3>Política registrada</h3>
      {d.policy ? <Fields rows={[
        ['Versión', d.policy.version], ['Estrategia de ranking', d.policy.rankingStrategy], ['Duración de oferta (minutos)', d.policy.offerTtlMinutes],
      ]} /> : <p>Proceso legado / sin política versionada registrada</p>}
      <details><summary>Identificadores del proceso</summary><Fields rows={[
        ['Proceso', d.id], ['Institución', d.institution.id], ['Sede', d.branch.id], ['Servicio', d.service.id], ['Política', d.policy?.id],
      ]} /></details>
    </section>
    <section className="catalog-section" aria-label="Estado operativo"><h2>Estado operativo</h2>
      <Fields rows={[
        ['Estado del cupo', d.agendaSlot.status], ['Estado de la cita', d.appointment.status], ['Origen de cita', d.appointment.origin],
        ['Inicio de cita', d.appointment.startsAt], ['Término de cita', d.appointment.endsAt], ['Cancelación original', d.originCancellation.cancelledAt], ['Motivo de cierre', d.closureReasonCode],
      ]} />
      <details><summary>Versiones e identificadores</summary><Fields rows={[
        ['Cupo', d.agendaSlot.id], ['Versión del cupo', d.agendaSlot.lockVersion], ['Cita', d.appointment.id], ['Usuario actual de cita', d.appointment.currentUserId],
        ['Cancelación', d.originCancellation.id], ['Actor de cancelación', d.originCancellation.actorUserId], ['Versión inicial del cupo', d.initialSlotVersion], ['Versión del proceso', d.lockVersion],
      ]} /></details>
    </section>
    <section className="catalog-section" aria-label="Evaluación"><h2>Evaluación registrada</h2>
      <Fields rows={[
        ['Regla', d.evaluation.ruleCode], ['Versión de scoring', d.evaluation.scoringVersion], ['Inicio', d.evaluation.initiation.kind], ['Actor de inicio', d.evaluation.initiation.actorUserId],
      ]} />
      <details><summary>Criterios registrados</summary><Fields rows={[
        ['Zona horaria', criteria.timeZone], ['Inicio', criteria.startsAt], ['Término', criteria.endsAt], ['Sede', criteria.branchId], ['Profesional', criteria.professionalId],
        ['Duración oferta (minutos)', criteria.offerTtlMinutes], ['Actor', criteria.actorUserId], ['Preferencias vacías', criteria.emptyPreferences], ['Días explícitos prevalecen sobre fin de semana', criteria.explicitDaysOverrideWeekendFlag],
      ]} /></details>
    </section>
    <section className="catalog-section" aria-label="Candidatos"><h2>Candidatos</h2>
      {!d.candidates.length && <p>No hay candidatos registrados.</p>}
      <ol className="catalog-list">{d.candidates.map(c => {
        const context = c.snapshot.evaluationContext, prefs = context.preferences;
        return <li className="catalog-card" key={c.id}>
          <div className="catalog-heading"><h3>Posición: {c.rankingPosition ?? 'Sin posición'}</h3><StatusBadge code={c.evaluationStatus}>{c.evaluationStatus}</StatusBadge></div>
          <Fields rows={[
            ['Destinatario', c.recipient.id], ['Entrada de espera', c.waitlistEntryId], ['Motivo de exclusión', c.exclusionReasonCode], ['Evaluado', c.evaluatedAt],
            ['Nivel de prioridad', c.snapshot.priorityLevel], ['Score registrado', c.snapshot.totalScore],
          ]} />
          <details><summary>Detalle de evaluación del candidato</summary>
            <Fields rows={[
              ['Candidato', c.id], ['Creado', c.createdAt], ['Entrada actualizada', c.snapshot.entryUpdatedAt], ['Estado de entrada', context.statusCode], ['Ingreso', context.enteredAt],
              ['Sede', context.branchId], ['Sedes preferidas', context.preferredBranchIds?.join(', ')], ['Otras sedes', context.allowsOtherBranches], ['Aviso mínimo (minutos)', context.minimumNoticeMinutes],
              ['Fecha límite', context.deadlineDate], ['Prioridad', context.priorityCode], ['Prioridad activa', context.priorityActive],
            ]} />
            <h4>Factores registrados</h4>{!c.snapshot.scoreFactors.length && <p>Sin factores registrados.</p>}
            <ul>{c.snapshot.scoreFactors.map((factor, index) => <li key={index}>{factor.code}: {factor.value}</li>)}</ul>
            <h4>Preferencias registradas</h4>{prefs ? <>
              <Fields rows={[
                ['Cualquier profesional', prefs.acceptsAnyProfessional], ['Cualquier horario', prefs.acceptsAnyTime], ['Fin de semana', prefs.acceptsWeekend], ['Días (valores registrados)', prefs.preferredDays.join(', ')],
              ]} />
              <ul>{prefs.timeRanges.map((range, index) => <li key={index}>{range.start} — {range.end}</li>)}</ul>
            </> : <p>Sin preferencias registradas.</p>}
          </details>
        </li>;
      })}</ol>
    </section>
    <section className="catalog-section" aria-label="Ofertas"><h2>Ofertas</h2>
      {!d.activeOfferId && <p>No hay oferta activa según la observación del servidor.</p>}
      <details><summary>Referencias de ofertas del servidor</summary><Fields rows={[
        ['Oferta PENDING persistida', d.pendingOfferId], ['Oferta activa', d.activeOfferId],
      ]} /></details>
      {!d.offers.length && <p>No hay ofertas registradas.</p>}
      <ol className="catalog-list">{d.offers.map(o => <li className={`catalog-card ${o.id === d.activeOfferId ? 'supervision-active-offer' : ''}`} key={o.id}>
        <div className="catalog-heading"><h3>Intento {o.attemptNumber}</h3><StatusBadge code={o.status}>{o.status}</StatusBadge></div>
        {o.id === d.activeOfferId && <p>Oferta activa según el servidor</p>}
        {o.id === d.pendingOfferId && <p>Oferta PENDING persistida</p>}
        <Fields rows={[
          ['Destinatario', o.recipient.id], ['Creación', o.createdAt], ['Expiración', o.expiresAt], ['Respuesta', o.respondedAt], ['Resolución', o.resolvedAt], ['Motivo de resolución', o.resolutionReasonCode],
        ]} />
        <details><summary>Trazabilidad de oferta</summary><Fields rows={[
          ['Oferta', o.id], ['Candidato', o.candidateId], ['Versión esperada del cupo', o.expectedSlotVersion], ['Versión de oferta', o.lockVersion], ['Actor de respuesta', o.respondedByUserId],
        ]} /></details>
      </li>)}</ol>
    </section>
    <section className="catalog-section"><details><summary>Metadata y trazabilidad del proceso</summary><Fields rows={[
      ['Detectado', d.detectedAt], ['Iniciado', d.startedAt], ['Finalizado', d.finishedAt], ['Creado', d.createdAt], ['Actualizado', d.updatedAt], ['Observado por servidor', d.observedAt],
    ]} /></details></section>
  </div>;
}
