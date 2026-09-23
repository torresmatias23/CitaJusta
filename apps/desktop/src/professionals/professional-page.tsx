import { useEffect, useState, useSyncExternalStore } from 'react';
import type { UserProfile } from '@citajusta/client-core';
import { useAuth } from '../auth/auth-provider';
import { createProfessionalModel } from './professional-model';
import type { ProfessionalState } from './professional-model';
import type { Professional } from './professional-api';
import { ProfessionalForm } from './professional-forms';

export function ProfessionalPage() {
  const { user, status } = useAuth();
  if (status !== 'authenticated' || !user) return <p role="status">Se requiere una sesión verificada.</p>;
  return <ProfessionalWorkspace key={JSON.stringify([user.id, user.context, user.permissions])} user={user} />;
}
function ProfessionalWorkspace({ user }: { user: UserProfile }) {
  const { api } = useAuth();
  const [model] = useState(() => createProfessionalModel(api, user));
  const state = useSyncExternalStore(model.subscribe, model.getSnapshot, model.getSnapshot);
  useEffect(() => { void model.activate(); return () => model.dispose(); }, [model]);
  return <ProfessionalView model={model} state={state} />;
}
export function ProfessionalView({ model, state }: { model: ReturnType<typeof createProfessionalModel>; state: ProfessionalState }) {
  const [editor, setEditor] = useState<Professional | 'new' | null>(null);
  const [email, setEmail] = useState('');
  const close = () => { setEditor(null); setEmail(''); model.clearEligible(); };
  const ready = state.catalogStatus === 'ready';
  if (state.status === 'denied') return <p role="status">Acceso no disponible. Aplica un contexto institucional sin sede en Sedes y servicios y verifica tus permisos de lectura de profesionales.</p>;
  return <div className="catalog-page">
    <div className="catalog-heading">
      <p>Gestiona profesionales vinculados a cuentas existentes de la plataforma.</p>
      <button type="button" disabled={state.busy} onClick={() => { close(); void model.reload(); }}>Actualizar profesionales</button>
      {model.permissions.create && <button type="button" disabled={state.busy || !ready || state.status !== 'ready'} onClick={() => { close(); setEditor('new'); }}>Crear profesional</button>}
    </div>
    {state.feedback && <p role={state.failed ? 'alert' : 'status'}>{state.feedback}</p>}
    {state.status === 'loading' && <p role="status">Cargando profesionales…</p>}
    {state.status === 'error' && <p role="alert">{state.error}</p>}
    {state.catalogStatus === 'denied' && <p role="status">Los formularios requieren acceso de lectura a sedes y servicios. No se cargarán catálogos públicos como alternativa.</p>}
    {state.catalogStatus === 'loading' && <p role="status">Cargando sedes y servicios…</p>}
    {state.catalogStatus === 'error' && <p role="alert">No pudimos cargar las asociaciones. Actualiza profesionales para reintentar.</p>}
    {state.status === 'ready' && !state.items.length && <p role="status">No hay profesionales registrados en esta institución.</p>}
    <ul className="catalog-list">{state.items.map(item => <li className="catalog-card" key={item.id}>
      <h2>{item.user.firstNames} {item.user.lastNames}</h2><p>{item.user.email}</p>
      <span className={`catalog-status ${item.status === 'ACTIVE' ? 'is-active' : ''}`}>{ { ACTIVE: 'Activo', INACTIVE: 'Inactivo', SUSPENDED: 'Suspendido' }[item.status] }</span>
      <p>Código: {item.internalCode ?? 'Sin código'} · Función: {item.titleOrFunction ?? 'Sin especificar'}</p>
      <p>Sedes: {item.branchIds.map(id => state.branches.find(b => b.id === id)?.name ?? 'Sede no disponible').join(', ') || 'Sin asociaciones'}</p>
      <p>Servicios: {item.serviceIds.map(id => state.services.find(s => s.id === id)?.name ?? 'Servicio no disponible').join(', ') || 'Sin asociaciones'}</p>
      {model.permissions.update && <button type="button" disabled={state.busy || !ready} aria-label={`Editar profesional ${item.user.firstNames} ${item.user.lastNames}`} onClick={() => { close(); setEditor(item); }}>Editar profesional</button>}
    </li>)}</ul>
    {editor === 'new' && ready && <form className="catalog-context" aria-label="Buscar cuenta elegible" onSubmit={event => {
      event.preventDefault(); if (!state.searching) void model.search(email);
    }}>
      <label className="catalog-field">Email exacto de la cuenta existente<input name="eligible-email" type="email" required maxLength={254} value={email} disabled={state.busy}
        onChange={event => { setEmail(event.target.value); model.clearEligible(); }} /></label>
      <button type="submit" disabled={state.busy || state.searching}>{state.searching ? 'Buscando…' : 'Buscar cuenta'}</button>
      {state.searchError && <p role="alert">{state.searchError}</p>}
      {state.eligible && <p role="status">Cuenta elegible: {state.eligible.firstNames} {state.eligible.lastNames} · {state.eligible.email}</p>}
    </form>}
    {editor && ready && state.status === 'ready' && <ProfessionalForm key={editor === 'new' ? 'new' : editor.id}
      item={editor === 'new' ? undefined : editor} eligible={state.eligible} branches={state.branches} services={state.services}
      busy={state.busy} close={close} save={input => model.save(editor === 'new' ? undefined : editor.id, input)} />}
  </div>;
}
