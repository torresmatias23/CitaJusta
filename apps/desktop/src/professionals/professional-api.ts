import { ApiError } from '@citajusta/client-core';
import type { ApiClient, UserProfile } from '@citajusta/client-core';
import { uuidPattern } from '../catalog/catalog-api.ts';

export type ProfessionalStatus = 'ACTIVE' | 'INACTIVE' | 'SUSPENDED';
export type EligibleUser = { id: string; email: string; firstNames: string; lastNames: string };
export type ProfessionalInput = { internalCode?: string | null; titleOrFunction?: string | null; description?: string | null;
  status?: ProfessionalStatus; branchIds?: string[]; serviceIds?: string[] };
export type Professional = { id: string; user: EligibleUser; internalCode: string | null; titleOrFunction: string | null;
  description: string | null; status: ProfessionalStatus; createdAt: string; updatedAt: string; branchIds: string[]; serviceIds: string[] };
function object(v: unknown): Record<string, unknown> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('Respuesta inválida.');
  return v as Record<string, unknown>;
}
function text(v: unknown): string { if (typeof v !== 'string') throw new Error('Respuesta inválida.'); return v; }
function nullable(v: unknown) { return v === null ? null : text(v); }
function id(v: unknown) { const s = text(v); if (!uuidPattern.test(s)) throw new Error('Respuesta inválida.'); return s; }
function ids(v: unknown) { if (!Array.isArray(v)) throw new Error('Respuesta inválida.'); return v.map(id); }
function timestamp(v: unknown) { const s = text(v); if (!Number.isFinite(Date.parse(s))) throw new Error('Respuesta inválida.'); return s; }
function identity(v: unknown): EligibleUser { const row = object(v); return { id: id(row.id), email: text(row.email), firstNames: text(row.firstNames), lastNames: text(row.lastNames) }; }
function fields(v: unknown): Omit<Professional, 'user'> {
  const row = object(v);
  if (row.status !== 'ACTIVE' && row.status !== 'INACTIVE' && row.status !== 'SUSPENDED') throw new Error('Respuesta inválida.');
  return { id: id(row.id), internalCode: nullable(row.internalCode), titleOrFunction: nullable(row.titleOrFunction),
    description: nullable(row.description), status: row.status, createdAt: timestamp(row.createdAt), updatedAt: timestamp(row.updatedAt),
    branchIds: ids(row.branchIds), serviceIds: ids(row.serviceIds) };
}
export function professionalPermissions(user: UserProfile) {
  const has = (code: string) => Boolean(user.context.institutionId) && !user.context.branchId && user.permissions.includes(code);
  const read = has('professionals.read');
  const catalogs = has('branches.read') && has('services.read');
  return { read, catalogs: read && catalogs, create: read && catalogs && has('professionals.create'), update: read && catalogs && has('professionals.update') };
}
export function professionalError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 401) return 'Tu sesión requiere verificación. Inicia sesión nuevamente.';
    if (error.status === 403) return 'Acceso no disponible con los permisos y contexto actuales.';
    if (error.status === 404) return 'La cuenta o recurso no está disponible para esta operación.';
    if (error.status === 409) return 'Existe un conflicto de registro o actualización. Actualiza el listado antes de reintentar.';
    if (error.status === 400) return 'Revisa los datos y las asociaciones seleccionadas.';
  }
  return 'No pudimos completar la operación. Revisa tu conexión y vuelve a consultar antes de reintentar.';
}
export function createProfessionalApi(api: ApiClient, user: UserProfile) {
  const institutionContext = { institutionId: user.context.institutionId ?? '', ...(user.context.branchId ? { branchId: user.context.branchId } : {}) };
  return {
    async list(signal: AbortSignal): Promise<Professional[]> {
      const result = object(await api.request('professionals/administration', { institutionContext, signal })).data;
      if (!Array.isArray(result)) throw new Error('Respuesta inválida.');
      return result.map((row) => ({ ...fields(row), user: identity(object(row).user) }));
    },
    async eligible(email: string, signal: AbortSignal) {
      return identity(object(await api.request('professionals/eligible-users', { institutionContext, signal, query: { email: email.trim() } })).data);
    },
    async save(professionalId: string | undefined, input: ProfessionalInput, userId: string | undefined, signal: AbortSignal) {
      const allowed = ['internalCode', 'titleOrFunction', 'description', 'status', 'branchIds', 'serviceIds'];
      const body: Record<string, unknown> = Object.fromEntries(Object.entries(input).filter(([key, v]) => allowed.includes(key) && v !== undefined));
      if (professionalId) id(professionalId);
      else body.userId = id(userId);
      const result = object(object(await api.request(professionalId ? `professionals/${professionalId}` : 'professionals', {
        method: professionalId ? 'PATCH' : 'POST', institutionContext, signal, body, retryAfterRefresh: false,
      })).data);
      const decoded = { ...fields(result), userId: id(result.userId) };
      if ((professionalId && decoded.id !== professionalId) || (userId && decoded.userId !== userId)) throw new Error('Respuesta inválida.');
      return decoded;
    },
  };
}
