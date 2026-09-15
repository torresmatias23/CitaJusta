import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { AuthorizationContext } from '../authorization/types/authorization-context.js';
import { PrismaService } from '../database/prisma.service.js';
import { Prisma } from '../generated/prisma/client.js';
import { institutionalDay, type AgendaQuery } from './agenda.schemas.js';

const select = {
  id: true, startsAt: true, endsAt: true, origin: true,
  status: { select: { code: true, name: true } },
  branch: { select: { id: true, name: true } },
  service: { select: { id: true, name: true } },
  professional: { select: { id: true, titleOrFunction: true, user: { select: { firstNames: true, lastNames: true } } } },
  user: { select: { id: true, firstNames: true, lastNames: true } },
} as const satisfies Prisma.AppointmentSelect;

@Injectable()
export class AgendaService {
  constructor(private readonly prisma: PrismaService) {}

  async find(query: AgendaQuery, context: AuthorizationContext) {
    const institutionId = context.institutionId;
    if (!institutionId) throw new BadRequestException('Institutional context required');
    if (context.branchId && query.branchId && context.branchId !== query.branchId) throw new NotFoundException('Resource not found');
    const institution = await this.prisma.institution.findUnique({ where: { id: institutionId }, select: { timeZone: true } });
    if (!institution) throw new NotFoundException('Resource not found');
    const branchId = context.branchId ?? query.branchId;
    // Validate ownership, not current catalog activity: historical appointments remain visible.
    if (branchId && !await this.prisma.branch.findFirst({ where: { id: branchId, institutionId }, select: { id: true } })) throw new NotFoundException('Resource not found');
    if (query.serviceId && !await this.prisma.service.findFirst({ where: { id: query.serviceId, institutionId }, select: { id: true } })) throw new NotFoundException('Resource not found');
    if (query.professionalId && !await this.prisma.professional.findFirst({ where: { id: query.professionalId, institutionId }, select: { id: true } })) throw new NotFoundException('Resource not found');
    const appointments = await this.prisma.appointment.findMany({
      where: {
        institutionId, deletedAt: null, startsAt: institutionalDay(query.date, institution.timeZone),
        ...(branchId ? { branchId } : {}),
        ...(query.serviceId ? { serviceId: query.serviceId } : {}),
        ...(query.professionalId ? { professionalId: query.professionalId } : {}),
        ...(query.status ? { status: { code: query.status } } : {}),
        branch: { institutionId }, service: { institutionId }, professional: { institutionId },
      }, orderBy: [{ startsAt: 'asc' }, { id: 'asc' }], select,
    });
    return { data: appointments.map((row) => ({
      id: row.id, startsAt: row.startsAt.toISOString(), endsAt: row.endsAt.toISOString(), origin: row.origin,
      status: { code: row.status.code, name: row.status.name },
      branch: { id: row.branch.id, name: row.branch.name }, service: { id: row.service.id, name: row.service.name },
      professional: { id: row.professional.id, firstNames: row.professional.user.firstNames,
        lastNames: row.professional.user.lastNames, titleOrFunction: row.professional.titleOrFunction },
      user: { id: row.user.id, firstNames: row.user.firstNames, lastNames: row.user.lastNames },
    })) };
  }
}
