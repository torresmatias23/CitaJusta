import { useEffect, useState, useSyncExternalStore } from 'react';
import { InlineAlert } from '../components/ui/inline-alert';
import { StatusBadge } from '../components/ui/status-badge';
import type { UserProfile } from '@citajusta/client-core';
import { useAuth } from '../auth/auth-provider';
import { formatAgendaTime } from '../agenda/agenda-api';
import type { Named } from '../agenda/agenda-api';
import { createAvailabilityModel } from './availability-model';
import type { AvailabilityState } from './availability-model';
import { blockTypes } from './availability-api';
import type { Availability, BlockType, IntervalInput } from './availability-api';
import { institutionalInterval } from './institutional-time';

type Model = ReturnType<typeof createAvailabilityModel>;
export function AvailabilityPage() {
  const { user, status } = useAuth();
  if (status !== 'authenticated' || !user) return <p role="status">Se requiere una sesión verificada.</p>;
  if (!user.context.institutionId) return <p role="status">Aplica un contexto institucional en Sedes y servicios.</p>;
  return <Workspace key={JSON.stringify([user.id, user.context, user.permissions])} user={user} />;
}
function Workspace({ user }: { user: UserProfile }) {
  const { api } = useAuth();
  const [model] = useState(() => createAvailabilityModel(api, user));
  const state = useSyncExternalStore(model.subscribe, model.getSnapshot, model.getSnapshot);
  useEffect(() => { void model.activate(); return () => model.dispose(); }, [model]);
  return <AvailabilityView model={model} state={state} />;
}
function Options({ items }: { items: Named[] }) { return <>{items.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</>; }
function IntervalFields({ value, onChange }: { value: IntervalInput; onChange: (value: IntervalInput) => void }) {
  return <div className="catalog-fields">
    <label className="catalog-field">Fecha institucional<input type="date" required value={value.date} onChange={e => onChange({ ...value, date: e.target.value })} /></label>
    <label className="catalog-field">Hora inicio<input type="time" step="60" required value={value.startTime} onChange={e => onChange({ ...value, startTime: e.target.value })} /></label>
    <label className="catalog-field">Hora término<input type="time" step="60" required value={value.endTime} onChange={e => onChange({ ...value, endTime: e.target.value })} /></label>
  </div>;
}
export function AvailabilityView({ model, state }: { model: Model; state: AvailabilityState }) {
  const [form, setForm] = useState<'create' | 'block' | Availability | null>(null);
  return <section className="catalog-page" aria-label="Disponibilidad y bloqueos">
    <h2>Disponibilidad y bloqueos</h2><p>Zona institucional: {state.timeZone ?? 'pendiente de cargar'}. Las reglas y los cupos protegidos son controlados por la API.</p>
    {state.catalogStatus === 'loading' && <p role="status">Cargando catálogos y zona institucional…</p>}
    {state.catalogStatus === 'error' && <p role="alert">No pudimos cargar los catálogos. <button onClick={() => void model.loadCatalogs()}>Reintentar catálogos</button></p>}
    <div className="catalog-actions">
      {model.permissions.create && <button className="primary-button" disabled={state.busy || state.catalogStatus !== 'ready'} onClick={() => setForm('create')}>Crear disponibilidad</button>}
      {model.permissions.block && <button disabled={state.busy || state.catalogStatus !== 'ready'} onClick={() => setForm('block')}>Crear bloqueo</button>}
    </div>
    {state.feedback && <InlineAlert failed={state.failed}>{state.feedback}</InlineAlert>}
    {form && <AvailabilityEditor key={typeof form === 'string' ? form : form.id} model={model} state={state} mode={form} close={() => setForm(null)} />}
    {!model.permissions.read ? <p role="status">El listado requiere availability.read.</p> : <>
      <form className="catalog-context" aria-label="Filtros administrativos" onSubmit={e => { e.preventDefault(); void model.consult(); }}>
        <fieldset disabled={state.busy}><legend>Consulta administrativa</legend><div className="catalog-fields">
          <label className="catalog-field">Fecha<input name="date" type="date" required value={state.filters.date} onChange={e => { setForm(null); model.setFilters({ date: e.target.value }); }} /></label>
          <label className="catalog-field">Sede<select name="branchId" disabled={Boolean(model.branchContext)} value={state.filters.branchId ?? ''} onChange={e => { setForm(null); model.setFilters({ branchId: e.target.value }); }}>
            <option value="">Todas las sedes</option><Options items={state.catalogs.branches} />
            {model.branchContext && !state.catalogs.branches.some(b => b.id === model.branchContext) && <option value={model.branchContext}>Sede del contexto</option>}
          </select></label>
          <label className="catalog-field">Servicio (sólo disponibilidad)<select name="serviceId" value={state.filters.serviceId ?? ''} onChange={e => { setForm(null); model.setFilters({ serviceId: e.target.value }); }}><option value="">Todos</option><Options items={state.catalogs.services} /></select></label>
          <label className="catalog-field">Profesional<select name="professionalId" value={state.filters.professionalId ?? ''} onChange={e => { setForm(null); model.setFilters({ professionalId: e.target.value }); }}><option value="">Todos</option><Options items={state.catalogs.professionals} /></select></label>
        </div><button className="primary-button" disabled={state.status === 'loading'}>Consultar</button></fieldset>
      </form>
      {state.status === 'idle' && <p role="status">Selecciona una fecha para consultar.</p>}
      {state.status === 'loading' && <p role="status">Cargando disponibilidades y bloqueos…</p>}
      {state.status === 'error' && <p role="alert">{state.error}</p>}
      {state.status === 'ready' && <>
        <h3>Disponibilidades</h3>{!state.items.length && <p>No hay disponibilidades para los filtros.</p>}
        <ul className="catalog-list">{state.items.map(item => <li className="catalog-card" key={item.id}>
          <h3>{item.service.name}</h3><p>{item.date} · {item.startTime}–{item.endTime} · {item.timeZone}</p>
          <p>{item.branch.name} · {item.professional.firstNames} {item.professional.lastNames}</p>
          <p><StatusBadge code={item.active ? 'ACTIVE' : 'INACTIVE'}>{item.active ? 'Activa' : 'Inactiva'}</StatusBadge> · Origen: {item.origin}</p>
          {item.attentionPoint && <p>Punto de atención: {item.attentionPoint.name}</p>}
          {model.permissions.update && <div className="catalog-actions"><button disabled={state.busy || !state.timeZone} onClick={() => setForm(item)}>Editar horario / reactivar</button>
            {item.active && <button disabled={state.busy} onClick={() => { setForm(null); void model.deactivate(item); }}>Desactivar</button>}</div>}
        </li>)}</ul>
        <h3>Bloqueos</h3>{!state.blocks.length && <p>No hay bloqueos para los filtros.</p>}
        <ul className="catalog-list">{state.blocks.map(item => <li className="catalog-card" key={item.id}>
          <h3>{item.type}</h3><p>{formatAgendaTime(item.startsAt, state.timeZone)} – {formatAgendaTime(item.endsAt, state.timeZone)} ({state.timeZone ?? 'UTC'})</p>
          <p>{item.branch?.name ?? 'Institución'} · {item.professional ? `${item.professional.firstNames} ${item.professional.lastNames}` : 'Sin profesional específico'}</p>
          {item.attentionPoint && <p>Punto de atención: {item.attentionPoint.name}</p>}{item.reason && <p>{item.reason}</p>}
        </li>)}</ul>
      </>}
    </>}
  </section>;
}

export function AvailabilityEditor({ model, state, mode, close }: { model: Model; state: AvailabilityState; mode: 'create' | 'block' | Availability; close: () => void }) {
  const original = typeof mode === 'object' ? mode : null;
  const [branchId, setBranch] = useState(model.branchContext ?? '');
  const [serviceId, setService] = useState(''), [professionalId, setProfessional] = useState('');
  const [interval, setInterval] = useState<IntervalInput>(original ?? { date: state.filters.date, startTime: '', endTime: '' });
  const [reactivate, setReactivate] = useState(false), [type, setType] = useState<BlockType>('MANUAL'), [reason, setReason] = useState(''), [error, setError] = useState('');
  useEffect(() => { if (!original) void model.choose(branchId, mode === 'create' ? serviceId : undefined); }, [model, branchId, serviceId, mode, original]);
  const changed = !original || reactivate || original.date !== interval.date || original.startTime !== interval.startTime || original.endTime !== interval.endTime;
  return <form className="catalog-form" aria-label="Administrar horario" onSubmit={async e => {
    e.preventDefault(); setError('');
    if (!state.timeZone || state.busy) return;
    try { institutionalInterval(interval.date, interval.startTime, interval.endTime, state.timeZone); }
    catch { setError('Revisa el intervalo: la hora institucional puede ser inexistente o ambigua por cambio horario.'); return; }
    const ok = original ? await model.update(original, interval, reactivate) : mode === 'create' ? await model.create({ branchId, serviceId, professionalId, ...interval })
      : await model.block({ branchId, ...(professionalId ? { professionalId } : {}), ...interval, type, reason: reason.trim() || null });
    if (ok) close();
  }}>
    <fieldset disabled={state.busy}><legend>{original ? 'Editar disponibilidad' : mode === 'create' ? 'Nueva disponibilidad' : 'Nuevo bloqueo'}</legend>
      {original ? <p>Identidad fija: {original.branch.name} · {original.service.name} · {original.professional.firstNames} {original.professional.lastNames}{original.attentionPoint ? ` · ${original.attentionPoint.name}` : ''}</p> : <div className="catalog-fields">
        <label className="catalog-field">Sede<select required disabled={Boolean(model.branchContext)} value={branchId} onChange={e => { setBranch(e.target.value); setService(''); setProfessional(''); }}><option value="">Seleccionar sede</option><Options items={state.catalogs.branches} /></select></label>
        {mode === 'create' && <label className="catalog-field">Servicio<select required disabled={state.choicesStatus !== 'ready'} value={serviceId} onChange={e => { setService(e.target.value); setProfessional(''); }}><option value="">Seleccionar servicio</option><Options items={state.choices.services} /></select></label>}
        <label className="catalog-field">Profesional{mode === 'block' ? ' (opcional)' : ''}<select required={mode === 'create'} disabled={state.choicesStatus !== 'ready'} value={professionalId} onChange={e => setProfessional(e.target.value)}><option value="">{mode === 'block' ? 'Sin profesional específico' : 'Seleccionar profesional'}</option><Options items={mode === 'block' ? state.choices.branchProfessionals : state.choices.professionals} /></select></label>
      </div>}
      {!original && state.choicesStatus === 'error' && <p role="alert">No pudimos cargar las asociaciones. <button type="button" onClick={() => void model.choose(branchId, mode === 'create' ? serviceId : undefined)}>Reintentar</button></p>}
      <IntervalFields value={interval} onChange={setInterval} />
      {original && !original.active && <label className="catalog-check"><input type="checkbox" checked={reactivate} onChange={e => setReactivate(e.target.checked)} />Reactivar con este intervalo explícito</label>}
      {mode === 'block' && <div className="catalog-fields"><label className="catalog-field">Tipo<select value={type} onChange={e => { const value = blockTypes.find(v => v === e.target.value); if (value) setType(value); }}><Options items={blockTypes.map(value => ({ id: value, name: value }))} /></select></label>
        <label className="catalog-field">Motivo (opcional)<textarea maxLength={2000} value={reason} onChange={e => setReason(e.target.value)} /></label></div>}
      {error && <p role="alert">{error}</p>}
      <div className="catalog-actions"><button disabled={!changed || !state.timeZone || (!original && state.choicesStatus !== 'ready')}>Guardar</button><button type="button" onClick={close}>Cerrar formulario</button></div>
    </fieldset>
  </form>;
}
