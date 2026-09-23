import { useState } from 'react';
import type { Branch, BranchInput, Category, Service, ServiceInput } from './catalog-api';

function value(data: FormData, key: string) { return String(data.get(key) ?? '').trim(); }
function optional(data: FormData, key: string) { return value(data, key) || null; }
function requiredText(data: FormData, key: string) {
  const result = value(data, key);
  if (!result) throw new Error('Completa los campos obligatorios.');
  return result;
}
function number(data: FormData, key: string, min: number, max: number, nullable = false): number | null {
  const raw = value(data, key);
  if (!raw && nullable) return null;
  const result = raw ? Number(raw) : NaN;
  if (!Number.isFinite(result) || result < min || result > max) throw new Error('Revisa los valores numéricos.');
  return result;
}
export function branchPayload(data: FormData): Partial<BranchInput> {
  return { code: requiredText(data, 'code'), name: requiredText(data, 'name'), addressLine1: optional(data, 'addressLine1'),
    addressLine2: optional(data, 'addressLine2'), municipality: optional(data, 'municipality'), region: optional(data, 'region'),
    ...(value(data, 'country') ? { country: value(data, 'country') } : {}),
    latitude: number(data, 'latitude', -90, 90, true), longitude: number(data, 'longitude', -180, 180, true),
    phone: optional(data, 'phone'), email: optional(data, 'email'), status: data.get('status') === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE' };
}
export function servicePayload(data: FormData, includeBranches: boolean): Partial<ServiceInput> {
  const durationMinutes = number(data, 'durationMinutes', 1, 2_147_483_647);
  const minimumAdvanceMinutes = number(data, 'minimumAdvanceMinutes', 0, 2_147_483_647);
  const maximumAdvanceDays = number(data, 'maximumAdvanceDays', 1, 2_147_483_647, true);
  if (durationMinutes === null || minimumAdvanceMinutes === null || !Number.isInteger(durationMinutes)
    || !Number.isInteger(minimumAdvanceMinutes) || (maximumAdvanceDays !== null && (!Number.isInteger(maximumAdvanceDays)
      || minimumAdvanceMinutes > maximumAdvanceDays * 1440))) throw new Error('Revisa la duración y la anticipación.');
  const branchIds = data.getAll('branchIds').map(String);
  if (branchIds.length > 100) throw new Error('Selecciona hasta 100 sedes.');
  return { code: requiredText(data, 'code'), name: requiredText(data, 'name'), description: optional(data, 'description'),
    categoryId: optional(data, 'categoryId'), durationMinutes, minimumAdvanceMinutes, maximumAdvanceDays,
    allowsWaitlist: data.has('allowsWaitlist'), requiresConfirmation: data.has('requiresConfirmation'), active: data.has('active'),
    ...(includeBranches ? { branchIds } : {}) };
}
// PATCH contains only edited fields, preserving inactive associations/categories on unrelated edits.
export function changedFields<T extends object>(input: Partial<T>, previous?: object): Partial<T> {
  if (!previous) return input;
  const before = previous as Record<string, unknown>;
  return Object.fromEntries(Object.entries(input).filter(([key, v]) => {
    const old = before[key];
    if (typeof v === 'number' && typeof old === 'string') return v !== Number(old);
    if (Array.isArray(v) && Array.isArray(old)) return JSON.stringify([...v].sort()) !== JSON.stringify([...old].sort());
    return v !== old;
  })) as Partial<T>;
}
function Field({ name, label, initial, maxLength, type = 'text', required = false, min, max, step }: {
  name: string; label: string; initial?: string | number | null; maxLength?: number; type?: string;
  required?: boolean; min?: number; max?: number; step?: string;
}) {
  return <label className="catalog-field">{label}<input name={name} defaultValue={initial ?? ''} type={type}
    maxLength={maxLength} required={required} min={min} max={max} step={step} /></label>;
}
function Actions({ busy, close }: { busy: boolean; close: () => void }) {
  return <div className="catalog-actions"><button className="primary-button" disabled={busy} type="submit">{busy ? 'Guardando…' : 'Guardar'}</button>
    <button type="button" disabled={busy} onClick={close}>Cancelar edición</button></div>;
}
export function BranchForm({ item, busy, save, close }: {
  item?: Branch; busy: boolean; save: (data: Partial<BranchInput>) => Promise<boolean>; close: () => void;
}) {
  const [error, setError] = useState('');
  return <form className="catalog-form" aria-label={item ? 'Editar sede' : 'Crear sede'} onSubmit={async (event) => {
    event.preventDefault(); if (busy) return;
    try {
      const input = changedFields(branchPayload(new FormData(event.currentTarget)), item);
      if (!Object.keys(input).length) { setError('No hay cambios para guardar.'); return; }
      setError(''); if (await save(input)) close();
    } catch { setError('Revisa los datos de la sede.'); }
  }}>
    <h3>{item ? `Editar sede: ${item.name}` : 'Crear sede'}</h3>
    <fieldset disabled={busy}><legend>Datos de la sede</legend><div className="catalog-fields">
      <Field name="code" label="Código" initial={item?.code} required maxLength={50} />
      <Field name="name" label="Nombre" initial={item?.name} required maxLength={160} />
      <Field name="addressLine1" label="Dirección" initial={item?.addressLine1} maxLength={220} />
      <Field name="addressLine2" label="Complemento de dirección" initial={item?.addressLine2} maxLength={220} />
      <Field name="municipality" label="Municipio" initial={item?.municipality} maxLength={120} />
      <Field name="region" label="Región" initial={item?.region} maxLength={120} />
      <Field name="country" label="País" initial={item?.country} maxLength={80} />
      <Field name="latitude" label="Latitud" initial={item?.latitude} type="number" min={-90} max={90} step="0.0000001" />
      <Field name="longitude" label="Longitud" initial={item?.longitude} type="number" min={-180} max={180} step="0.0000001" />
      <Field name="phone" label="Teléfono" initial={item?.phone} type="tel" maxLength={30} />
      <Field name="email" label="Correo de contacto" initial={item?.email} type="email" maxLength={254} />
      <label className="catalog-field">Estado<select name="status" defaultValue={item?.status ?? 'ACTIVE'}><option value="ACTIVE">Activa</option><option value="INACTIVE">Inactiva</option></select></label>
    </div></fieldset>
    {error && <p role="alert">{error}</p>}<Actions busy={busy} close={close} />
  </form>;
}
export function ServiceForm({ item, branches, categories, canSelectBranches, busy, save, close }: {
  item?: Service; branches: Branch[]; categories: Category[]; canSelectBranches: boolean;
  busy: boolean; save: (data: Partial<ServiceInput>) => Promise<boolean>; close: () => void;
}) {
  const [error, setError] = useState('');
  return <form className="catalog-form" aria-label={item ? 'Editar servicio' : 'Crear servicio'} onSubmit={async (event) => {
    event.preventDefault(); if (busy) return;
    try {
      const input = changedFields(servicePayload(new FormData(event.currentTarget), canSelectBranches), item);
      if (!Object.keys(input).length) { setError('No hay cambios para guardar.'); return; }
      setError(''); if (await save(input)) close();
    } catch { setError('Revisa los datos: duración entera positiva y anticipación mínima dentro del máximo.'); }
  }}>
    <h3>{item ? `Editar servicio: ${item.name}` : 'Crear servicio'}</h3>
    <fieldset disabled={busy}><legend>Datos del servicio</legend><div className="catalog-fields">
      <Field name="code" label="Código" initial={item?.code} required maxLength={50} />
      <Field name="name" label="Nombre" initial={item?.name} required maxLength={180} />
      <label className="catalog-field">Descripción<textarea name="description" defaultValue={item?.description ?? ''} maxLength={10000} /></label>
      <label className="catalog-field">Categoría<select name="categoryId" defaultValue={item?.categoryId ?? ''}>
        <option value="">Sin categoría</option>
        {item?.categoryId && !categories.some((c) => c.id === item.categoryId) && <option value={item.categoryId}>Categoría actual no disponible</option>}
        {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select></label>
      <Field name="durationMinutes" label="Duración (minutos)" initial={item?.durationMinutes} required type="number" min={1} max={2147483647} step="1" />
      <Field name="minimumAdvanceMinutes" label="Anticipación mínima (minutos)" initial={item?.minimumAdvanceMinutes ?? 0} required type="number" min={0} max={2147483647} step="1" />
      <Field name="maximumAdvanceDays" label="Anticipación máxima (días, vacío sin límite)" initial={item?.maximumAdvanceDays} type="number" min={1} max={2147483647} step="1" />
    </div>
    <label className="catalog-check"><input type="checkbox" name="allowsWaitlist" defaultChecked={item?.allowsWaitlist ?? false} />Permite lista de espera</label>
    <label className="catalog-check"><input type="checkbox" name="requiresConfirmation" defaultChecked={item?.requiresConfirmation ?? false} />Requiere confirmación</label>
    <label className="catalog-check"><input type="checkbox" name="active" defaultChecked={item?.active ?? true} />Servicio activo</label>
    <fieldset disabled={!canSelectBranches}><legend>Sedes asociadas</legend>
      {!canSelectBranches && <p>La lectura de sedes no está disponible. Se conservarán las asociaciones actuales.</p>}
      {canSelectBranches && branches.length === 0 && <p>No hay sedes disponibles.</p>}
      {branches.map((b) => <label className="catalog-check" key={b.id}><input type="checkbox" name="branchIds" value={b.id}
        defaultChecked={item?.branchIds.includes(b.id)} disabled={b.status !== 'ACTIVE' && !item?.branchIds.includes(b.id)} />{b.name} ({b.status === 'ACTIVE' ? 'Activa' : 'Inactiva'})</label>)}
    </fieldset></fieldset>
    {error && <p role="alert">{error}</p>}<Actions busy={busy} close={close} />
  </form>;
}
