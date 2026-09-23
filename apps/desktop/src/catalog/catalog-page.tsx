import { useEffect, useState, useSyncExternalStore } from 'react';
import type { UserProfile } from '@citajusta/client-core';
import { useAuth } from '../auth/auth-provider';
import { catalogError, uuidPattern } from './catalog-api';
import type { Branch, Service } from './catalog-api';
import { createCatalogModel } from './catalog-model';
import type { Resource } from './catalog-model';
import { BranchForm, ServiceForm } from './catalog-forms';

export function CatalogPage() {
  const auth = useAuth();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const user = auth.user;
  if (!user) return null;
  const key = JSON.stringify([user.id, user.context, user.permissions]);
  return <div className="catalog-page">
    <form className="catalog-context" aria-label="Contexto institucional" onSubmit={async (event) => {
      event.preventDefault(); if (busy) return;
      const data = new FormData(event.currentTarget);
      const institutionId = String(data.get('institutionId') ?? '').trim();
      const branchId = String(data.get('branchId') ?? '').trim();
      if (!uuidPattern.test(institutionId) || (branchId && !uuidPattern.test(branchId))) { setError('Introduce identificadores UUID válidos.'); return; }
      setBusy(true); setError('');
      try { await auth.selectContext({ institutionId, ...(branchId ? { branchId } : {}) }); }
      catch (failure) { setError(catalogError(failure)); }
      finally { setBusy(false); }
    }}>
      <p>Selecciona el contexto facilitado por tu administrador. La API verificará tus permisos.</p>
      <div className="catalog-fields">
        <label className="catalog-field">Institución (UUID)<input name="institutionId" required defaultValue={user.context.institutionId} disabled={busy} /></label>
        <label className="catalog-field">Sede (UUID, opcional)<input name="branchId" defaultValue={user.context.branchId} disabled={busy} /></label>
      </div>
      <button type="submit" disabled={busy}>{busy ? 'Verificando…' : 'Aplicar contexto'}</button>
      {error && <p role="alert">{error}</p>}
    </form>
    {busy ? <p role="status">Verificando contexto institucional…</p> : <CatalogWorkspace key={key} user={user} />}
  </div>;
}
function CatalogWorkspace({ user }: { user: UserProfile }) {
  const { api } = useAuth();
  const [model] = useState(() => createCatalogModel(api, user));
  const state = useSyncExternalStore(model.subscribe, model.getSnapshot, model.getSnapshot);
  useEffect(() => { void model.activate(); return () => model.dispose(); }, [model]);
  return <CatalogView model={model} state={state} />;
}
function ResourceState<T>({ resource, retry }: { resource: Resource<T>; retry: () => void }) {
  if (resource.status === 'loading') return <p role="status">Cargando catálogo…</p>;
  if (resource.status === 'denied') return <p role="status">Acceso no disponible en el contexto actual. Se requiere permiso de lectura administrativa.</p>;
  if (resource.status === 'error') return <div role="alert"><p>{resource.error}</p><button onClick={retry} type="button">Reintentar</button></div>;
  if (!resource.items.length) return <p role="status">No hay registros en este catálogo.</p>;
  return null;
}
function Status({ active }: { active: boolean }) { return <span className={`catalog-status ${active ? 'is-active' : ''}`}>{active ? 'Activo' : 'Inactivo'}</span>; }
export function CatalogView({ model, state }: { model: ReturnType<typeof createCatalogModel>; state: ReturnType<ReturnType<typeof createCatalogModel>['getSnapshot']> }) {
  const [branchEditor, setBranchEditor] = useState<Branch | 'new' | null>(null);
  const [serviceEditor, setServiceEditor] = useState<Service | 'new' | null>(null);
  const permissions = model.permissions;
  return <div>
    {state.feedback && <p role={state.failed ? 'alert' : 'status'}>{state.feedback}</p>}
    <button type="button" disabled={state.busy} onClick={() => { setBranchEditor(null); setServiceEditor(null); void model.reload(); }}>Actualizar catálogo</button>
    <section className="catalog-section" aria-labelledby="branches-title">
      <div className="catalog-heading"><h2 id="branches-title">Sedes</h2>
        {permissions.createBranch && <button type="button" disabled={state.busy || state.branches.status !== 'ready'} onClick={() => setBranchEditor('new')}>Crear sede</button>}
      </div>
      <ResourceState resource={state.branches} retry={() => { void model.reload(); }} />
      <ul className="catalog-list">{state.branches.items.map((b) => <li key={b.id} className="catalog-card">
        <div><h3>{b.name}</h3><span>{b.code}</span> <Status active={b.status === 'ACTIVE'} /></div>
        <p>{[b.addressLine1, b.addressLine2, b.municipality, b.region, b.country].filter(Boolean).join(', ')}</p>
        {b.phone && <p>Teléfono: {b.phone}</p>}{b.email && <p>Correo: {b.email}</p>}
        {permissions.updateBranch && <div className="catalog-actions">
          <button type="button" disabled={state.busy} aria-label={`Editar sede ${b.name}`} onClick={() => setBranchEditor(b)}>Editar</button>
          <button type="button" disabled={state.busy} aria-label={`${b.status === 'ACTIVE' ? 'Inactivar' : 'Activar'} sede ${b.name}`}
            onClick={() => { setBranchEditor(null); void model.saveBranch(b.id, { status: b.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE' }); }}>{b.status === 'ACTIVE' ? 'Inactivar' : 'Activar'}</button>
        </div>}
      </li>)}</ul>
      {branchEditor && state.branches.status === 'ready' && <BranchForm key={branchEditor === 'new' ? 'new' : branchEditor.id}
        item={branchEditor === 'new' ? undefined : branchEditor} busy={state.busy} close={() => setBranchEditor(null)}
        save={(data) => model.saveBranch(branchEditor === 'new' ? undefined : branchEditor.id, data)} />}
    </section>
    <section className="catalog-section" aria-labelledby="services-title">
      <div className="catalog-heading"><h2 id="services-title">Servicios</h2>
        {permissions.createService && <button type="button" disabled={state.busy || state.services.status !== 'ready'} onClick={() => setServiceEditor('new')}>Crear servicio</button>}
      </div>
      <ResourceState resource={state.services} retry={() => { void model.reload(); }} />
      <ul className="catalog-list">{state.services.items.map((s) => <li key={s.id} className="catalog-card">
        <div><h3>{s.name}</h3><span>{s.code}</span> <Status active={s.active} /></div>
        {s.description && <p>{s.description.length > 180 ? `${s.description.slice(0, 180)}…` : s.description}</p>}
        <p>Duración: {s.durationMinutes} minutos · Categoría: {state.categories.find((c) => c.id === s.categoryId)?.name ?? (s.categoryId ? 'No disponible' : 'Sin categoría')}</p>
        <p>Sedes: {s.branchIds.map((id) => state.branches.items.find((b) => b.id === id)?.name ?? 'Sede asociada no disponible').join(', ') || 'Sin sedes asociadas'}</p>
        {permissions.updateService && <div className="catalog-actions">
          <button type="button" disabled={state.busy} aria-label={`Editar servicio ${s.name}`} onClick={() => setServiceEditor(s)}>Editar</button>
          <button type="button" disabled={state.busy} aria-label={`${s.active ? 'Inactivar' : 'Activar'} servicio ${s.name}`}
            onClick={() => { setServiceEditor(null); void model.saveService(s.id, { active: !s.active }); }}>{s.active ? 'Inactivar' : 'Activar'}</button>
        </div>}
      </li>)}</ul>
      {serviceEditor && state.services.status === 'ready' && <ServiceForm key={serviceEditor === 'new' ? 'new' : serviceEditor.id}
        item={serviceEditor === 'new' ? undefined : serviceEditor} branches={state.branches.items} categories={state.categories}
        canSelectBranches={state.branches.status === 'ready'} busy={state.busy} close={() => setServiceEditor(null)}
        save={(data) => model.saveService(serviceEditor === 'new' ? undefined : serviceEditor.id, data)} />}
    </section>
  </div>;
}
