import { HttpException, Injectable, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import type { AuthorizationContext } from '../authorization/types/authorization-context.js';
import { encodeInstitutionalCursor } from '../common/institutional-listing.schemas.js';
import { institutionalListingScope, institutionalWaitlistWhere } from '../common/institutional-listing.scope.js';
import { PrismaService } from '../database/prisma.service.js';
import { Prisma } from '../generated/prisma/client.js';
import type { InstitutionalUsersQuery } from './institutional-users.schemas.js';

export const READ_INSTITUTIONAL_USERS = 'users.read';
const select = { id: true, firstNames: true, lastNames: true } as const satisfies Prisma.UserSelect;

// User is a global identity. Only a scoped, coherent domain relation establishes visibility.
function linkedUsers(institutionId: string, branchId: string | undefined, now: Date): Prisma.UserWhereInput {
  return {
    deletedAt: null,
    OR: [
      { appointments: { some: {
        institutionId, deletedAt: null, ...(branchId ? { branchId } : {}),
        branch: { institutionId }, service: { institutionId }, professional: { institutionId },
        agendaSlot: { availability: {
          ...(branchId ? { branchId } : {}),
          branch: { institutionId }, service: { institutionId }, professional: { institutionId },
        } },
      } } },
      { waitlistEntries: { some: institutionalWaitlistWhere(institutionId, branchId) } },
      { professionalProfiles: { some: {
        institutionId, deletedAt: null,
        ...(branchId ? { branchAssignments: { some: { branchId, active: true, branch: { institutionId } } } } : {}),
      } } },
      { roleAssignments: { some: {
        active: true, role: { active: true },
        AND: [
          { OR: [{ validFrom: null }, { validFrom: { lte: now } }] },
          { OR: [{ validTo: null }, { validTo: { gte: now } }] },
          branchId ? { branchId, branch: { institutionId }, role: { scope: 'BRANCH' },
            OR: [{ institutionId }, { institutionId: null }] }
            : { OR: [
              { institutionId, branchId: null, role: { scope: 'INSTITUTION' } },
              { branch: { institutionId }, role: { scope: 'BRANCH' }, OR: [{ institutionId }, { institutionId: null }] },
            ] },
        ],
      } } },
    ],
  };
}

@Injectable()
export class InstitutionalUsersService {
  constructor(private readonly prisma: PrismaService) {}

  async find(query: InstitutionalUsersQuery, context: AuthorizationContext) {
    try {
      const { institutionId, branchId } = await institutionalListingScope(this.prisma, context, READ_INSTITUTIONAL_USERS, query.branchId);
      // Escape PostgreSQL LIKE metacharacters: q is literal text, not a wildcard expression.
      const terms = query.q?.split(/\s+/).map(term => term.replace(/[\\%_]/g, '\\$&')) ?? [];
      const where: Prisma.UserWhereInput = {
        AND: [linkedUsers(institutionId, branchId, new Date()), ...terms.map(term => ({ OR: [
          { firstNames: { contains: term, mode: 'insensitive' as const } },
          { lastNames: { contains: term, mode: 'insensitive' as const } },
        ] }))],
      };
      if (query.cursor && !await this.prisma.user.findFirst({ where: { AND: [where, { id: query.cursor.id }] }, select: { id: true } })) {
        throw new NotFoundException('Resource not found');
      }
      const rows = await this.prisma.user.findMany({
        where, select, orderBy: { id: 'asc' }, take: query.limit + 1,
        ...(query.cursor ? { cursor: query.cursor, skip: 1 } : {}),
      });
      const visible = rows.slice(0, query.limit), last = visible.at(-1);
      return {
        data: visible.map(row => ({ id: row.id, firstNames: row.firstNames, lastNames: row.lastNames })),
        page: { nextCursor: rows.length > query.limit && last ? encodeInstitutionalCursor('users', last.id) : null },
      };
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new InternalServerErrorException('Unable to list institutional users');
    }
  }
}
