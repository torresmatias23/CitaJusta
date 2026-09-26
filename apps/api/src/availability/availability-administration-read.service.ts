import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { AuthorizationContext } from '../authorization/types/authorization-context.js';
import { PrismaService } from '../database/prisma.service.js';
import { institutionalDay } from '../agenda/agenda.schemas.js';
import type { AvailabilityQuery, BlockQuery } from './availability-administration-read.schemas.js';

const namedSelect = { id: true, name: true } as const;
const professionalSelect = { id: true, titleOrFunction: true, user: { select: { firstNames: true, lastNames: true } } } as const;
const relations = { branch: { select: namedSelect }, attentionPoint: { select: namedSelect }, professional: { select: professionalSelect } } as const;
function professional(row: { id: string; titleOrFunction: string | null; user: { firstNames: string; lastNames: string } }) {
  return { id: row.id, firstNames: row.user.firstNames, lastNames: row.user.lastNames, titleOrFunction: row.titleOrFunction };
}

@Injectable()
export class AvailabilityAdministrationReadService {
  constructor(private readonly prisma: PrismaService) {}

  private async scope(query: AvailabilityQuery, context: AuthorizationContext) {
    const institutionId = context.institutionId;
    if (!institutionId) throw new BadRequestException('Institutional context required');
    if (context.branchId && query.branchId && context.branchId !== query.branchId) throw new NotFoundException('Resource not found');
    const institution = await this.prisma.institution.findUnique({ where: { id: institutionId }, select: { timeZone: true } });
    if (!institution) throw new NotFoundException('Resource not found');
    const branchId = context.branchId ?? query.branchId;
    // Ownership only: inactive catalogs must not hide administrative history.
    if (branchId && !await this.prisma.branch.findFirst({ where: { id: branchId, institutionId }, select: { id: true } })) throw new NotFoundException('Resource not found');
    if (query.serviceId && !await this.prisma.service.findFirst({ where: { id: query.serviceId, institutionId }, select: { id: true } })) throw new NotFoundException('Resource not found');
    if (query.professionalId && !await this.prisma.professional.findFirst({ where: { id: query.professionalId, institutionId }, select: { id: true } })) throw new NotFoundException('Resource not found');
    return { institutionId, branchId, timeZone: institution.timeZone, day: institutionalDay(query.date, institution.timeZone) };
  }

  async find(query: AvailabilityQuery, context: AuthorizationContext) {
    const { institutionId, branchId, timeZone } = await this.scope(query, context);
    const rows = await this.prisma.availability.findMany({
      where: {
        // HU-014 stores the institutional civil date in a PostgreSQL DATE, not an instant.
        date: new Date(`${query.date}T00:00:00Z`),
        ...(branchId ? { branchId } : {}), ...(query.serviceId ? { serviceId: query.serviceId } : {}),
        ...(query.professionalId ? { professionalId: query.professionalId } : {}),
        branch: { institutionId }, service: { institutionId }, professional: { institutionId },
        OR: [{ attentionPointId: null }, { attentionPoint: { branch: { institutionId } } }],
      }, orderBy: [{ startTime: 'asc' }, { id: 'asc' }],
      select: { id: true, date: true, startTime: true, endTime: true, active: true, capacity: true, origin: true,
        createdAt: true, updatedAt: true, service: { select: namedSelect }, ...relations },
    });
    return { data: rows.map(row => ({ id: row.id, date: row.date.toISOString().slice(0, 10),
      startTime: row.startTime.toISOString().slice(11, 16), endTime: row.endTime.toISOString().slice(11, 16), timeZone,
      active: row.active, capacity: row.capacity, origin: row.origin, branch: row.branch, service: row.service,
      professional: professional(row.professional), attentionPoint: row.attentionPoint,
      createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() })) };
  }

  async blocks(query: BlockQuery, context: AuthorizationContext) {
    const { institutionId, branchId, day } = await this.scope(query, context);
    const rows = await this.prisma.scheduleBlock.findMany({
      where: { institutionId, startsAt: { lt: day.lt }, endsAt: { gt: day.gte },
        ...(branchId ? { branchId } : {}), ...(query.professionalId ? { professionalId: query.professionalId } : {}),
        AND: [
          { OR: [{ branchId: null }, { branch: { institutionId } }] },
          { OR: [{ professionalId: null }, { professional: { institutionId } }] },
          { OR: [{ attentionPointId: null }, { attentionPoint: { branch: { institutionId } } }] },
        ],
      }, orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
      select: { id: true, type: true, reason: true, startsAt: true, endsAt: true, createdAt: true, ...relations },
    });
    return { data: rows.map(row => ({ id: row.id, branch: row.branch,
      professional: row.professional ? professional(row.professional) : null, attentionPoint: row.attentionPoint,
      type: row.type, reason: row.reason, startsAt: row.startsAt.toISOString(), endsAt: row.endsAt.toISOString(), createdAt: row.createdAt.toISOString() })) };
  }
}
