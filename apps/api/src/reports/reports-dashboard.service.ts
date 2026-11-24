import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import type { AuthorizationContext } from '../authorization/types/authorization-context.js';
import { PrismaService } from '../database/prisma.service.js';
import { Prisma } from '../generated/prisma/client.js';
import { dashboardInsights, percentage } from './reports-dashboard.insights.js';
import type { ReportsQuery } from './reports.schemas.js';
import { resolveReportsScope, scopedAppointmentsSql, type ReportsScope } from './reports.scope.js';
import { count, indicatorsSql, mapIndicators, type IndicatorCounts } from './reports.service.js';

export const DASHBOARD_RANKING_LIMIT = 8;
export const DAILY_TREND_MAX_DAYS = 62;

type StatusRow = { total: bigint; booked: bigint; attended: bigint; noShows: bigint; cancelled: bigint };
type DayRow = { day: string; scheduled: bigint; cancelled: bigint; noShows: bigint };
type CapacityRow = { total: bigint; reserved: bigint; available: bigint; inProcess: bigint; expired: bigint };
type BreakdownRow = { id: string; name: string; scheduled: bigint; attended: bigint; noShows: bigint; cancelled: bigint; waiting?: bigint };
type WaitlistRow = { active: bigint; averageWaitDays: number | null; oldestWaitDays: number | null };
type PriorityRow = { name: string; level: number; count: bigint };

const DAY = 86_400_000;
const civil = (value: string) => Date.parse(`${value}T00:00:00Z`);
const iso = (instant: number) => new Date(instant).toISOString().slice(0, 10);
// Monday of the ISO week of a civil date.
const weekStart = (value: string) => { const instant = civil(value); return iso(instant - ((new Date(instant).getUTCDay() + 6) % 7) * DAY); };

function days(value: number | null): number {
  if (value === null) return 0;
  const result = Number(value);
  if (!Number.isFinite(result) || result < 0) throw new ServiceUnavailableException('Indicators unavailable');
  return Number(result.toFixed(1));
}

// Buckets cover the whole requested period, including days without activity.
export function trendBuckets(from: string, to: string, rows: { day: string; scheduled: number; cancelled: number; noShows: number }[]) {
  const granularity = (civil(to) - civil(from)) / DAY + 1 <= DAILY_TREND_MAX_DAYS ? 'day' as const : 'week' as const;
  const key = (value: string) => granularity === 'day' ? value : weekStart(value);
  const buckets = new Map<string, { start: string; scheduled: number; cancelled: number; noShows: number }>();
  for (let instant = civil(key(from)); instant <= civil(to); instant += (granularity === 'day' ? 1 : 7) * DAY) {
    buckets.set(iso(instant), { start: iso(instant), scheduled: 0, cancelled: 0, noShows: 0 });
  }
  const ordered = [...buckets.values()];
  for (const row of rows) {
    // PostgreSQL and the runtime may ship different tzdata versions; never drop an event at the edges.
    const bucket = buckets.get(key(row.day)) ?? (row.day < from ? ordered[0] : ordered.at(-1));
    if (!bucket) throw new ServiceUnavailableException('Indicators unavailable');
    bucket.scheduled += row.scheduled; bucket.cancelled += row.cancelled; bucket.noShows += row.noShows;
  }
  return { granularity, trend: ordered };
}

function cohortSql(scope: ReportsScope, column: Prisma.Sql) {
  return Prisma.sql`cohort AS (
        SELECT ${column} AS id, st.codigo FROM scoped_appointments a JOIN estados_cita st ON st.id = a.estado_id
        WHERE a.deleted_at IS NULL AND a.inicio_at >= ${scope.start}::timestamp AND a.inicio_at < ${scope.end}::timestamp
      ), totals AS (
        SELECT id, count(*) AS scheduled, count(*) FILTER (WHERE codigo = 'ATENDIDA') AS attended,
          count(*) FILTER (WHERE codigo = 'INASISTENCIA') AS "noShows", count(*) FILTER (WHERE codigo = 'CANCELADA') AS cancelled
        FROM cohort GROUP BY id
      )`;
}

