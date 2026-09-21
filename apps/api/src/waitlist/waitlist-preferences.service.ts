import { NotificationsService } from '../notifications/notifications.service.js';
import { randomUUID } from 'node:crypto';
import {
  ConflictException, HttpException, Injectable, InternalServerErrorException,
  NotFoundException, ServiceUnavailableException, UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { isTransactionConflict } from '../database/transaction-conflict.js';
import { BranchStatus, Prisma, UserStatus } from '../generated/prisma/client.js';
import type { AuthenticatedPrincipal } from '../auth/types/authenticated-principal.js';
import type { WaitlistPreferencesInput } from './waitlist.schemas.js';

const entrySelect = {
  id: true, institutionId: true, branchId: true, serviceId: true, updatedAt: true, allowsOtherBranches: true,
  status: { select: { code: true, isFinal: true } },
  service: { select: { institutionId: true } },
  branch: { select: { institutionId: true } },
  preference: {
    select: {
      id: true, acceptsAnyProfessional: true,
      preferredDays: { select: { dayOfWeek: true }, orderBy: { dayOfWeek: 'asc' } },
      timeRanges: { select: { startTime: true, endTime: true }, orderBy: [{ startTime: 'asc' }, { endTime: 'asc' }] },
    },
  },
  preferredBranches: {
    select: { branchId: true, branch: { select: { institutionId: true } } },
    orderBy: { preferenceOrder: 'asc' },
  },
} as const satisfies Prisma.WaitlistEntrySelect;
type Entry = Prisma.WaitlistEntryGetPayload<{ select: typeof entrySelect }>;

function toPreferences(entry: Entry): WaitlistPreferencesInput {
  return {
    preferredDays: entry.preference?.preferredDays.map((day) => day.dayOfWeek) ?? [],
    timeRanges: entry.preference?.timeRanges.map((range) => ({
      start: range.startTime.toISOString().slice(11, 16), end: range.endTime.toISOString().slice(11, 16),
    })) ?? [],
    preferredBranchIds: entry.preferredBranches
      .filter((preferred) => preferred.branch.institutionId === entry.institutionId)
      .map((preferred) => preferred.branchId),
    allowsOtherBranches: entry.allowsOtherBranches,
    acceptsAnyProfessional: entry.preference?.acceptsAnyProfessional ?? true,
  };
}

// Prisma represents PostgreSQL TIME as Date. UTC is only the transport anchor,
// not a conversion of these local wall-clock preferences into UTC appointments.
function databaseTime(value: string) { return new Date(`1970-01-01T${value}:00.000Z`); }
function nextUpdatedAt(previous: Date) {
  return new Date(Math.max(Date.now(), previous.getTime() + 1));
}

@Injectable()
export class WaitlistPreferencesService {
  constructor(private readonly prisma: PrismaService) {}

  get(id: string, principal: AuthenticatedPrincipal) {
    return this.withEntry(id, principal, async (_tx, entry) => ({ data: toPreferences(entry) }));
  }

  replace(id: string, input: WaitlistPreferencesInput, principal: AuthenticatedPrincipal) {
    return this.withEntry(id, principal, async (tx, entry) => {
      if (entry.status.isFinal) throw new ConflictException('Waitlist entry is finalized');
      if (input.preferredBranchIds.length > 0) {
        const branches = await tx.branch.findMany({
          where: {
            id: { in: input.preferredBranchIds }, institutionId: entry.institutionId,
            status: BranchStatus.ACTIVE, deletedAt: null,
            serviceAssignments: { some: { serviceId: entry.serviceId, active: true } },
          },
          select: { id: true },
        });
        if (branches.length !== input.preferredBranchIds.length) throw new NotFoundException('Preferred branch not found');
      }
      const preference = await tx.waitlistPreference.upsert({
        where: { waitlistEntryId: entry.id },
        create: { id: randomUUID(), waitlistEntryId: entry.id, acceptsAnyProfessional: input.acceptsAnyProfessional },
        update: { acceptsAnyProfessional: input.acceptsAnyProfessional },
        select: { id: true },
      });
      await tx.waitlistPreferredDay.deleteMany({ where: { preferenceId: preference.id } });
      await tx.waitlistTimeRange.deleteMany({ where: { preferenceId: preference.id } });
      await tx.waitlistPreferredBranch.deleteMany({ where: { waitlistEntryId: entry.id } });
      if (input.preferredDays.length) await tx.waitlistPreferredDay.createMany({
        data: input.preferredDays.map((dayOfWeek) => ({ id: randomUUID(), preferenceId: preference.id, dayOfWeek })),
      });
      if (input.timeRanges.length) await tx.waitlistTimeRange.createMany({
        data: input.timeRanges.map((range) => ({
          id: randomUUID(), preferenceId: preference.id, startTime: databaseTime(range.start), endTime: databaseTime(range.end),
        })),
      });
      if (input.preferredBranchIds.length) await tx.waitlistPreferredBranch.createMany({
        data: input.preferredBranchIds.map((branchId, index) => ({ waitlistEntryId: entry.id, branchId, preferenceOrder: index + 1 })),
      });
      const updated = await tx.waitlistEntry.update({
        where: { id: entry.id },
        data: { allowsOtherBranches: input.allowsOtherBranches, updatedAt: nextUpdatedAt(entry.updatedAt) },
        select: entrySelect,
      });
      return { data: toPreferences(updated) };
    });
  }

  withdraw(id: string, principal: AuthenticatedPrincipal) {
    return this.withEntry(id, principal, async (tx, entry) => {
      if (entry.status.code === 'WITHDRAWN') {
        if (!entry.status.isFinal) throw new ServiceUnavailableException('Incompatible WITHDRAWN status');
        return { data: { id: entry.id, status: 'WITHDRAWN' } };
      }
      if (entry.status.isFinal) throw new ConflictException('Waitlist entry is finalized');
      const status = await tx.waitlistStatus.findUnique({
        where: { code: 'WITHDRAWN' }, select: { id: true, active: true, isFinal: true },
      });
      if (!status?.active || !status.isFinal) throw new ServiceUnavailableException('WITHDRAWN status is not configured');
      await tx.waitlistEntry.update({
        where: { id: entry.id }, data: { statusId: status.id, updatedAt: nextUpdatedAt(entry.updatedAt) },
        select: { id: true },
      });
      await NotificationsService.create(tx, { recipientUserId: principal.userId, type: 'WAITLIST_WITHDRAWN',
        institutionId: entry.institutionId, branchId: entry.branchId ?? null, resourceType: 'WAITLIST_ENTRY', resourceId: entry.id,
        dedupeKey: `WAITLIST_WITHDRAWN:${entry.id}`, data: {} });
      return { data: { id: entry.id, status: 'WITHDRAWN' } };
    });
  }

  private async withEntry<T>(
    id: string, principal: AuthenticatedPrincipal,
    operation: (tx: Prisma.TransactionClient, entry: Entry) => Promise<T>, retry = true,
  ): Promise<T> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const user = await tx.user.findFirst({
          where: { id: principal.userId, status: UserStatus.ACTIVE, deletedAt: null }, select: { id: true },
        });
        if (!user) throw new UnauthorizedException('Unauthorized');
        const entry = await tx.waitlistEntry.findFirst({
          where: { id, userId: principal.userId, deletedAt: null }, select: entrySelect,
        });
        if (!entry || entry.service.institutionId !== entry.institutionId ||
            (entry.branch && entry.branch.institutionId !== entry.institutionId)) {
          throw new NotFoundException('Waitlist entry not found');
        }
        return operation(tx, entry);
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (error instanceof HttpException) throw error;
      if (isTransactionConflict(error) && retry) return this.withEntry(id, principal, operation, false);
      if (isTransactionConflict(error)) throw new ConflictException('Waitlist conflict; retry request');
      throw new InternalServerErrorException('Unable to manage waitlist preferences', { cause: error });
    }
  }
}
