import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import type { AuthorizationContext } from '../authorization/types/authorization-context.js';
import { PrismaService } from '../database/prisma.service.js';
import { Prisma } from '../generated/prisma/client.js';
import type { ReportsQuery } from './reports.schemas.js';
import { resolveReportsScope, scopedAppointmentsSql, type ReportsScope } from './reports.scope.js';

export type IndicatorCounts = { scheduled: bigint; cancelled: bigint; noShows: bigint; released: bigint; recovered: bigint;
  sent: bigint; accepted: bigint; rejected: bigint; expired: bigint };

export function count(value: bigint): number {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 0) throw new ServiceUnavailableException('Indicators unavailable');
  return result;
}

// One parameterized SELECT: all metrics share a PostgreSQL statement snapshot.
export function indicatorsSql(scope: ReportsScope): Prisma.Sql {
  return Prisma.sql`
      WITH period AS (
        SELECT ${scope.start}::timestamp AS start_at, ${scope.end}::timestamp AS end_at,
          (statement_timestamp() AT TIME ZONE 'UTC') AS now_at
      ), ${scopedAppointmentsSql(scope)}, scoped_cancellations AS (
        SELECT c.* FROM cancelaciones c JOIN scoped_appointments a ON a.id = c.cita_id
      ), scoped_reassignments AS (
        SELECT r.* FROM reasignaciones r
        JOIN scoped_appointments a ON a.id = r.cita_id AND a.cupo_id = r.cupo_id
          AND a.institucion_id = r.institucion_id AND a.servicio_id = r.servicio_id
        JOIN scoped_cancellations c ON c.id = r.cancelacion_origen_id AND c.cita_id = a.id AND c.libera_cupo
      ), scoped_offers AS (
        SELECT o.* FROM ofertas_cita o
        JOIN scoped_reassignments r ON r.id = o.reasignacion_id AND r.cupo_id = o.cupo_id
        JOIN candidatos_reasignacion c ON c.id = o.candidato_id AND c.reasignacion_id = r.id
        JOIN listas_espera w ON w.id = c.lista_espera_id
          AND w.institucion_id = r.institucion_id AND w.servicio_id = r.servicio_id AND w.usuario_id = c.usuario_id
          AND (w.sede_id IS NULL OR EXISTS (SELECT 1 FROM sedes wb WHERE wb.id = w.sede_id AND wb.institucion_id = r.institucion_id))
      )
      SELECT
        (SELECT count(*) FROM scoped_appointments a WHERE a.deleted_at IS NULL AND a.inicio_at >= t.start_at AND a.inicio_at < t.end_at) AS scheduled,
        (SELECT count(*) FROM scoped_cancellations c WHERE c.cancelada_at >= t.start_at AND c.cancelada_at < t.end_at) AS cancelled,
        -- HU-017 writes the transition and its database timestamp atomically.
        -- EXISTS counts each appointment once even if duplicate history rows exist.
        (SELECT count(*) FROM scoped_appointments a WHERE a.deleted_at IS NULL AND EXISTS (
          SELECT 1 FROM historial_cambios_cita h
          JOIN estados_cita previous ON previous.id = h.estado_anterior_id AND previous.codigo = 'AGENDADA'
          JOIN estados_cita next ON next.id = h.estado_nuevo_id AND next.codigo = 'INASISTENCIA'
          WHERE h.cita_id = a.id AND h.ocurrido_at >= t.start_at AND h.ocurrido_at < t.end_at
        )) AS "noShows",
        (SELECT count(*) FROM scoped_cancellations c WHERE c.libera_cupo AND c.cancelada_at >= t.start_at AND c.cancelada_at < t.end_at) AS released,
        (SELECT count(*) FROM scoped_reassignments r WHERE r.estado = 'COMPLETADA'
          AND r.finalizada_at >= t.start_at AND r.finalizada_at < t.end_at
          AND EXISTS (SELECT 1 FROM scoped_offers o WHERE o.reasignacion_id = r.id AND o.estado = 'ACEPTADA'
            AND o.respondida_at IS NOT NULL AND o.resuelta_at IS NOT NULL)) AS recovered,
        (SELECT count(*) FROM scoped_offers o WHERE o.created_at >= t.start_at AND o.created_at < t.end_at) AS sent,
        (SELECT count(*) FROM scoped_offers o WHERE o.estado = 'ACEPTADA' AND o.respondida_at >= t.start_at AND o.respondida_at < t.end_at) AS accepted,
        (SELECT count(*) FROM scoped_offers o WHERE o.estado = 'RECHAZADA' AND o.respondida_at >= t.start_at AND o.respondida_at < t.end_at) AS rejected,
        (SELECT count(*) FROM scoped_offers o WHERE o.expira_at >= t.start_at AND o.expira_at < t.end_at
          AND (o.estado = 'EXPIRADA' OR (o.estado = 'PENDIENTE' AND o.expira_at <= t.now_at))) AS expired
      FROM period t
    `;
}

export function mapIndicators(row: IndicatorCounts | undefined) {
  if (!row) throw new ServiceUnavailableException('Indicators unavailable');
  const released = count(row.released);
  const recovered = count(row.recovered);
  return {
    appointments: { scheduled: count(row.scheduled), cancelled: count(row.cancelled), noShows: count(row.noShows) },
    slots: { released, recovered, recoveryRatePct: released > 0 ? Number((recovered / released * 100).toFixed(2)) : 0 },
    offers: { sent: count(row.sent), accepted: count(row.accepted), rejected: count(row.rejected), expired: count(row.expired) },
  };
}

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  async find(query: ReportsQuery, context: AuthorizationContext) {
    const scope = await resolveReportsScope(this.prisma, query, context);
    const [row] = await this.prisma.$queryRaw<IndicatorCounts[]>(indicatorsSql(scope));
    return { data: { period: { from: query.from, to: query.to }, ...mapIndicators(row) } };
  }
}