// Current demand: active (non final) waitlist entries. Professionals are not a waitlist dimension.
function activeWaitlistSql(scope: ReportsScope) {
  return Prisma.sql`SELECT w.* FROM listas_espera w
        JOIN estados_lista_espera ws ON ws.id = w.estado_id AND NOT ws.es_final
        JOIN servicios ws_service ON ws_service.id = w.servicio_id AND ws_service.institucion_id = w.institucion_id
        WHERE w.institucion_id = ${scope.institutionId}::uuid AND w.deleted_at IS NULL
          ${scope.branchId ? Prisma.sql`AND (w.sede_id IS NULL OR w.sede_id = ${scope.branchId}::uuid)` : Prisma.empty}
          ${scope.serviceId ? Prisma.sql`AND w.servicio_id = ${scope.serviceId}::uuid` : Prisma.empty}`;
}

export function dashboardQueries(scope: ReportsScope) {
  const scoped = scopedAppointmentsSql(scope);
  const inPeriod = (column: Prisma.Sql) => Prisma.sql`${column} >= ${scope.start}::timestamp AND ${column} < ${scope.end}::timestamp`;
  return {
    status: Prisma.sql`WITH ${scoped}
      SELECT count(*) AS total, count(*) FILTER (WHERE st.codigo = 'AGENDADA') AS booked,
        count(*) FILTER (WHERE st.codigo = 'ATENDIDA') AS attended,
        count(*) FILTER (WHERE st.codigo = 'INASISTENCIA') AS "noShows",
        count(*) FILTER (WHERE st.codigo = 'CANCELADA') AS cancelled
      FROM scoped_appointments a JOIN estados_cita st ON st.id = a.estado_id
      WHERE a.deleted_at IS NULL AND ${inPeriod(Prisma.sql`a.inicio_at`)}`,
    // Appointments by start date; cancellations and no-shows by the date they were recorded.
    trend: Prisma.sql`WITH ${scoped}, events AS (
        SELECT a.inicio_at AS at, 1 AS scheduled, 0 AS cancelled, 0 AS no_shows FROM scoped_appointments a
        WHERE a.deleted_at IS NULL AND ${inPeriod(Prisma.sql`a.inicio_at`)}
        UNION ALL
        SELECT c.cancelada_at, 0, 1, 0 FROM cancelaciones c JOIN scoped_appointments a ON a.id = c.cita_id
        WHERE ${inPeriod(Prisma.sql`c.cancelada_at`)}
        UNION ALL
        SELECT min(h.ocurrido_at), 0, 0, 1 FROM scoped_appointments a
        JOIN historial_cambios_cita h ON h.cita_id = a.id
        JOIN estados_cita previous_status ON previous_status.id = h.estado_anterior_id AND previous_status.codigo = 'AGENDADA'
        JOIN estados_cita next_status ON next_status.id = h.estado_nuevo_id AND next_status.codigo = 'INASISTENCIA'
        WHERE a.deleted_at IS NULL AND ${inPeriod(Prisma.sql`h.ocurrido_at`)}
        GROUP BY a.id
      )
      SELECT to_char(((e.at AT TIME ZONE 'UTC') AT TIME ZONE ${scope.timeZone})::date, 'YYYY-MM-DD') AS day,
        sum(e.scheduled)::bigint AS scheduled, sum(e.cancelled)::bigint AS cancelled, sum(e.no_shows)::bigint AS "noShows"
      FROM events e GROUP BY 1 ORDER BY 1`,
    capacity: Prisma.sql`SELECT count(*) AS total,
        count(*) FILTER (WHERE slot.estado = 'RESERVADO') AS reserved,
        count(*) FILTER (WHERE slot.estado = 'DISPONIBLE') AS available,
        count(*) FILTER (WHERE slot.estado IN ('BLOQUEADO', 'LIBERADO')) AS "inProcess",
        count(*) FILTER (WHERE slot.estado = 'EXPIRADO') AS expired
      FROM cupos_agenda slot
      JOIN disponibilidades d ON d.id = slot.disponibilidad_id
      JOIN sedes b ON b.id = d.sede_id AND b.institucion_id = ${scope.institutionId}::uuid
      JOIN servicios s ON s.id = d.servicio_id AND s.institucion_id = b.institucion_id
      JOIN profesionales p ON p.id = d.profesional_id AND p.institucion_id = b.institucion_id
      WHERE ${inPeriod(Prisma.sql`slot.inicio_at`)}
        ${scope.branchId ? Prisma.sql`AND d.sede_id = ${scope.branchId}::uuid` : Prisma.empty}
        ${scope.serviceId ? Prisma.sql`AND d.servicio_id = ${scope.serviceId}::uuid` : Prisma.empty}
        ${scope.professionalId ? Prisma.sql`AND d.profesional_id = ${scope.professionalId}::uuid` : Prisma.empty}`,
    services: Prisma.sql`WITH ${scoped}, ${cohortSql(scope, Prisma.sql`a.servicio_id`)}, waiting AS (
        SELECT w.servicio_id AS id, count(*) AS waiting FROM (${activeWaitlistSql(scope)}) w GROUP BY w.servicio_id
      )
      SELECT s.id::text AS id, s.nombre AS name, coalesce(t.scheduled, 0)::bigint AS scheduled,
        coalesce(t.attended, 0)::bigint AS attended, coalesce(t."noShows", 0)::bigint AS "noShows",
        coalesce(t.cancelled, 0)::bigint AS cancelled, coalesce(wt.waiting, 0)::bigint AS waiting
      FROM servicios s LEFT JOIN totals t ON t.id = s.id LEFT JOIN waiting wt ON wt.id = s.id
      WHERE s.institucion_id = ${scope.institutionId}::uuid
        AND (t.id IS NOT NULL ${scope.professionalId ? Prisma.empty : Prisma.sql`OR wt.id IS NOT NULL`})
      ORDER BY scheduled DESC, waiting DESC, s.nombre ASC, s.id ASC LIMIT ${DASHBOARD_RANKING_LIMIT}`,
    professionals: Prisma.sql`WITH ${scoped}, ${cohortSql(scope, Prisma.sql`a.profesional_id`)}
      SELECT p.id::text AS id, trim(u.nombres || ' ' || u.apellidos) AS name, t.scheduled, t.attended, t."noShows", t.cancelled
      FROM totals t
      JOIN profesionales p ON p.id = t.id AND p.institucion_id = ${scope.institutionId}::uuid
      JOIN usuarios u ON u.id = p.usuario_id
      ORDER BY t.scheduled DESC, name ASC, p.id ASC LIMIT ${DASHBOARD_RANKING_LIMIT}`,
    waitlist: Prisma.sql`SELECT count(*) AS active,
        round((avg(GREATEST(0, EXTRACT(EPOCH FROM ((statement_timestamp() AT TIME ZONE 'UTC') - w.fecha_ingreso_at)) / 86400)))::numeric, 1)::float8 AS "averageWaitDays",
        round((max(GREATEST(0, EXTRACT(EPOCH FROM ((statement_timestamp() AT TIME ZONE 'UTC') - w.fecha_ingreso_at)) / 86400)))::numeric, 1)::float8 AS "oldestWaitDays"
      FROM (${activeWaitlistSql(scope)}) w`,
    priorities: Prisma.sql`SELECT pr.nombre AS name, pr.nivel AS level, count(*) AS count
      FROM (${activeWaitlistSql(scope)}) w JOIN prioridades pr ON pr.id = w.prioridad_id
      GROUP BY pr.id, pr.nombre, pr.nivel ORDER BY pr.nivel ASC, pr.nombre ASC`,
  };
}

