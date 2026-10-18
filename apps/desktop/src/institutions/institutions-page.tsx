import { useEffect, useState, useSyncExternalStore } from 'react';
import { useAuth } from '../auth/auth-provider';
import { InlineAlert } from '../components/ui/inline-alert';
import { createInstitutionsModel } from './institutions-model';
import type { Institution, InstitutionInput, InstitutionsState } from './institutions-model';

export function InstitutionsPage() {
  const { api, user } = useAuth();
  return user ? <Workspace key={JSON.stringify([user.id, user.permissions])} api={api} /> : null;
}
function Workspace({ api }: { api: Parameters<typeof createInstitutionsModel>[0] }) {
  const [model] = useState(() => createInstitutionsModel(api));
  const state = useSyncExternalStore(model.subscribe, model.getSnapshot, model.getSnapshot);
  useEffect(() => { void model.activate(); return () => model.dispose(); }, [model]);
  return <InstitutionsView model={model} state={state} />;
}
export function InstitutionsView({ model, state }: { model: ReturnType<typeof createInstitutionsModel>; state: InstitutionsState }) {
  const [editor, setEditor] = useState<Institution | 'new' | null>(null);
  return <div className="catalog-page">
    <p>Administración general de instituciones. No utiliza ni amplía el contexto institucional seleccionado.</p>
    {state.feedback && <InlineAlert failed={state.failed}>{state.feedback}</InlineAlert>}
    <button type="button" disabled={state.busy || state.status === 'loading'} onClick={() => { setEditor(null); void model.reload(); }}>Actualizar instituciones</button>
    {state.status === 'loading' && <p role="status">Verificando autorización GLOBAL y consultando instituciones…</p>}
    {state.status === 'ready' && <section className="catalog-section" aria-label="Instituciones registradas">
      {state.permissions.create && <button className="primary-button" type="button" disabled={state.busy} onClick={() => setEditor('new')}>Registrar institución</button>}
      {!state.items.length && <p>No hay instituciones registradas.</p>}
      <ul className="catalog-list">{state.items.map(item => <li key={item.id} className="catalog-card">
        <h2>{item.name}</h2><p>{item.legalName ?? 'Sin razón social'} · {item.status}</p>
        <p>{item.taxIdentifier ?? 'Sin identificador tributario'} · {item.timeZone}</p>
        {item.contactEmail && <p>{item.contactEmail}</p>}{item.phone && <p>{item.phone}</p>}
        {state.permissions.update && <button type="button" disabled={state.busy} onClick={() => setEditor(item)}>Editar institución</button>}
      </li>)}</ul>
      {editor && (editor === 'new' ? state.permissions.create : state.permissions.update) && <InstitutionForm key={editor === 'new' ? 'new' : editor.id} item={editor === 'new' ? undefined : editor}
        busy={state.busy} cancel={() => setEditor(null)} save={async input => {
          if (await model.save(editor === 'new' ? undefined : editor.id, input)) setEditor(null);
        }} />}
    </section>}
    <p className="architecture-note">Sin eliminación, cambios de estado ni cambios de zona horaria de instituciones existentes.</p>
  </div>;
}
export function InstitutionForm({ item, busy, save, cancel }: { item?: Institution; busy: boolean;
  save: (input: InstitutionInput) => Promise<void>; cancel: () => void }) {
  const [error, setError] = useState('');
  return <form className="catalog-section" aria-label={item ? 'Editar institución' : 'Registrar institución'} onSubmit={event => {
    event.preventDefault(); if (busy) return;
    const data = new FormData(event.currentTarget), value = (name: string) => String(data.get(name) ?? '').trim();
    const name = value('name');
    if (!name) { setError('Indica el nombre de la institución.'); return; }
    const zone = item?.timeZone ?? value('timeZone');
    try { new Intl.DateTimeFormat('es', { timeZone: zone }); } catch { setError('Indica una zona horaria IANA válida.'); return; }
    setError('');
    void save({ name, legalName: value('legalName') || null, taxIdentifier: value('taxIdentifier') || null,
      contactEmail: value('contactEmail') || null, phone: value('phone') || null, ...(!item ? { timeZone: zone } : {}) });
  }}>
    <h2>{item ? 'Editar institución' : 'Registrar institución'}</h2>
    <fieldset disabled={busy} className="catalog-fields"><legend>Datos institucionales</legend>
      <label className="catalog-field">Nombre<input name="name" required maxLength={180} defaultValue={item?.name} /></label>
      <label className="catalog-field">Razón social<input name="legalName" maxLength={220} defaultValue={item?.legalName ?? ''} /></label>
      <label className="catalog-field">Identificador tributario<input name="taxIdentifier" maxLength={30} defaultValue={item?.taxIdentifier ?? ''} /></label>
      <label className="catalog-field">Correo de contacto<input name="contactEmail" type="email" maxLength={254} defaultValue={item?.contactEmail ?? ''} /></label>
      <label className="catalog-field">Teléfono<input name="phone" type="tel" maxLength={30} defaultValue={item?.phone ?? ''} /></label>
      {!item && <label className="catalog-field">Zona horaria<input name="timeZone" required maxLength={80} defaultValue="America/Santiago" /></label>}
    </fieldset>
    {error && <p role="alert">{error}</p>}
    <div className="catalog-actions"><button className="primary-button" type="submit" disabled={busy}>Guardar institución</button>
      <button type="button" disabled={busy} onClick={cancel}>Cancelar</button></div>
  </form>;
}
