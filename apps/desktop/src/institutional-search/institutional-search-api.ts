import { ApiError } from '@citajusta/client-core';
import type { ApiClient, UserProfile } from '@citajusta/client-core';
import { named, record, text, uuid } from '../agenda/agenda-api.ts';
import { uuidPattern } from '../catalog/catalog-api.ts';

export type SearchResource = 'users' | 'waitlist';
export type SearchFilters = { q?: string; branchId?: string; status?: string; serviceId?: string; userId?: string };
export type InstitutionalUser = { id: string; firstNames: string; lastNames: string };
export type InstitutionalWait = { id: string; enteredAt: string; status: { code: string; name: string };
  user: InstitutionalUser; service: { id: string; name: string }; branch: { id: string; name: string } | null };
export type SearchRow = InstitutionalUser | InstitutionalWait;
export type SearchPage = { data: SearchRow[]; nextCursor: string | null };
export const searchPermissions = { users: 'users.read', waitlist: 'waitlist.read' } as const;

export function canReadInstitutionalSearch(resource: SearchResource, user: UserProfile): boolean {
  return Boolean(user.context.institutionId && uuidPattern.test(user.context.institutionId)) && user.permissions.includes(searchPermissions[resource]);
}
function cursorValue(value: unknown): string | null {
  if (value === null) return null;
  // Transport validation only. The server owns cursor content, resource and tenant validation.
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,300}$/.test(value)) throw new Error('Página inválida.');
  return value;
}
export function institutionalSearchQuery(resource: SearchResource, filters: SearchFilters, branchContext?: string, cursor?: string): Record<string, string> {
  const allowed: readonly (keyof SearchFilters)[] = resource === 'users' ? ['q', 'branchId'] : ['status', 'serviceId', 'userId', 'branchId'];
  if (Object.keys(filters).some(key => !allowed.some(field => field === key))) throw new ApiError(400);
  const query: Record<string, string> = { limit: '50' };
  const branchId = filters.branchId;
  if (branchId !== undefined && typeof branchId !== 'string') throw new ApiError(400);
  if (branchContext !== undefined && !uuidPattern.test(branchContext)) throw new ApiError(400);
  if (branchContext && branchId && branchContext.toLowerCase() !== branchId.toLowerCase()) throw new ApiError(404);
  for (const key of allowed) {
    const raw = key === 'branchId' ? branchContext ?? branchId : filters[key];
    if (raw === undefined || raw === '') continue;
    if (typeof raw !== 'string') throw new ApiError(400);
    const value = raw.trim();
    if (key === 'q' || key === 'status') {
      if (!value) continue;
      if (value.length < (key === 'q' ? 2 : 1) || value.length > (key === 'q' ? 120 : 60)) throw new ApiError(400);
    } else if (!uuidPattern.test(value)) throw new ApiError(400);
    query[key] = value;
  }
  if (cursor !== undefined) {
    try { const parsed = cursorValue(cursor); if (parsed === null) throw new Error(); query.cursor = parsed; }
    catch { throw new ApiError(400); }
  }
  return query;
}
function person(value: unknown): InstitutionalUser {
  const row = record(value);
  return { id: uuid(row.id), firstNames: text(row.firstNames), lastNames: text(row.lastNames) };
}
function wait(value: unknown): InstitutionalWait {
  const row = record(value), status = record(row.status);
  const enteredAt = text(row.enteredAt);
  if (!Number.isFinite(Date.parse(enteredAt)) || new Date(enteredAt).toISOString() !== enteredAt) throw new Error('Fecha inválida.');
  return { id: uuid(row.id), enteredAt, status: { code: text(status.code), name: text(status.name) },
    user: person(row.user), service: named(row.service), branch: row.branch === null ? null : named(row.branch) };
}
export function parseInstitutionalSearchPage(resource: SearchResource, value: unknown): SearchPage {
  const row = record(value), page = record(row.page);
  if (!Array.isArray(row.data) || row.data.length > 50) throw new Error('Página inválida.');
  const nextCursor = cursorValue(page.nextCursor);
  if (!row.data.length && nextCursor !== null) throw new Error('Página sin avance.');
  return { data: row.data.map((value: unknown): SearchRow => resource === 'users' ? person(value) : wait(value)), nextCursor };
}
export function searchError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 400) return 'Revisa los filtros: nombres entre 2 y 120 caracteres, estado hasta 60 e identificadores UUID válidos.';
    if (error.status === 401) return 'Tu sesión no es válida. Inicia sesión nuevamente.';
    if (error.status === 403) return 'No tienes permiso para esta consulta en el contexto actual.';
    if (error.status === 404) return 'Los filtros o la página no están disponibles en tu contexto. Consulta nuevamente.';
    if (error.status === 503) return 'La consulta no está disponible temporalmente. Intenta nuevamente.';
  }
  return 'No pudimos consultar los registros. Revisa la conexión y vuelve a intentar.';
}
export function createInstitutionalSearchApi(resource: SearchResource, api: ApiClient, user: UserProfile) {
  const institutionContext = { institutionId: user.context.institutionId ?? '', ...(user.context.branchId ? { branchId: user.context.branchId } : {}) };
  return { async find(filters: SearchFilters, signal: AbortSignal, cursor?: string): Promise<SearchPage> {
    if (!canReadInstitutionalSearch(resource, user)) throw new ApiError(403);
    const query = institutionalSearchQuery(resource, filters, institutionContext.branchId, cursor);
    const page = parseInstitutionalSearchPage(resource, await api.request(`${resource}/administration`, { institutionContext, query, signal }));
    // These minimal DTOs contain no institutionId. Ownership is enforced by the API;
    // client identifiers can only narrow filters, never replace the authenticated context.
    if (resource === 'waitlist' && page.data.some(item => !('enteredAt' in item) ||
      (query.branchId && item.branch?.id.toLowerCase() !== query.branchId.toLowerCase()) ||
      (query.serviceId && item.service.id.toLowerCase() !== query.serviceId.toLowerCase()) ||
      (query.userId && item.user.id.toLowerCase() !== query.userId.toLowerCase()) ||
      (query.status && item.status.code !== query.status))) throw new ApiError(404);
    return page;
  } };
}