const breakdown = (row: BreakdownRow) => {
  const attended = count(row.attended), noShows = count(row.noShows);
  return { id: row.id, name: row.name, scheduled: count(row.scheduled), attended, noShows, cancelled: count(row.cancelled),
    noShowRatePct: percentage(noShows, attended + noShows) };
};

@Injectable()
export class ReportsDashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async find(query: ReportsQuery, context: AuthorizationContext) {
    const scope = await resolveReportsScope(this.prisma, query, context);
    const sql = dashboardQueries(scope);
    // Read-only snapshot shared by every aggregate of the dashboard.
    const [indicatorRows, statusRows, dayRows, capacityRows, serviceRows, professionalRows, waitlistRows, priorityRows] = await this.prisma.$transaction([
      this.prisma.$queryRaw<IndicatorCounts[]>(indicatorsSql(scope)),
      this.prisma.$queryRaw<StatusRow[]>(sql.status),
      this.prisma.$queryRaw<DayRow[]>(sql.trend),
      this.prisma.$queryRaw<CapacityRow[]>(sql.capacity),
      this.prisma.$queryRaw<BreakdownRow[]>(sql.services),
      this.prisma.$queryRaw<BreakdownRow[]>(sql.professionals),
      this.prisma.$queryRaw<WaitlistRow[]>(sql.waitlist),
      this.prisma.$queryRaw<PriorityRow[]>(sql.priorities),
    ], { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
    const [status] = statusRows, [capacityRow] = capacityRows, [waitlistRow] = waitlistRows;
    if (!status || !capacityRow || !waitlistRow) throw new ServiceUnavailableException('Indicators unavailable');

    const indicators = mapIndicators(indicatorRows[0]);
    const appointmentStatus = { total: count(status.total), booked: count(status.booked), attended: count(status.attended),
      noShows: count(status.noShows), cancelled: count(status.cancelled), other: 0 };
    appointmentStatus.other = appointmentStatus.total - appointmentStatus.booked - appointmentStatus.attended - appointmentStatus.noShows - appointmentStatus.cancelled;
    if (appointmentStatus.other < 0) throw new ServiceUnavailableException('Indicators unavailable');
    const capacity = { total: count(capacityRow.total), reserved: count(capacityRow.reserved), available: count(capacityRow.available),
      inProcess: count(capacityRow.inProcess), expired: count(capacityRow.expired) };
    const closed = appointmentStatus.attended + appointmentStatus.noShows;
    const resolvedOffers = indicators.offers.accepted + indicators.offers.rejected + indicators.offers.expired;
    const rates = {
      attendanceRatePct: percentage(appointmentStatus.attended, closed),
      noShowRatePct: percentage(appointmentStatus.noShows, closed),
      cancellationRatePct: percentage(appointmentStatus.cancelled, appointmentStatus.total),
      recoveryRatePct: indicators.slots.recoveryRatePct,
      offerAcceptanceRatePct: percentage(indicators.offers.accepted, resolvedOffers),
      occupancyPct: percentage(capacity.reserved, capacity.total),
    };
    const { granularity, trend } = trendBuckets(query.from, query.to, dayRows.map((row) => ({ day: row.day,
      scheduled: count(row.scheduled), cancelled: count(row.cancelled), noShows: count(row.noShows) })));
    const services = serviceRows.map((row) => ({ ...breakdown(row), waiting: count(row.waiting ?? 0n) }));
    const professionals = professionalRows.map(breakdown);
    const waitlist = { active: count(waitlistRow.active), averageWaitDays: days(waitlistRow.averageWaitDays),
      oldestWaitDays: days(waitlistRow.oldestWaitDays),
      byPriority: priorityRows.map((row) => ({ name: row.name, level: row.level, count: count(row.count) })) };
    const insights = dashboardInsights({ appointmentStatus, rates, slots: indicators.slots, offers: indicators.offers,
      capacity, services, waitlist });
    return { data: { period: { from: query.from, to: query.to }, granularity, indicators, appointmentStatus, rates, capacity,
      trend, services, professionals, waitlist, insights } };
  }
}
