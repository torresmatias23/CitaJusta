import { NotificationsService } from '../notifications/notifications.service.js';
import { randomUUID } from 'node:crypto';
import {
  ConflictException, HttpException, Injectable, InternalServerErrorException,
  NotFoundException, ServiceUnavailableException, UnauthorizedException,
} from '@nestjs/common';
import type { AuthenticatedPrincipal } from '../auth/types/authenticated-principal.js';
import { PrismaService } from '../database/prisma.service.js';
import { isTransactionConflict } from '../database/transaction-conflict.js';
import { BranchStatus, InstitutionStatus, Prisma, UserStatus } from '../generated/prisma/client.js';

const summarySelect = {
  id: true, institutionId: true, enteredAt: true,
  status: { select: { code: true } },
  service: { select: { id: true, institutionId: true, name: true } },
  branch: { select: { id: true, institutionId: true, name: true } },
} as const satisfies Prisma.WaitlistEntrySelect;

type Summary = Prisma.WaitlistEntryGetPayload<{ select: typeof summarySelect }>;
function toSummary(entry: Summary) {
  return {
    id: entry.id, status: entry.status.code, enteredAt: entry.enteredAt.toISOString(),
    service: { id: entry.service.id, name: entry.service.name },
    branch: entry.branch ? { id: entry.branch.id, name: entry.branch.name } : null,
  };
}

@Injectable()
export class WaitlistService {
  constructor(private readonly prisma: PrismaService) {}

  async findMine(principal: AuthenticatedPrincipal) {
    const entries = await this.prisma.waitlistEntry.findMany({
      where: { userId: principal.userId, deletedAt: null, status: { isFinal: false } },
      orderBy: [{ enteredAt: 'asc' }, { id: 'asc' }],
      select: summarySelect,
    });
    return {
      // Inactive catalogs do not erase an open request; inconsistent tenants must not leak.
      data: entries.filter((entry) => entry.service.institutionId === entry.institutionId &&
        (!entry.branch || entry.branch.institutionId === entry.institutionId)).map(toSummary),
    };
  }

  async enter(input: { serviceId: string; branchId?: string }, principal: AuthenticatedPrincipal) {
    return this.enterWithRetry(input, principal, true);
  }

  private async enterWithRetry(
    input: { serviceId: string; branchId?: string }, principal: AuthenticatedPrincipal, retry: boolean,
  ): Promise<{ data: ReturnType<typeof toSummary> }> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const user = await tx.user.findFirst({
          where: { id: principal.userId, status: UserStatus.ACTIVE, deletedAt: null },
          select: { id: true },
        });
        if (!user) throw new UnauthorizedException('Unauthorized');
        const service = await tx.service.findFirst({
          where: {
            id: input.serviceId, active: true, deletedAt: null,
            institution: { status: InstitutionStatus.ACTIVE, deletedAt: null },
          },
          select: { id: true, institutionId: true, allowsWaitlist: true },
        });
        if (!service) throw new NotFoundException('Service not found');
        if (!service.allowsWaitlist) throw new ConflictException('Service does not allow waitlist');
        if (input.branchId) {
          const branch = await tx.branch.findFirst({
            where: {
              id: input.branchId, institutionId: service.institutionId,
              status: BranchStatus.ACTIVE, deletedAt: null,
              serviceAssignments: { some: { serviceId: service.id, active: true } },
            },
            select: { id: true },
          });
          if (!branch) throw new NotFoundException('Branch not found');
        }
        const status = await tx.waitlistStatus.findUnique({
          where: { code: 'ACTIVE' }, select: { id: true, active: true, isFinal: true },
        });
        const priority = await tx.priority.findUnique({
          where: { institutionId_code: { institutionId: service.institutionId, code: 'STANDARD' } },
          select: { id: true, active: true },
        });
        if (!status?.active || status.isFinal || !priority?.active) {
          throw new ServiceUnavailableException('Waitlist catalog is not configured');
        }
        // All writers must perform this predicate read and insert in Serializable.
        // Branch is deliberately excluded: HU-008 owns branch preferences.
        const equivalent = await tx.waitlistEntry.findFirst({
          where: {
            userId: principal.userId, institutionId: service.institutionId, serviceId: service.id,
            deletedAt: null, status: { isFinal: false },
          },
          select: { id: true },
        });
        if (equivalent) throw new ConflictException('An active waitlist entry already exists');
        const entry = await tx.waitlistEntry.create({
          data: {
            id: randomUUID(), userId: principal.userId, institutionId: service.institutionId,
            serviceId: service.id, branchId: input.branchId ?? null,
            priorityId: priority.id, statusId: status.id,
          },
          select: summarySelect,
        });
        await NotificationsService.create(tx, { recipientUserId: principal.userId, type: 'WAITLIST_ENTERED',
          institutionId: entry.institutionId, branchId: input.branchId ?? null, resourceType: 'WAITLIST_ENTRY', resourceId: entry.id,
          dedupeKey: `WAITLIST_ENTERED:${entry.id}`, data: {} });
        return { data: toSummary(entry) };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (error instanceof HttpException) throw error;
      if (isTransactionConflict(error) && retry) return this.enterWithRetry(input, principal, false);
      if (isTransactionConflict(error)) {
        throw new ConflictException('Waitlist conflict; retry request');
      }
      // There is no UNIQUE for active equivalence: unrelated UNIQUE/FK violations
      // cannot be classified as duplicate enrollment. Preserve diagnostics, not public details.
      throw new InternalServerErrorException('Unable to enter waitlist', { cause: error });
    }
  }
}
