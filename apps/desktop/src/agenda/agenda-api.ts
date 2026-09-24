import { ApiError } from '@citajusta/client-core';
import type { ApiClient, UserProfile } from '@citajusta/client-core';
import { uuidPattern } from '../catalog/catalog-api.ts';

export type Named = { id: string; name: string };
export type AgendaAppointment = {
  id: string; startsAt: string; endsAt: string; origin: string;
  status: { code: string; name: string }; branch: Named; service: Named;
  professional: { id: string; firstNames: string; lastNames: string; titleOrFunction: string | null };
  user: { id: string; firstNames: string; lastNames: string };
};
export type AgendaFilters = { date: string; branchId?: string; serviceId?: string; professionalId?: string; status?: string };

export function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Respuesta inválida.');
  return value as Record<string, unknown>;
}
export function text(value: unknown): string {
  if (typeof value !== 'string' || !value) throw new Error('Respuesta inválida.');
  return value;
}
export function uuid(value: unknown): string {
  const result = text(value); if (!uuidPattern.test(result)) throw new Error('Identificador inválido.'); return result;
}
export function named(value: unknown): Named { const row = record(value); return { id: uuid(row.id), name: text(row.name) }; }
export function list<T>(value: unknown, decode: (value: unknown) => T): T[] {
  const data = record(value).data;
  if (!Array.isArray(data)) throw new Error('Respuesta inválida.');
  return data.map(decode);
}
function instant(value: unknown): string {
  const result = text(value);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(result)
    || !Number.isFinite(Date.parse(result)) || new Date(result).toISOString() !== result) throw new Error('Fecha inválida.');
  return result;
}
function appointment(value: unknown): AgendaAppointment {
  const row = record(value), status = record(row.status), professional = record(row.professional), user = record(row.user);
  const startsAt = instant(row.startsAt), endsAt = instant(row.endsAt);
  if (endsAt <= startsAt) throw new Error('Intervalo inválido.');
  if (professional.titleOrFunction !== null && typeof professional.titleOrFunction !== 'string') throw new Error('Respuesta inválida.');
  return { id: uuid(row.id), startsAt, endsAt, origin: text(row.origin),
    status: { code: text(status.code), name: text(status.name) }, branch: named(row.branch), service: named(row.service),
    professional: { id: uuid(professional.id), firstNames: text(professional.firstNames), lastNames: text(professional.lastNames), titleOrFunction: professional.titleOrFunction },
    user: { id: uuid(user.id), firstNames: text(user.firstNames), lastNames: text(user.lastNames) } };
}
export function canReadAgenda(user: UserProfile): boolean {
  return Boolean(user.context.institutionId) && user.permissions.includes('agenda.read');
}
export function agendaQuery(filters: AgendaFilters, branchContext?: string): Record<string, string> {
  if (typeof filters.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(filters.date)) throw new ApiError(400);
  // Valida la fecha civil; no calcula el día institucional ni rangos para la API.
  const date = new Date(`${filters.date}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== filters.date) throw new ApiError(400);
  if (branchContext && filters.branchId && filters.branchId !== branchContext) throw new ApiError(404);
  const query: Record<string, string> = { date: filters.date };
  for (const key of ['branchId', 'serviceId', 'professionalId'] as const) {
    const value = key === 'branchId' ? branchContext ?? filters[key] : filters[key];
    if (value !== undefined && value !== '') {
      if (typeof value !== 'string' || !uuidPattern.test(value)) throw new ApiError(400);
      query[key] = value;
    }
  }
  if (filters.status !== undefined && filters.status !== '') {
    if (typeof filters.status !== 'string' || filters.status.length > 60) throw new ApiError(400);
    query.status = filters.status;
  }
  return query;
}
export function agendaError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 401) return 'Tu sesión no es válida. Inicia sesión nuevamente.';
    if (error.status === 403) return 'No tienes permiso para consultar la agenda.';
    if (error.status === 404) return 'El filtro o recurso no está disponible en tu contexto.';
    if (error.status === 400) return 'Revisa la fecha y los filtros ingresados.';
  }
  return 'No pudimos consultar la agenda. Revisa la conexión y vuelve a intentar.';
}
export function createAgendaApi(api: ApiClient, user: UserProfile) {
  const institutionContext = { institutionId: user.context.institutionId ?? '', ...(user.context.branchId ? { branchId: user.context.branchId } : {}) };
  return {
    async find(filters: AgendaFilters, signal: AbortSignal): Promise<AgendaAppointment[]> {
      if (!canReadAgenda(user)) throw new ApiError(403);
      return list(await api.request('agenda', { query: agendaQuery(filters, user.context.branchId), institutionContext, signal }), appointment);
    },
  };
}

export function formatAgendaTime(iso: string, timeZone: string | null): string {
  return new Intl.DateTimeFormat('es-CL', { timeZone: timeZone ?? 'UTC', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso));
}
