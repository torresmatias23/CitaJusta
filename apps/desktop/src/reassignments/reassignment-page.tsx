import { useEffect, useState, useSyncExternalStore } from 'react';
import type { UserProfile } from '@citajusta/client-core';
import { useAuth } from '../auth/auth-provider';
import { StatusBadge } from '../components/ui/status-badge';
import { createReassignmentModel } from './reassignment-model';
import type { ReassignmentState } from './reassignment-model';
import type { Reassignment } from './reassignment-api';

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
  if (state.status === 'denied') return <p role="status">Acceso no disponible. Aplica un contexto institucional en Sedes y servicios y verifica el permiso reassignments.read.</p>;
  return <section className="catalog-page" aria-label="Supervisión de reasignaciones">
    <p>Consulta un proceso conocido. Vista de sólo lectura; el backend determina los estados, el ranking y la oferta activa.</p>
    <form className="catalog-context" aria-label="Consultar reasignación" onSubmit={event => { event.preventDefault(); void model.consult(); }}>
      <label className="catalog-field">Identificador del proceso<input name="reassignmentId" value={state.id} aria-describedby="process-help" onChange={event => model.setId(event.target.value)} /></label>
      <p id="process-help" className="field-help">Introduce el UUID del proceso. No existe un listado de procesos en esta pantalla.</p>
      <button className="primary-button" type="submit" disabled={state.status === 'loading'}>{state.status === 'loading' ? 'Consultando…' : 'Consultar proceso'}</button>
    </form>
    {state.status === 'idle' && <p role="status">Introduce un identificador para consultar el proceso.</p>}
    {state.status === 'loading' && <p role="status">Cargando proceso…</p>}
    {state.status === 'error' && <p role="alert">{state.error}</p>}
    {state.status === 'ready' && state.data && <ReassignmentDetail data={state.data} />}
  </section>;
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
