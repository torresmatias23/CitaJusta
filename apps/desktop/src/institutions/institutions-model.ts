import { ApiError } from '@citajusta/client-core';
import type { ApiClient } from '@citajusta/client-core';
import { uuidPattern } from '../catalog/catalog-api.ts';

export type Institution = { id: string; name: string; legalName: string | null; taxIdentifier: string | null;
  contactEmail: string | null; phone: string | null; timeZone: string; status: 'ACTIVE' | 'INACTIVE' | 'SUSPENDED';
  createdAt: string; updatedAt: string };
export type InstitutionInput = { name: string; legalName: string | null; taxIdentifier: string | null; contactEmail: string | null; phone: string | null; timeZone?: string };
type Capabilities = { create: boolean; update: boolean };
export type InstitutionsState = { status: 'loading' | 'ready' | 'error'; items: Institution[];
  permissions: Capabilities; busy: boolean; feedback: string; failed: boolean };
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Respuesta de instituciones inválida.');
  return value as Record<string, unknown>;
}
function text(value: unknown): string { if (typeof value !== 'string') throw new Error('Respuesta de instituciones inválida.'); return value; }
const nullable = (value: unknown) => value === null ? null : text(value);
function instant(value: unknown) { const result = text(value); if (!/^\d{4}-\d{2}-\d{2}T.*Z$/.test(result) || !Number.isFinite(Date.parse(result))) throw new Error('Fecha inválida.'); return result; }
export function decodeInstitution(value: unknown): Institution {
  const row = object(value), id = text(row.id), status = row.status;
  if (!uuidPattern.test(id) || (status !== 'ACTIVE' && status !== 'INACTIVE' && status !== 'SUSPENDED')) throw new Error('Institución inválida.');
  return { id, name: text(row.name), legalName: nullable(row.legalName), taxIdentifier: nullable(row.taxIdentifier),
    contactEmail: nullable(row.contactEmail), phone: nullable(row.phone), timeZone: text(row.timeZone), status,
    createdAt: instant(row.createdAt), updatedAt: instant(row.updatedAt) };
}
export function institutionError(error: unknown) {
  if (error instanceof ApiError) {
    if (error.status === 401) return 'Verifica tu sesión antes de continuar.';
    if (error.status === 403) return 'Esta operación requiere autorización GLOBAL y el permiso institucional explícito.';
    if (error.status === 400) return 'Revisa los campos de la institución.';
    if (error.status === 404) return 'La institución ya no está disponible.';
    if (error.status === 409) return 'Identificador tributario duplicado o cambio concurrente. Actualiza antes de reintentar.';
  }
  return 'No pudimos verificar el resultado. Consulta las instituciones antes de repetir una escritura.';
}
const initial = (): InstitutionsState => ({ status: 'loading', items: [], permissions: { create: false, update: false }, busy: false, feedback: '', failed: false });
export function createInstitutionsModel(api: ApiClient) {
  const listeners = new Set<() => void>();
  let state = initial(), controller = new AbortController(), active = false, revision = 0;
  const update = (patch: Partial<InstitutionsState>) => { state = { ...state, ...patch }; listeners.forEach(fn => fn()); };
  async function load() {
    if (!active || state.busy) return;
    const version = ++revision, signal = controller.signal;
    update({ status: 'loading', permissions: { create: false, update: false } });
    try {
      // Platform operations never send the selected institutional context.
      const result = object(await api.request('institutions/administration', { signal }));
      const permissions = object(result.permissions);
      if (!Array.isArray(result.data) || typeof permissions.create !== 'boolean' || typeof permissions.update !== 'boolean') throw new Error('Respuesta inválida.');
      const items = result.data.map(decodeInstitution);
      if (active && !signal.aborted && version === revision) update({ status: 'ready', items, permissions: { create: permissions.create, update: permissions.update } });
    } catch (error) {
      if (active && !signal.aborted && version === revision) update({ status: 'error', items: [], feedback: institutionError(error), failed: true });
    }
  }
  return {
    subscribe(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; },
    getSnapshot: () => state,
    activate() { active = true; controller = new AbortController(); return load(); },
    reload: load,
    dispose() { active = false; revision++; controller.abort(); state = initial(); },
    async save(id: string | undefined, input: InstitutionInput) {
      if (!active || state.busy || state.status !== 'ready' || !(id ? state.permissions.update : state.permissions.create)) return false;
      if (id !== undefined && !uuidPattern.test(id)) return false;
      const signal = controller.signal;
      update({ busy: true, feedback: '', failed: false });
      let success = false;
      try {
        const body = { name: input.name, legalName: input.legalName, taxIdentifier: input.taxIdentifier,
          contactEmail: input.contactEmail, phone: input.phone, ...(!id && input.timeZone ? { timeZone: input.timeZone } : {}) };
        const result = decodeInstitution(object(await api.request(id ? `institutions/${id}` : 'institutions', {
          method: id ? 'PATCH' : 'POST', body, signal, retryAfterRefresh: false,
        })).data);
        if (id && result.id !== id) throw new Error('Respuesta inválida.');
        success = true;
      } catch (error) { if (active && !signal.aborted) update({ feedback: institutionError(error), failed: true }); }
      finally { if (active && !signal.aborted) update({ busy: false }); }
      if (!active || signal.aborted) return false;
      if (success) { update({ feedback: 'Institución guardada.', failed: false }); await load(); }
      return success;
    },
  };
}
