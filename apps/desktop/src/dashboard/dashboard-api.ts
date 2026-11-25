import { ApiError } from '@citajusta/client-core';
import type { ApiClient, UserProfile } from '@citajusta/client-core';
import { record } from '../agenda/agenda-api.ts';
import { canReadReports, reportsQuery } from '../reports/reports-api.ts';
import type { Indicators, ReportsFilters } from '../reports/reports-api.ts';

export type InsightSeverity = 'high' | 'medium' | 'info';
export type Insight = { code: string; severity: InsightSeverity; title: string; detail: string; action: string };
export type TrendBucket = { start: string; scheduled: number; cancelled: number; noShows: number };
export type Breakdown = { id: string; name: string; scheduled: number; attended: number; noShows: number; cancelled: number; noShowRatePct: number };
export type Dashboard = {
  period: { from: string; to: string };
  granularity: 'day' | 'week';
  indicators: Omit<Indicators, 'period'>;
  appointmentStatus: { total: number; booked: number; attended: number; noShows: number; cancelled: number; other: number };
  rates: { attendanceRatePct: number; noShowRatePct: number; cancellationRatePct: number; recoveryRatePct: number; offerAcceptanceRatePct: number; occupancyPct: number };
  capacity: { total: number; reserved: number; available: number; inProcess: number; expired: number };
  trend: TrendBucket[];
  services: (Breakdown & { waiting: number })[];
  professionals: Breakdown[];
  waitlist: { active: number; averageWaitDays: number; oldestWaitDays: number; byPriority: { name: string; level: number; count: number }[] };
  insights: Insight[];
};

const invalid = () => new Error('Panel inválido.');
function metric(value: unknown, integer = true): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || (integer && !Number.isSafeInteger(value))) throw invalid();
  return value;
}
function label(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 400) throw invalid();
  return value;
}
function list(value: unknown, limit: number): unknown[] {
  if (!Array.isArray(value) || value.length > limit) throw invalid();
  return value;
}
const civil = /^\d{4}-\d{2}-\d{2}$/;
function numbers<K extends string>(value: unknown, keys: readonly K[], integer = true): Record<K, number> {
  const row = record(value);
  return Object.fromEntries(keys.map(key => [key, metric(row[key], integer)])) as Record<K, number>;
}
function breakdown(value: unknown): Breakdown {
  const row = record(value);
  return { id: label(row.id), name: label(row.name), ...numbers(row, ['scheduled', 'attended', 'noShows', 'cancelled'] as const),
    noShowRatePct: metric(row.noShowRatePct, false) };
}

export function parseDashboard(value: unknown, period: { from: string; to: string }): Dashboard {
  const row = record(record(value).data), dates = record(row.period);
  if (dates.from !== period.from || dates.to !== period.to) throw new Error('Período inesperado.');
  if (row.granularity !== 'day' && row.granularity !== 'week') throw invalid();
  const indicators = record(row.indicators), slots = record(indicators.slots);
  const waitlist = record(row.waitlist);
  return {
    period: { ...period }, granularity: row.granularity,
    indicators: {
      appointments: numbers(indicators.appointments, ['scheduled', 'cancelled', 'noShows'] as const),
      slots: { ...numbers(slots, ['released', 'recovered'] as const), recoveryRatePct: metric(slots.recoveryRatePct, false) },
      offers: numbers(indicators.offers, ['sent', 'accepted', 'rejected', 'expired'] as const),
    },
    appointmentStatus: numbers(row.appointmentStatus, ['total', 'booked', 'attended', 'noShows', 'cancelled', 'other'] as const),
    rates: numbers(row.rates, ['attendanceRatePct', 'noShowRatePct', 'cancellationRatePct', 'recoveryRatePct', 'offerAcceptanceRatePct', 'occupancyPct'] as const, false),
    capacity: numbers(row.capacity, ['total', 'reserved', 'available', 'inProcess', 'expired'] as const),
    trend: list(row.trend, 400).map(item => {
      const bucket = record(item);
      if (typeof bucket.start !== 'string' || !civil.test(bucket.start)) throw invalid();
      return { start: bucket.start, ...numbers(bucket, ['scheduled', 'cancelled', 'noShows'] as const) };
    }),
    services: list(row.services, 50).map(item => ({ ...breakdown(item), waiting: metric(record(item).waiting) })),
    professionals: list(row.professionals, 50).map(breakdown),
    waitlist: {
      ...numbers(waitlist, ['active'] as const),
      ...numbers(waitlist, ['averageWaitDays', 'oldestWaitDays'] as const, false),
      byPriority: list(waitlist.byPriority, 50).map(item => {
        const priority = record(item);
        if (typeof priority.level !== 'number' || !Number.isSafeInteger(priority.level)) throw invalid();
        return { name: label(priority.name), level: priority.level, count: metric(priority.count) };
      }),
    },
    insights: list(row.insights, 20).map(item => {
      const insight = record(item);
      if (insight.severity !== 'high' && insight.severity !== 'medium' && insight.severity !== 'info') throw invalid();
      return { code: label(insight.code), severity: insight.severity, title: label(insight.title), detail: label(insight.detail), action: label(insight.action) };
    }),
  };
}

export function createDashboardApi(api: ApiClient, user: UserProfile) {
  const institutionContext = { institutionId: user.context.institutionId ?? '', ...(user.context.branchId ? { branchId: user.context.branchId } : {}) };
  return { async find(filters: ReportsFilters, signal: AbortSignal): Promise<Dashboard> {
    if (!canReadReports(user)) throw new ApiError(403);
    const query = reportsQuery(filters, institutionContext.branchId);
    const value = await api.request('reports/dashboard', { query, institutionContext, signal });
    return parseDashboard(value, { from: filters.from, to: filters.to });
  } };
}
