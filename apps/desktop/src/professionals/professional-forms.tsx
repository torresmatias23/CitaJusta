import { useState } from 'react';
import type { Branch, Service } from '../catalog/catalog-api';
import { changedFields } from '../catalog/catalog-forms';
import type { EligibleUser, Professional, ProfessionalInput } from './professional-api';

export function professionalPayload(data: FormData, branchIds: string[], serviceIds: string[], previous?: Professional): ProfessionalInput {
  const status = data.get('status');
  if (status !== 'ACTIVE' && status !== 'INACTIVE' && status !== 'SUSPENDED') throw new Error('Selecciona un estado válido.');
  if ((!previous && (!branchIds.length || !serviceIds.length)) || branchIds.length > 100 || serviceIds.length > 100) {
    throw new Error('Al crear, selecciona al menos una sede y un servicio; máximo 100 de cada uno.');
  }
  const nullable = (key: string) => String(data.get(key) ?? '').trim() || null;
  return changedFields<ProfessionalInput>({ internalCode: nullable('internalCode'), titleOrFunction: nullable('titleOrFunction'),
    description: nullable('description'), status, branchIds, serviceIds }, previous);
}
export function AssociationPicker({ title, options, selected, change }: {
  title: string; options: { id: string; name: string; active: boolean }[]; selected: string[]; change: (ids: string[]) => void;
}) {
  const selectable = new Set(options.filter(o => o.active).map(o => o.id));
  const unavailable = selected.some(id => !selectable.has(id));
  return <fieldset><legend>{title}</legend>
    {unavailable && <p>Hay asociaciones inactivas o no disponibles. Se conservan si no cambias esta selección; al cambiarla se retirarán.</p>}
    {!options.some(o => o.active) && <p>No hay opciones activas disponibles.</p>}
    {options.map(option => <label className="catalog-check" key={option.id}>
      <input type="checkbox" checked={selected.includes(option.id)} disabled={!option.active} onChange={event => {
        const next = selected.filter(id => selectable.has(id) && id !== option.id);
        change(event.target.checked ? [...next, option.id] : next);
      }} />{option.name}{!option.active ? ' (Inactivo)' : ''}
    </label>)}
    {!!selected.length && <button type="button" onClick={() => change([])}>Quitar todas las asociaciones de {title.toLowerCase()}</button>}
  </fieldset>;
}
export function ProfessionalForm({ item, eligible, branches, services, busy, save, close }: {
  item?: Professional; eligible: EligibleUser | null; branches: Branch[]; services: Service[]; busy: boolean;
  save: (input: ProfessionalInput) => Promise<boolean>; close: () => void;
}) {
  const [branchIds, setBranchIds] = useState(item?.branchIds ?? []);
  const [serviceIds, setServiceIds] = useState(item?.serviceIds ?? []);
  const [error, setError] = useState('');
  const identity = item?.user ?? eligible;
  return <form className="catalog-form" aria-label={item ? 'Editar profesional' : 'Crear profesional'} onSubmit={async event => {
    event.preventDefault(); if (busy || !identity) return;
    try {
      const input = professionalPayload(new FormData(event.currentTarget), branchIds, serviceIds, item);
      if (!Object.keys(input).length) { setError('No hay cambios para guardar.'); return; }
      setError(''); if (await save(input)) close();
    } catch { setError('Revisa el estado y las asociaciones: al crear se requiere al menos una sede y un servicio, máximo 100 de cada uno.'); }
  }}>
    <h3>{item ? 'Editar profesional' : 'Crear profesional'}</h3>
    {identity ? <p>Cuenta vinculada: <strong>{identity.firstNames} {identity.lastNames}</strong> · {identity.email}</p> : <p>Busca y selecciona una cuenta elegible para continuar.</p>}
    <fieldset disabled={busy || !identity}><legend>Datos administrativos</legend>
      <div className="catalog-fields">
        <label className="catalog-field">Código interno<input name="internalCode" maxLength={60} defaultValue={item?.internalCode ?? ''} /></label>
        <label className="catalog-field">Título o función<input name="titleOrFunction" maxLength={160} defaultValue={item?.titleOrFunction ?? ''} /></label>
        <label className="catalog-field">Descripción<textarea name="description" maxLength={10000} defaultValue={item?.description ?? ''} /></label>
        <label className="catalog-field">Estado<select name="status" defaultValue={item?.status ?? 'ACTIVE'}>
          <option value="ACTIVE">Activo</option><option value="INACTIVE">Inactivo</option><option value="SUSPENDED">Suspendido</option>
        </select></label>
      </div>
      <AssociationPicker title="Sedes" options={branches.map(b => ({ id: b.id, name: b.name, active: b.status === 'ACTIVE' }))} selected={branchIds} change={setBranchIds} />
      <AssociationPicker title="Servicios" options={services} selected={serviceIds} change={setServiceIds} />
      <button type="submit" className="primary-button" disabled={busy || !identity}>{busy ? 'Guardando…' : 'Guardar profesional'}</button>
    </fieldset>
    {error && <p role="alert">{error}</p>}
    <button type="button" disabled={busy} onClick={close}>Cancelar edición</button>
  </form>;
}
