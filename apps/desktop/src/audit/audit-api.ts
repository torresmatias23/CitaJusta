import { ApiError } from '@citajusta/client-core';
import type { ApiClient, UserProfile } from '@citajusta/client-core';
import { record, uuid } from '../agenda/agenda-api.ts';
import { uuidPattern } from '../catalog/catalog-api.ts';

export const auditActions = [
  'AUTH_LOGIN_SUCCESS', 'AUTH_LOGIN_FAILURE', 'AUTH_LOGOUT', 'AUTH_GOOGLE_LINKED',
  'GOOGLE_CALENDAR_EVENT_CREATED',
  'APPOINTMENT_CREATED', 'APPOINTMENT_CANCELLED', 'ATTENDANCE_RECORDED', 'NO_SHOW_RECORDED',
  'OFFER_CREATED', 'OFFER_ACCEPTED', 'OFFER_REJECTED', 'OFFER_EXPIRED',
  'REASSIGNMENT_STARTED', 'REASSIGNMENT_COMPLETED', 'REASSIGNMENT_EXHAUSTED',
  'BRANCH_CREATED', 'BRANCH_UPDATED', 'SERVICE_CREATED', 'SERVICE_UPDATED',
  'PROFESSIONAL_CREATED', 'PROFESSIONAL_UPDATED', 'AVAILABILITY_CREATED', 'AVAILABILITY_UPDATED',
  'SCHEDULE_BLOCK_CREATED', 'REASSIGNMENT_POLICY_VERSION_CREATED',
] as const;
export const auditResources = ['AUTH', 'APPOINTMENT', 'OFFER', 'REASSIGNMENT', 'BRANCH', 'SERVICE', 'PROFESSIONAL', 'AVAILABILITY', 'SCHEDULE_BLOCK', 'REASSIGNMENT_POLICY'] as const;
const states = ['AGENDADA', 'CANCELADA', 'ATENDIDA', 'INASISTENCIA', 'PENDING', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'OFFERING', 'COMPLETED', 'EXHAUSTED', 'ACTIVE', 'INACTIVE'] as const;
const reasons = ['INVALID_CREDENTIALS', 'NO_ELIGIBLE_CANDIDATES', 'CANDIDATES_EXHAUSTED_AFTER_REJECTION', 'CANDIDATES_EXHAUSTED_AFTER_EXPIRATION', 'OFFER_TTL_ELAPSED'] as const;
export type AuditFilters = { from?: string; to?: string; branchId?: string; actorUserId?: string; action?: string; resourceType?: string };

function code<T extends string>(value: unknown, allowed: readonly T[]): T {
  const found = allowed.find(item => item === value);
  if (found === undefined) throw new Error('Código de auditoría inválido.');
  return found;
}
function optionalCode<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  return value === undefined || value === null ? null : code(value, allowed);
}
function nullableId(value: unknown): string | null { return value === null ? null : uuid(value); }
function civilDate(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new ApiError(400);
  const date = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new ApiError(400);
  return value;
}
function instant(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)) throw new Error('Fecha de auditoría inválida.');
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== value.replace(/(?:\.(\d{1,3}))?Z$/, (_match, fraction: string | undefined) => `.${(fraction ?? '').padEnd(3, '0')}Z`)) throw new Error('Fecha de auditoría inválida.');
  return value;
}
function cursorValue(value: unknown): string | null {
  if (value === null) return null;
  // Opaque server cursor; only validate transport shape/length, never decode it.
  if (typeof value !== 'string' || !value.length || value.length > 300) throw new Error('Página de auditoría inválida.');
  return value;
}
function event(value: unknown) {
  const r = record(value);
  return { id: uuid(r.id), institutionId: nullableId(r.institutionId), branchId: nullableId(r.branchId), actorUserId: nullableId(r.actorUserId),
    actorType: code(r.actorType, ['USER', 'SYSTEM'] as const), actionCode: code(r.actionCode, auditActions), resourceType: code(r.resourceType, auditResources),
    resourceId: nullableId(r.resourceId), outcome: code(r.outcome, ['SUCCESS', 'FAILURE'] as const),
    previousState: optionalCode(r.previousState, states), newState: optionalCode(r.newState, states), reasonCode: optionalCode(r.reasonCode, reasons), occurredAt: instant(r.occurredAt) };
}
export type AuditEvent = ReturnType<typeof event>;
export type AuditPage = { data: AuditEvent[]; nextCursor: string | null };
export function parseAuditPage(value: unknown): AuditPage {
  const response = record(value), page = record(response.page);
  if (!Array.isArray(response.data)) throw new Error('Eventos de auditoría inválidos.');
  return { data: response.data.map(event), nextCursor: cursorValue(page.nextCursor) };
}
export function auditQuery(filters: AuditFilters, branchContext?: string, cursor?: string): Record<string, string> {
  if (Object.keys(filters).some(key => !['from', 'to', 'branchId', 'actorUserId', 'action', 'resourceType'].includes(key))) throw new ApiError(400);
  const query: Record<string, string> = { limit: '50' };
  for (const key of ['from', 'to'] as const) {
    if (filters[key] !== undefined && filters[key] !== '') query[key] = civilDate(filters[key]);
  }
  if (query.from && query.to && query.from > query.to) throw new ApiError(400);
  if (branchContext && filters.branchId && branchContext !== filters.branchId) throw new ApiError(404);
  for (const key of ['branchId', 'actorUserId'] as const) {
    const value = key === 'branchId' ? branchContext ?? filters[key] : filters[key];
    if (value !== undefined && value !== '') {
      if (typeof value !== 'string' || !uuidPattern.test(value)) throw new ApiError(400);
      query[key] = value;
    }
  }
  try {
    if (filters.action !== undefined && filters.action !== '') query.action = code(filters.action, auditActions);
    if (filters.resourceType !== undefined && filters.resourceType !== '') query.resourceType = code(filters.resourceType, auditResources);
    if (cursor !== undefined) {
      const parsed = cursorValue(cursor);
      if (parsed === null) throw new Error('Cursor inválido.');
      query.cursor = parsed;
    }
  } catch { throw new ApiError(400); }
  return query;
}
export function canReadAudit(user: UserProfile): boolean { return Boolean(user.context.institutionId) && user.permissions.includes('audit.read'); }
export function auditError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 400) return 'Revisa las fechas y los filtros de auditoría. Los identificadores deben ser UUID válidos.';
    if (error.status === 401) return 'Tu sesión no es válida. Inicia sesión nuevamente.';
    if (error.status === 403) return 'No tienes permiso para consultar auditoría en este contexto.';
    if (error.status === 404) return 'Los filtros no están disponibles en tu contexto.';
    if (error.status === 503) return 'La auditoría no está disponible temporalmente. Intenta nuevamente.';
  }
  return 'No pudimos consultar los eventos. Revisa la conexión y vuelve a intentar.';
}
export function createAuditApi(api: ApiClient, user: UserProfile) {
  const institutionContext = { institutionId: user.context.institutionId ?? '', ...(user.context.branchId ? { branchId: user.context.branchId } : {}) };
  return { async find(filters: AuditFilters, signal: AbortSignal, cursor?: string): Promise<AuditPage> {
    if (!canReadAudit(user)) throw new ApiError(403);
    const query = auditQuery(filters, institutionContext.branchId, cursor);
    const page = parseAuditPage(await api.request('audit/events', { query, institutionContext, signal }));
    if (page.data.some(row => row.institutionId !== institutionContext.institutionId ||
      (query.branchId && row.branchId !== query.branchId))) throw new ApiError(404);
    return page;
  } };
}
