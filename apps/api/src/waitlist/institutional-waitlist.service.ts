import { HttpException, Injectable, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import type { AuthorizationContext } from '../authorization/types/authorization-context.js';
import { encodeInstitutionalCursor } from '../common/institutional-listing.schemas.js';
import { institutionalListingScope, institutionalWaitlistWhere } from '../common/institutional-listing.scope.js';
import { PrismaService } from '../database/prisma.service.js';
import { Prisma } from '../generated/prisma/client.js';
import type { InstitutionalWaitlistQuery } from './institutional-waitlist.schemas.js';

export const READ_INSTITUTIONAL_WAITLIST = 'waitlist.read';
const select = {
  id: true, enteredAt: true, status: { select: { code: true, name: true } },
  user: { select: { id: true, firstNames: true, lastNames: true } },
  service: { select: { id: true, name: true } }, branch: { select: { id: true, name: true } },
} as const satisfies Prisma.WaitlistEntrySelect;

@Injectable()
export class InstitutionalWaitlistService {
  constructor(private readonly prisma: PrismaService) {}

  async find(query: InstitutionalWaitlistQuery, context: AuthorizationContext) {
    try {
      const { institutionId, branchId } = await institutionalListingScope(this.prisma, context, READ_INSTITUTIONAL_WAITLIST, query.branchId);
      if (query.serviceId && !await this.prisma.service.findFirst({ where: {
        id: query.serviceId, institutionId,
        ...(branchId ? { branchAssignments: { some: { branchId, branch: { institutionId } } } } : {}),
      }, select: { id: true } })) throw new NotFoundException('Resource not found');
      const where: Prisma.WaitlistEntryWhereInput = {
        ...institutionalWaitlistWhere(institutionId, branchId),
        ...(query.status ? { status: { code: query.status } } : {}),
        ...(query.serviceId ? { serviceId: query.serviceId } : {}),
        ...(query.userId ? { userId: query.userId } : {}),
      };
      if (query.cursor && !await this.prisma.waitlistEntry.findFirst({ where: { AND: [where, { id: query.cursor.id }] }, select: { id: true } })) {
        throw new NotFoundException('Resource not found');
      }
      const rows = await this.prisma.waitlistEntry.findMany({
        where, select, take: query.limit + 1, orderBy: [{ enteredAt: 'desc' }, { id: 'desc' }],
        ...(query.cursor ? { cursor: query.cursor, skip: 1 } : {}),
      });
      const visible = rows.slice(0, query.limit), last = visible.at(-1);
      return {
        data: visible.map(row => ({
          id: row.id, enteredAt: row.enteredAt.toISOString(),
          status: { code: row.status.code, name: row.status.name },
          user: { id: row.user.id, firstNames: row.user.firstNames, lastNames: row.user.lastNames },
          service: { id: row.service.id, name: row.service.name },
          branch: row.branch ? { id: row.branch.id, name: row.branch.name } : null,
        })),
        page: { nextCursor: rows.length > query.limit && last ? encodeInstitutionalCursor('waitlist', last.id) : null },
      };
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new InternalServerErrorException('Unable to list institutional waitlist');
    }
  }
}
