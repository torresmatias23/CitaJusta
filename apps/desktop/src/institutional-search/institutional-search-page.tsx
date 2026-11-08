import { useEffect, useState, useSyncExternalStore } from 'react';
import type { UserProfile } from '@citajusta/client-core';
import { useAuth } from '../auth/auth-provider';
import { InlineAlert } from '../components/ui/inline-alert';
import { searchPermissions } from './institutional-search-api';
import type { SearchResource, SearchRow } from './institutional-search-api';
import { createInstitutionalSearchModel } from './institutional-search-model';
import type { InstitutionalSearchState } from './institutional-search-model';

export function InstitutionalSearchPage({ resource }: { resource: SearchResource }) {
  const { status, user } = useAuth();
  if (status !== 'authenticated' || !user) return <p role="status">Se requiere una sesión verificada.</p>;
  return <Workspace key={JSON.stringify([resource, user.id, user.context, user.permissions])} resource={resource} user={user} />;
}
function Workspace({ resource, user }: { resource: SearchResource; user: UserProfile }) {
  const { api } = useAuth();
  const [model] = useState(() => createInstitutionalSearchModel(resource, api, user));
  const state = useSyncExternalStore(model.subscribe, model.getSnapshot, model.getSnapshot);
  useEffect(() => { void model.activate(); return () => model.dispose(); }, [model]);
  return <InstitutionalSearchView model={model} state={state} />;
}
export function InstitutionalSearchView({ model, state }: { model: ReturnType<typeof createInstitutionalSearchModel>; state: InstitutionalSearchState }) {
  if (state.status === 'denied') return <InlineAlert>Acceso no disponible. Aplica un contexto institucional en Sedes y servicios y verifica el permiso {searchPermissions[state.resource]}.</InlineAlert>;
  const users = state.resource === 'users', busy = state.status === 'loading' || state.loadingMore;
  return <section className="catalog-page" aria-label={users ? 'Usuarios institucionales' : 'Lista de espera institucional'}>
    <header><h2>{users ? 'Buscar usuarios de la institución' : 'Consultar lista de espera institucional'}</h2><p>Consulta de sólo lectura, limitada a la institución y sede autorizadas. Los filtros no amplían tu contexto.</p></header>
    <form className="catalog-context" aria-label="Filtros de consulta institucional" onSubmit={event => { event.preventDefault(); void model.consult(); }}>
      <div className="catalog-fields">
        {users ? <label className="catalog-field">Nombre o apellido (opcional)<input name="q" minLength={2} maxLength={120} value={state.filters.q ?? ''} onChange={event => model.setFilter('q', event.target.value)} aria-describedby="search-name-help" /><span id="search-name-help" className="field-help">Entre 2 y 120 caracteres. Sin texto se consultan los usuarios vinculados al contexto.</span></label> : <>
          <label className="catalog-field">Estado (opcional)<input name="status" maxLength={60} value={state.filters.status ?? ''} onChange={event => model.setFilter('status', event.target.value)} /><span className="field-help">Código del catálogo, por ejemplo ACTIVE. Vacío incluye todos los estados disponibles.</span></label>
          <label className="catalog-field">Servicio (opcional)<input name="serviceId" value={state.filters.serviceId ?? ''} onChange={event => model.setFilter('serviceId', event.target.value)} /><span className="field-help">UUID de un servicio del contexto. Vacío no filtra por servicio.</span></label>
          <label className="catalog-field">Usuario de la solicitud (opcional)<input name="userId" value={state.filters.userId ?? ''} onChange={event => model.setFilter('userId', event.target.value)} /><span className="field-help">UUID obtenido en Usuarios. Sólo filtra solicitudes visibles; no cambia la identidad autenticada.</span></label>
        </>}
        {state.branchContext ? <div className="catalog-field"><span>Sede del contexto (fija)</span><p>{state.branchContext}</p></div> :
          <label className="catalog-field">Sede (opcional)<select name="branchId" value={state.filters.branchId ?? ''} disabled={state.catalogStatus !== 'ready'} onChange={event => model.setFilter('branchId', event.target.value)}><option value="">Sin filtro de sede</option>{state.branches.map(branch => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label>}
      </div>
      {state.catalogStatus === 'loading' && <p role="status">Cargando sedes… Puedes consultar sin este filtro.</p>}
      {state.catalogStatus === 'error' && <p role="status">No se pudieron cargar las sedes. Puedes consultar sin este filtro.</p>}
      <p className="field-help">Páginas de hasta 50 registros. Las opciones de sede son ayudas de selección, no autorizaciones.</p>
      <button type="submit" className="primary-button" disabled={busy}>{state.status === 'loading' ? 'Consultando…' : users ? 'Consultar usuarios' : 'Consultar lista de espera'}</button>
    </form>
    {state.status === 'idle' && <p role="status">Aplica los filtros opcionales y consulta para cargar registros.</p>}
    {state.status === 'loading' && <p role="status">Cargando registros…</p>}
    {state.status === 'error' && <InlineAlert failed>{state.error}</InlineAlert>}
    {state.status === 'ready' && <>
      {!state.data.length && <p role="status">No se encontraron registros para los filtros y el contexto actuales.</p>}
      <ul className="catalog-list">{state.data.map(item => <li key={item.id}><InstitutionalSearchCard item={item} /></li>)}</ul>
      {state.moreError && <InlineAlert failed>{state.moreError} Los registros ya consultados se conservan.</InlineAlert>}
      {state.nextCursor !== null && <button type="button" className="primary-button" disabled={busy} onClick={() => { void model.loadMore(); }}>{state.loadingMore ? 'Cargando más registros…' : 'Cargar más'}</button>}
    </>}
  </section>;
}
export function InstitutionalSearchCard({ item }: { item: SearchRow }) {
  if (!('enteredAt' in item)) return <article className="catalog-card"><h3>{item.firstNames} {item.lastNames}</h3><p>Identificador de usuario: {item.id}</p></article>;
  return <article className="catalog-card"><h3>{item.service.name}</h3>
    <p>Solicitud: {item.id}</p><p>Usuario: {item.user.firstNames} {item.user.lastNames}</p><p>Identificador de usuario: {item.user.id}</p>
    <p>Estado: {item.status.name} ({item.status.code})</p><p>Sede: {item.branch?.name ?? 'Sin sede asociada'}</p>
    <p>Ingreso (UTC): <time dateTime={item.enteredAt}>{item.enteredAt}</time></p>
  </article>;
}
