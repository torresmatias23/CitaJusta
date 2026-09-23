import { ApiError } from '@citajusta/client-core';
import type { ApiClient, UserProfile } from '@citajusta/client-core';

export type Branch = {
  id: string; code: string; name: string; addressLine1: string | null; addressLine2: string | null;
  municipality: string | null; region: string | null; country: string; latitude: string | null;
  longitude: string | null; phone: string | null; email: string | null; status: 'ACTIVE' | 'INACTIVE';
};
export type Service = {
  id: string; code: string; name: string; description: string | null; categoryId: string | null;
  durationMinutes: number; minimumAdvanceMinutes: number; maximumAdvanceDays: number | null;
  allowsWaitlist: boolean; requiresConfirmation: boolean; active: boolean; branchIds: string[];
};
export type Category = { id: string; name: string };
export type BranchInput = Omit<Branch, 'id' | 'latitude' | 'longitude'> & { latitude: number | null; longitude: number | null };
export type ServiceInput = Omit<Service, 'id'>;
export const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Respuesta inválida.');
  return value as Record<string, unknown>;
}
function text(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Respuesta inválida.');
  return value;
}
function nullableText(value: unknown): string | null { return value === null ? null : text(value); }
function id(value: unknown): string {
  const result = text(value);
  if (!uuidPattern.test(result)) throw new Error('Respuesta inválida.');
  return result;
}
function integer(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) throw new Error('Respuesta inválida.');
  return value;
}
function boolean(value: unknown): boolean {
  if (typeof value !== 'boolean') throw new Error('Respuesta inválida.');
  return value;
}
function branch(value: unknown): Branch {
  const v = object(value);
  if (v.status !== 'ACTIVE' && v.status !== 'INACTIVE') throw new Error('Respuesta inválida.');
  return { id: id(v.id), code: text(v.code), name: text(v.name), addressLine1: nullableText(v.addressLine1),
    addressLine2: nullableText(v.addressLine2), municipality: nullableText(v.municipality), region: nullableText(v.region),
    country: text(v.country), latitude: nullableText(v.latitude), longitude: nullableText(v.longitude),
    phone: nullableText(v.phone), email: nullableText(v.email), status: v.status };
}
function service(value: unknown): Service {
  const v = object(value);
  if (!Array.isArray(v.branchIds)) throw new Error('Respuesta inválida.');
  return { id: id(v.id), code: text(v.code), name: text(v.name), description: nullableText(v.description),
    categoryId: v.categoryId === null ? null : id(v.categoryId), durationMinutes: integer(v.durationMinutes),
    minimumAdvanceMinutes: integer(v.minimumAdvanceMinutes), maximumAdvanceDays: v.maximumAdvanceDays === null ? null : integer(v.maximumAdvanceDays),
    allowsWaitlist: boolean(v.allowsWaitlist), requiresConfirmation: boolean(v.requiresConfirmation),
    active: boolean(v.active), branchIds: v.branchIds.map(id) };
}
function list<T>(value: unknown, decode: (v: unknown) => T): T[] {
  const data = object(value).data;
  if (!Array.isArray(data)) throw new Error('Respuesta inválida.');
  return data.map(decode);
}
export function catalogPermissions(user: UserProfile) {
  const has = (p: string) => Boolean(user.context.institutionId) && user.permissions.includes(p);
  const institutional = !user.context.branchId;
  return { branches: has('branches.read'), services: institutional && has('services.read'),
    createBranch: institutional && has('branches.read') && has('branches.create'),
    updateBranch: has('branches.read') && has('branches.update'),
    createService: institutional && has('services.read') && has('services.create'),
    updateService: institutional && has('services.read') && has('services.update') };
}
export function catalogError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 403) return 'No tienes permisos para esta operación en el contexto seleccionado.';
    if (error.status === 401) return 'Verifica tu sesión antes de volver a intentar.';
    if (error.status === 404) return 'El recurso o contexto ya no está disponible.';
    if (error.status === 409) return 'Hay un conflicto con el código o una actualización concurrente. Actualiza el catálogo.';
    if (error.status === 400) return 'Revisa los campos y las asociaciones seleccionadas.';
  }
  return 'No pudimos completar la operación. Revisa la conexión y actualiza el catálogo antes de reintentar.';
}
export function createCatalogApi(api: ApiClient, user: UserProfile) {
  const institutionId = user.context.institutionId;
  const context = { institutionId: institutionId ?? '', ...(user.context.branchId ? { branchId: user.context.branchId } : {}) };
  const request = (path: string, signal: AbortSignal) => api.request(path, { institutionContext: context, signal });
  async function save<T extends { id: string }>(path: string, resourceId: string | undefined, input: unknown, decode: (v: unknown) => T, signal: AbortSignal) {
    if (resourceId !== undefined && !uuidPattern.test(resourceId)) throw new Error('Identificador inválido.');
    const value = await api.request(resourceId ? `${path}/${resourceId}` : path, {
      method: resourceId ? 'PATCH' : 'POST', body: input, institutionContext: context, retryAfterRefresh: false, signal,
    });
    const result = decode(object(value).data);
    if (resourceId && result.id !== resourceId) throw new Error('Respuesta inválida.');
    return result;
  }
  return {
    branches: async (signal: AbortSignal) => list(await request('branches/administration', signal), branch),
    services: async (signal: AbortSignal) => list(await request('services/administration', signal), service),
    categories: async (signal: AbortSignal) => list(await request('services/categories', signal), (v): Category => {
      const item = object(v); return { id: id(item.id), name: text(item.name) };
    }),
    saveBranch: (resourceId: string | undefined, input: Partial<BranchInput>, signal: AbortSignal) => save('branches', resourceId, input, branch, signal),
    saveService: (resourceId: string | undefined, input: Partial<ServiceInput>, signal: AbortSignal) => save('services', resourceId, input, service, signal),
  };
}
