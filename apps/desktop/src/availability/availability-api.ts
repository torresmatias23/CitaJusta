import { ApiError } from '@citajusta/client-core';
import type { ApiClient, UserProfile } from '@citajusta/client-core';
import { agendaQuery, list, named, record, text, uuid } from '../agenda/agenda-api.ts';
import type { Named } from '../agenda/agenda-api.ts';
import { institutionalInterval } from './institutional-time.ts';

export const blockTypes = ['VACATION', 'LEAVE', 'MEETING', 'MAINTENANCE', 'MANUAL', 'OTHER'] as const;
export type BlockType = typeof blockTypes[number];
export type Filters = { date: string; branchId?: string; serviceId?: string; professionalId?: string };
type Professional = { id: string; firstNames: string; lastNames: string; titleOrFunction: string | null };
export type Availability = { id: string; date: string; startTime: string; endTime: string; timeZone: string; active: boolean; capacity: number; origin: string;
  branch: Named; service: Named; professional: Professional; attentionPoint: Named | null; createdAt: string; updatedAt: string };
export type Block = { id: string; branch: Named | null; professional: Professional | null; attentionPoint: Named | null;
  type: BlockType; reason: string | null; startsAt: string; endsAt: string; createdAt: string };
export type IntervalInput = { date: string; startTime: string; endTime: string };
export type CreateInput = IntervalInput & { branchId: string; serviceId: string; professionalId: string };
export type BlockInput = IntervalInput & { branchId: string; professionalId?: string; type: BlockType; reason?: string | null };
function nullable(value: unknown) { return value === null ? null : text(value); }
function instant(value: unknown) {
  const v = text(value);
  if (!Number.isFinite(Date.parse(v)) || new Date(v).toISOString() !== v) throw new Error('Respuesta inválida.');
  return v;
}
function professional(value: unknown): Professional {
  const row = record(value);
  return { id: uuid(row.id), firstNames: text(row.firstNames), lastNames: text(row.lastNames), titleOrFunction: nullable(row.titleOrFunction) };
}
function decodeAvailability(value: unknown): Availability {
  const row = record(value), date = text(row.date), startTime = text(row.startTime), endTime = text(row.endTime), timeZone = text(row.timeZone);
  agendaQuery({ date });
  if (![startTime, endTime].every(v => /^([01]\d|2[0-3]):[0-5]\d$/.test(v)) || endTime <= startTime
    || typeof row.active !== 'boolean' || typeof row.capacity !== 'number' || !Number.isInteger(row.capacity) || row.capacity < 1) throw new Error('Respuesta inválida.');
  new Intl.DateTimeFormat('en', { timeZone }).format();
  return { id: uuid(row.id), date, startTime, endTime, timeZone, active: row.active, capacity: row.capacity, origin: text(row.origin),
    branch: named(row.branch), service: named(row.service), professional: professional(row.professional), attentionPoint: row.attentionPoint === null ? null : named(row.attentionPoint),
    createdAt: instant(row.createdAt), updatedAt: instant(row.updatedAt) };
}
function blockType(value: unknown): BlockType {
  const type = blockTypes.find(type => type === value); if (!type) throw new ApiError(400); return type;
}
function decodeBlock(value: unknown): Block {
  const row = record(value), startsAt = instant(row.startsAt), endsAt = instant(row.endsAt);
  if (endsAt <= startsAt) throw new Error('Respuesta inválida.');
  return { id: uuid(row.id), branch: row.branch === null ? null : named(row.branch), professional: row.professional === null ? null : professional(row.professional),
    attentionPoint: row.attentionPoint === null ? null : named(row.attentionPoint), type: blockType(row.type), reason: nullable(row.reason), startsAt, endsAt, createdAt: instant(row.createdAt) };
}
export function availabilityPermissions(user: UserProfile) {
  const has = (action: string) => Boolean(user.context.institutionId) && user.permissions.includes(`availability.${action}`);
  return { read: has('read'), create: has('create'), update: has('update'), block: has('block') };
}
export function availabilityError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 400) return 'Revisa los datos, el rango y las asociaciones seleccionadas.';
    if (error.status === 401) return 'Tu sesión requiere verificación. Inicia sesión nuevamente.';
    if (error.status === 403) return 'Permiso insuficiente para esta operación.';
    if (error.status === 404) return 'Recurso o contexto no disponible.';
    if (error.status === 409) return 'Conflicto: existen horarios, cupos, citas o bloqueos protegidos, o un cambio concurrente. Vuelve a consultar antes de reintentar.';
  }
  return 'No pudimos completar la operación. Comprueba la conexión y vuelve a consultar antes de reintentar.';
}
export function availabilityPatch(original: Availability, input: IntervalInput, timeZone: string, reactivate = false) {
  if (reactivate || original.date !== input.date || original.startTime !== input.startTime || original.endTime !== input.endTime) {
    return { ...institutionalInterval(input.date, input.startTime, input.endTime, timeZone), ...(reactivate ? { active: true as const } : {}) };
  }
  return null;
}
export function createAvailabilityAdministrationApi(api: ApiClient, user: UserProfile) {
  const permissions = availabilityPermissions(user);
  const institutionContext = { institutionId: user.context.institutionId ?? '', ...(user.context.branchId ? { branchId: user.context.branchId } : {}) };
  const gate = (permission: keyof typeof permissions) => { if (!permissions[permission]) throw new ApiError(403); };
  const branch = (id: string) => { if (user.context.branchId && id !== user.context.branchId) throw new ApiError(404); return uuid(id); };
  const write = async (path: string, method: 'POST' | 'PATCH', body: Record<string, unknown>, signal: AbortSignal) => {
    const result = record(record(await api.request(path, { method, body, institutionContext, signal, retryAfterRefresh: false })).data);
    return uuid(result.id);
  };
  return {
    async find(filters: Filters, signal: AbortSignal) {
      gate('read');
      return list(await api.request('availability/administration', { query: agendaQuery({ date: filters.date, branchId: filters.branchId, serviceId: filters.serviceId, professionalId: filters.professionalId }, user.context.branchId), institutionContext, signal }), decodeAvailability);
    },
    async blocks(filters: Filters, signal: AbortSignal) {
      gate('read');
      return list(await api.request('availability/blocks/administration', { query: agendaQuery({ date: filters.date, branchId: filters.branchId, professionalId: filters.professionalId }, user.context.branchId), institutionContext, signal }), decodeBlock);
    },
    create(input: CreateInput, timeZone: string, signal: AbortSignal) {
      gate('create');
      return write('availability', 'POST', { branchId: branch(input.branchId), serviceId: uuid(input.serviceId), professionalId: uuid(input.professionalId), ...institutionalInterval(input.date, input.startTime, input.endTime, timeZone) }, signal);
    },
    async update(original: Availability, input: IntervalInput, timeZone: string, signal: AbortSignal, reactivate = false) {
      gate('update'); branch(original.branch.id);
      const body = availabilityPatch(original, input, timeZone, reactivate);
      if (!body) return false;
      const id = await write(`availability/${uuid(original.id)}`, 'PATCH', body, signal);
      if (id !== original.id) throw new Error('Respuesta inválida.');
      return true;
    },
    async deactivate(original: Availability, signal: AbortSignal) {
      gate('update'); branch(original.branch.id);
      const id = await write(`availability/${uuid(original.id)}`, 'PATCH', { active: false }, signal);
      if (id !== original.id) throw new Error('Respuesta inválida.');
      return true;
    },
    block(input: BlockInput, timeZone: string, signal: AbortSignal) {
      gate('block');
      const reason = input.reason === undefined ? undefined : input.reason === null ? null : input.reason.trim();
      if (reason !== undefined && reason !== null && (!reason || reason.length > 2000)) throw new ApiError(400);
      return write('availability/blocks', 'POST', { branchId: branch(input.branchId), ...(input.professionalId ? { professionalId: uuid(input.professionalId) } : {}),
        ...institutionalInterval(input.date, input.startTime, input.endTime, timeZone), type: blockType(input.type), ...(reason !== undefined ? { reason } : {}) }, signal);
    },
  };
}
