import { BadRequestException, NotFoundException } from '@nestjs/common';
import { institutionalDay } from '../agenda/agenda.schemas.js';
import type { AuthorizationContext } from '../authorization/types/authorization-context.js';
import type { PrismaService } from '../database/prisma.service.js';
import { Prisma } from '../generated/prisma/client.js';
import type { ReportsQuery } from './reports.schemas.js';

export interface ReportsScope {
  institutionId: string;
  timeZone: string;
  start: Date;
  end: Date;
  branchId?: string;
  serviceId?: string;
  professionalId?: string;
}

type ScopeReader = Pick<PrismaService, 'institution' | 'branch' | 'service' | 'professional'>;

// Shared by every institutional report: context, ownership of optional filters and
// the half-open UTC interval of the requested institutional days.
export async function resolveReportsScope(prisma: ScopeReader, query: ReportsQuery, context: AuthorizationContext): Promise<ReportsScope> {
  const institutionId = context.institutionId;
  if (!institutionId) throw new BadRequestException('Institutional context required');
  if (context.branchId && query.branchId && context.branchId !== query.branchId) throw new NotFoundException('Resource not found');
  const institution = await prisma.institution.findUnique({ where: { id: institutionId }, select: { timeZone: true } });
  if (!institution) throw new NotFoundException('Resource not found');
  const branchId = context.branchId ?? query.branchId;
  // Historical ownership is sufficient; inactive catalogs must remain reportable.
  if (branchId && !await prisma.branch.findFirst({ where: { id: branchId, institutionId }, select: { id: true } })) throw new NotFoundException('Resource not found');
  if (query.serviceId && !await prisma.service.findFirst({ where: { id: query.serviceId, institutionId }, select: { id: true } })) throw new NotFoundException('Resource not found');
  if (query.professionalId && !await prisma.professional.findFirst({ where: { id: query.professionalId, institutionId }, select: { id: true } })) throw new NotFoundException('Resource not found');
  return {
    institutionId, timeZone: institution.timeZone,
    start: institutionalDay(query.from, institution.timeZone).gte,
    end: institutionalDay(query.to, institution.timeZone).lt,
    ...(branchId ? { branchId } : {}),
    ...(query.serviceId ? { serviceId: query.serviceId } : {}),
    ...(query.professionalId ? { professionalId: query.professionalId } : {}),
  };
}

// Joins enforce ownership AND agreement of redundant FKs, even for inconsistent legacy rows.
export function scopedAppointmentsSql(scope: ReportsScope): Prisma.Sql {
  return Prisma.sql`scoped_appointments AS (
        SELECT a.* FROM citas a
        JOIN sedes b ON b.id = a.sede_id AND b.institucion_id = a.institucion_id
        JOIN servicios s ON s.id = a.servicio_id AND s.institucion_id = a.institucion_id
        JOIN profesionales p ON p.id = a.profesional_id AND p.institucion_id = a.institucion_id
        JOIN cupos_agenda slot ON slot.id = a.cupo_id
        JOIN disponibilidades d ON d.id = slot.disponibilidad_id
          AND d.sede_id = a.sede_id AND d.servicio_id = a.servicio_id AND d.profesional_id = a.profesional_id
          AND d.box_id IS NOT DISTINCT FROM a.box_id
        WHERE (a.box_id IS NULL OR EXISTS (SELECT 1 FROM boxes_atencion box WHERE box.id = a.box_id AND box.sede_id = a.sede_id))
          AND a.institucion_id = ${scope.institutionId}::uuid
          ${scope.branchId ? Prisma.sql`AND a.sede_id = ${scope.branchId}::uuid` : Prisma.empty}
          ${scope.serviceId ? Prisma.sql`AND a.servicio_id = ${scope.serviceId}::uuid` : Prisma.empty}
          ${scope.professionalId ? Prisma.sql`AND a.profesional_id = ${scope.professionalId}::uuid` : Prisma.empty}
      )`;
}
