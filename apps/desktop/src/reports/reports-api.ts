import { ApiError } from '@citajusta/client-core';
import type { ApiClient, UserProfile } from '@citajusta/client-core';
import { record } from '../agenda/agenda-api.ts';
import { uuidPattern } from '../catalog/catalog-api.ts';

export type ReportsFilters = { from: string; to: string; branchId?: string; serviceId?: string; professionalId?: string };
export type Indicators = {
  period: { from: string; to: string };
  appointments: { scheduled: number; cancelled: number; noShows: number };
  slots: { released: number; recovered: number; recoveryRatePct: number };
  offers: { sent: number; accepted: number; rejected: number; expired: number };
};
function civilDate(value: unknown): number {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new ApiError(400);
  const instant = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(instant.getTime()) || instant.toISOString().slice(0, 10) !== value) throw new ApiError(400);
  return instant.getTime();
}
export function reportsQuery(filters: ReportsFilters, branchContext?: string): Record<string, string> {
  if (Object.keys(filters).some(key => !['from', 'to', 'branchId', 'serviceId', 'professionalId'].includes(key))) throw new ApiError(400);
  // Calendar arithmetic validates the inclusive span only; the API receives civil dates, never UTC bounds.
  const days = (civilDate(filters.to) - civilDate(filters.from)) / 86_400_000 + 1;
  if (days < 1 || days > 366) throw new ApiError(400);
  if (branchContext && filters.branchId && filters.branchId !== branchContext) throw new ApiError(404);
  const query: Record<string, string> = { from: filters.from, to: filters.to };
  for (const key of ['branchId', 'serviceId', 'professionalId'] as const) {
    const value = key === 'branchId' ? branchContext ?? filters[key] : filters[key];
    if (value !== undefined && value !== '') {
      if (typeof value !== 'string' || !uuidPattern.test(value)) throw new ApiError(400);
      query[key] = value;
    }
  }
  return query;
}
function metric(value: unknown, integer = true): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || (integer && !Number.isSafeInteger(value))) throw new Error('Indicadores inválidos.');
  return value;
}
export function parseIndicators(value: unknown, period: { from: string; to: string }): Indicators {
  const row = record(record(value).data), dates = record(row.period);
  if (dates.from !== period.from || dates.to !== period.to) throw new Error('Período inesperado.');
  const a = record(row.appointments), s = record(row.slots), o = record(row.offers);
  return { period: { ...period },
    appointments: { scheduled: metric(a.scheduled), cancelled: metric(a.cancelled), noShows: metric(a.noShows) },
    slots: { released: metric(s.released), recovered: metric(s.recovered), recoveryRatePct: metric(s.recoveryRatePct, false) },
    offers: { sent: metric(o.sent), accepted: metric(o.accepted), rejected: metric(o.rejected), expired: metric(o.expired) } };
}
export function canReadReports(user: UserProfile): boolean { return Boolean(user.context.institutionId) && user.permissions.includes('reports.read'); }
export function reportsError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 400) return 'Revisa las fechas y los filtros: el período debe ser válido y abarcar entre 1 y 366 días inclusivos.';
    if (error.status === 401) return 'Tu sesión no es válida. Inicia sesión nuevamente.';
    if (error.status === 403) return 'No tienes permiso para consultar reportes en este contexto.';
    if (error.status === 404) return 'Los filtros no están disponibles en tu contexto.';
    if (error.status === 503) return 'Los reportes no están disponibles temporalmente. Intenta nuevamente.';
  }
  return 'No pudimos consultar los indicadores. Revisa la conexión y vuelve a intentar.';
}
export function createReportsApi(api: ApiClient, user: UserProfile) {
  const institutionContext = { institutionId: user.context.institutionId ?? '', ...(user.context.branchId ? { branchId: user.context.branchId } : {}) };
  return { async find(filters: ReportsFilters, signal: AbortSignal): Promise<Indicators> {
    if (!canReadReports(user)) throw new ApiError(403);
    const query = reportsQuery(filters, institutionContext.branchId);
    const value = await api.request('reports/indicators', { query, institutionContext, signal });
    return parseIndicators(value, { from: filters.from, to: filters.to });
  } };
}
