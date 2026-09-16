import { BadRequestException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { institutionalDay } from '../agenda/agenda.schemas.js';
import type { AuthorizationContext } from '../authorization/types/authorization-context.js';
import { PrismaService } from '../database/prisma.service.js';
import { Prisma } from '../generated/prisma/client.js';
import type { ReportsQuery } from './reports.schemas.js';

type Counts = { scheduled: bigint; cancelled: bigint; noShows: bigint; released: bigint; recovered: bigint;
  sent: bigint; accepted: bigint; rejected: bigint; expired: bigint };

function count(value: bigint): number {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 0) throw new ServiceUnavailableException('Indicators unavailable');
  return result;
}

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  async find(query: ReportsQuery, context: AuthorizationContext) {
    const institutionId = context.institutionId;
    if (!institutionId) throw new BadRequestException('Institutional context required');
    if (context.branchId && query.branchId && context.branchId !== query.branchId) throw new NotFoundException('Resource not found');
    const institution = await this.prisma.institution.findUnique({ where: { id: institutionId }, select: { timeZone: true } });
    if (!institution) throw new NotFoundException('Resource not found');
    const branchId = context.branchId ?? query.branchId;
    // Historical ownership is sufficient; inactive catalogs must remain reportable.
    if (branchId && !await this.prisma.branch.findFirst({ where: { id: branchId, institutionId }, select: { id: true } })) throw new NotFoundException('Resource not found');
    if (query.serviceId && !await this.prisma.service.findFirst({ where: { id: query.serviceId, institutionId }, select: { id: true } })) throw new NotFoundException('Resource not found');
    if (query.professionalId && !await this.prisma.professional.findFirst({ where: { id: query.professionalId, institutionId }, select: { id: true } })) throw new NotFoundException('Resource not found');
    const from = institutionalDay(query.from, institution.timeZone).gte;
    const until = institutionalDay(query.to, institution.timeZone).lt;

    // One parameterized SELECT: all metrics share a PostgreSQL statement snapshot.
    // Joins enforce ownership AND agreement of redundant FKs, even for inconsistent legacy rows.
    const [row] = await this.prisma.$queryRaw<Counts[]>(Prisma.sql`
      WITH period AS (
        SELECT ${from}::timestamp AS start_at, ${until}::timestamp AS end_at,
          (statement_timestamp() AT TIME ZONE 'UTC') AS now_at
      ), scoped_appointments AS (
        SELECT a.* FROM citas a
        JOIN sedes b ON b.id = a.sede_id AND b.institucion_id = a.institucion_id
        JOIN servicios s ON s.id = a.servicio_id AND s.institucion_id = a.institucion_id
        JOIN profesionales p ON p.id = a.profesional_id AND p.institucion_id = a.institucion_id
        JOIN cupos_agenda slot ON slot.id = a.cupo_id
        JOIN disponibilidades d ON d.id = slot.disponibilidad_id
          AND d.sede_id = a.sede_id AND d.servicio_id = a.servicio_id AND d.profesional_id = a.profesional_id
          AND d.box_id IS NOT DISTINCT FROM a.box_id
        WHERE (a.box_id IS NULL OR EXISTS (SELECT 1 FROM boxes_atencion box WHERE box.id = a.box_id AND box.sede_id = a.sede_id))
          AND a.institucion_id = ${institutionId}::uuid
          ${branchId ? Prisma.sql`AND a.sede_id = ${branchId}::uuid` : Prisma.empty}
          ${query.serviceId ? Prisma.sql`AND a.servicio_id = ${query.serviceId}::uuid` : Prisma.empty}
          ${query.professionalId ? Prisma.sql`AND a.profesional_id = ${query.professionalId}::uuid` : Prisma.empty}
      ), scoped_cancellations AS (
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
    `);
    if (!row) throw new ServiceUnavailableException('Indicators unavailable');
    const released = count(row.released);
    const recovered = count(row.recovered);
    return { data: {
      period: { from: query.from, to: query.to },
      appointments: { scheduled: count(row.scheduled), cancelled: count(row.cancelled), noShows: count(row.noShows) },
      slots: { released, recovered, recoveryRatePct: released > 0 ? Number((recovered / released * 100).toFixed(2)) : 0 },
      offers: { sent: count(row.sent), accepted: count(row.accepted), rejected: count(row.rejected), expired: count(row.expired) },
    } };
  }
}
