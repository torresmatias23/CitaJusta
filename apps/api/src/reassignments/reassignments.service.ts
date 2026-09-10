import { randomUUID } from 'node:crypto';
import { ConflictException, ForbiddenException, HttpException, Injectable, InternalServerErrorException, NotFoundException, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../database/prisma.service.js';
import { isTransactionConflict } from '../database/transaction-conflict.js';
import { Prisma } from '../generated/prisma/client.js';
import type { AuthenticatedPrincipal } from '../auth/types/authenticated-principal.js';
import type { AuthorizationContext } from '../authorization/types/authorization-context.js';
import { availableAvailabilityWhere } from '../availability/availability.policy.js';
import { candidateSelect, compareCandidates, exclusionReason, localTime, preferenceSnapshot } from './reassignments.policy.js';

export const GENERATE_OFFERS_PERMISSION = 'reassignments.generate';
const RULE = 'PRIORITY_FIFO_V1';
export interface GenerationResult {
  data: { id: string; status: 'OFFERING' | 'EXHAUSTED'; offer: { id: string; status: 'PENDING'; agendaSlotId: string; createdAt: string; expiresAt: string } | null };
}

export interface AcceptanceResult {
  data: {
    offer: { id: string; status: 'ACCEPTED'; respondedAt: string };
    appointment: { id: string; agendaSlotId: string; status: 'AGENDADA'; startsAt: string; endsAt: string };
    reassignment: { id: string; status: 'COMPLETED' };
  };
}

@Injectable()
export class ReassignmentsService {
  constructor(private readonly prisma: PrismaService, private readonly config: ConfigService) {}

  async generate(agendaSlotId: string, context: AuthorizationContext, retry = true): Promise<GenerationResult> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const now = new Date();
        if (!context.institutionId || !context.permissions.includes(GENERATE_OFFERS_PERMISSION)) throw new ForbiddenException('Forbidden');
        const user = await tx.user.findFirst({ where: { id: context.userId, status: 'ACTIVE', deletedAt: null }, select: { id: true } });
        if (!user) throw new UnauthorizedException('Unauthorized');
        // Revalidate effective permission inside the transaction, including assignment validity.
        const grants = await tx.userRole.count({ where: {
          userId: context.userId, active: true,
          role: { active: true, permissions: { some: { permission: { code: GENERATE_OFFERS_PERMISSION } } } },
          AND: [
            { OR: [{ validFrom: null }, { validFrom: { lte: now } }] },
            { OR: [{ validTo: null }, { validTo: { gte: now } }] },
            { OR: [
              { role: { scope: 'GLOBAL' } },
              { role: { scope: 'INSTITUTION' }, institutionId: context.institutionId },
              ...(context.branchId ? [{ role: { scope: 'BRANCH' as const }, branchId: context.branchId,
                OR: [{ institutionId: null }, { institutionId: context.institutionId }] }] : []),
            ] },
          ],
        } });
        if (!grants) throw new ForbiddenException('Forbidden');
        const slot = await tx.agendaSlot.findFirst({
          where: { id: agendaSlotId, availability: { branch: { institutionId: context.institutionId }, ...(context.branchId ? { branchId: context.branchId } : {}) } },
          include: {
            availability: { include: { branch: { include: { institution: { select: { timeZone: true } } } } } },
            appointment: { include: { status: true, cancellations: { where: { releasesSlot: true }, orderBy: [{ cancelledAt: 'desc' }, { id: 'desc' }], take: 1 } } },
          },
        });
        if (!slot) throw new NotFoundException('Released slot not found');
        if (slot.status !== 'RELEASED' || slot.startsAt <= now || slot.endsAt <= slot.startsAt ||
            (slot.blockedUntilAt && slot.blockedUntilAt > now)) throw new ConflictException('Slot is not available for reassignment');
        const availability = slot.availability;
        const institutionId = context.institutionId;
        const validContext = await tx.availability.count({ where: { id: availability.id,
          ...availableAvailabilityWhere({ institutionId, branchId: availability.branchId, serviceId: availability.serviceId }, availability.professionalId),
        } });
        if (!validContext) throw new NotFoundException('Invalid institutional relationships');
        const appointment = slot.appointment;
        const cancellation = appointment?.cancellations[0];
        if (!appointment || !cancellation || appointment.deletedAt || appointment.status.code !== 'CANCELADA' ||
            !appointment.status.isFinal || appointment.institutionId !== institutionId ||
            appointment.branchId !== availability.branchId || appointment.serviceId !== availability.serviceId ||
            appointment.professionalId !== availability.professionalId || appointment.attentionPointId !== availability.attentionPointId ||
            appointment.startsAt.getTime() !== slot.startsAt.getTime() || appointment.endsAt.getTime() !== slot.endsAt.getTime()) {
          throw new ConflictException('Cancelled appointment and release required');
        }
        const previous = await tx.reassignment.count({ where: { OR: [
          { originCancellationId: cancellation.id },
          { agendaSlotId, status: { in: ['PENDING', 'EVALUATING', 'OFFERING'] } },
        ] } });
        const pending = await tx.appointmentOffer.count({ where: { agendaSlotId, status: 'PENDING' } });
        if (previous || pending) throw new ConflictException('Release has already been evaluated or offered');
        const timeZone = availability.branch.institution.timeZone;
        try { localTime(slot.startsAt, timeZone); } catch { throw new ServiceUnavailableException('Institution time zone unavailable'); }
        const claimed = await tx.agendaSlot.updateMany({
          where: { id: agendaSlotId, status: 'RELEASED', lockVersion: slot.lockVersion, startsAt: { gt: now } },
          data: { lockVersion: { increment: 1 } },
        });
        if (claimed.count !== 1) throw new ConflictException('Slot changed; retry request');
        const entries = await tx.waitlistEntry.findMany({
          where: { institutionId, serviceId: availability.serviceId, deletedAt: null, status: { isFinal: false } },
          select: candidateSelect,
          orderBy: [{ priority: { level: 'asc' } }, { enteredAt: 'asc' }, { id: 'asc' }],
        });
        const slotContext = { institutionId, serviceId: availability.serviceId, branchId: availability.branchId,
          sourceUserId: appointment.userId, startsAt: slot.startsAt, endsAt: slot.endsAt, timeZone };
        const evaluations = entries.sort(compareCandidates).map((entry) => ({ entry, reason: exclusionReason(entry, slotContext, now), id: randomUUID() }));
        const eligible = evaluations.filter((evaluation) => evaluation.reason === null);
        const ttl = this.config.getOrThrow<number>('WAITLIST_OFFER_TTL_MINUTES');
        const reassignmentId = randomUUID();
        await tx.reassignment.create({ data: {
          id: reassignmentId, institutionId, originCancellationId: cancellation.id, appointmentId: appointment.id,
          agendaSlotId, serviceId: availability.serviceId, sourceUserId: appointment.userId,
          initialSlotVersion: slot.lockVersion, ruleCode: RULE, scoringVersion: 'priority-level-asc-fifo-v1',
          criteriaSnapshot: { timeZone, startsAt: slot.startsAt.toISOString(), endsAt: slot.endsAt.toISOString(), branchId: availability.branchId,
            professionalId: availability.professionalId, offerTtlMinutes: ttl, actorUserId: context.userId,
            emptyPreferences: 'EXCLUDE_UNLESS_EXPLICIT_TIME_OR_BRANCH_CONSENT', explicitDaysOverrideWeekendFlag: true },
          status: eligible.length ? 'OFFERING' : 'EXHAUSTED', detectedAt: now, startedAt: now,
          finishedAt: eligible.length ? null : now, closureReasonCode: eligible.length ? null : 'NO_ELIGIBLE_CANDIDATES',
        } });
        let rank = 0;
        if (evaluations.length) await tx.reassignmentCandidate.createMany({ data: evaluations.map(({ entry, reason, id }) => ({
          id, reassignmentId, waitlistEntryId: entry.id, userId: entry.userId, priorityId: entry.priorityId,
          evaluationStatus: reason ? 'EXCLUDED' : 'ELIGIBLE', priorityLevelSnapshot: entry.priority.level,
          entryUpdatedAtSnapshot: entry.updatedAt, rankingPosition: reason ? null : ++rank,
          // Schema requires a score for eligible candidates. It is just inverse configured level;
          // FIFO and UUID break ties, without an invented weighted scoring formula.
          totalScore: reason ? null : new Prisma.Decimal(-entry.priority.level),
          scoreFactors: [{ code: 'PRIORITY_LEVEL', value: entry.priority.level }, { code: 'ENTERED_AT', value: entry.enteredAt.toISOString() }],
          evaluationContext: preferenceSnapshot(entry), exclusionReasonCode: reason, evaluatedAt: now,
        })) });
        const winner = eligible[0];
        if (!winner) return { data: { id: reassignmentId, status: 'EXHAUSTED', offer: null } };
        // Use the same instant for both timestamps, after the evaluation work.
        const createdAt = new Date();
        const expiresAt = new Date(createdAt.getTime() + ttl * 60_000);
        if (!Number.isFinite(expiresAt.getTime())) throw new ServiceUnavailableException('Offer TTL out of supported range');
        const current = await tx.agendaSlot.count({ where: { id: agendaSlotId, status: 'RELEASED', lockVersion: slot.lockVersion + 1, startsAt: { gt: createdAt } } });
        if (!current) throw new ConflictException('Slot is no longer eligible');
        const offer = await tx.appointmentOffer.create({ data: {
          id: randomUUID(), reassignmentId, candidateId: winner.id, agendaSlotId, attemptNumber: 1,
          status: 'PENDING', expectedSlotVersion: slot.lockVersion + 1, createdAt, expiresAt,
        }, select: { id: true } });
        return { data: { id: reassignmentId, status: 'OFFERING', offer: { id: offer.id, status: 'PENDING', agendaSlotId,
          createdAt: createdAt.toISOString(), expiresAt: expiresAt.toISOString() } } };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (error instanceof HttpException) throw error;
      if (isTransactionConflict(error) && retry) return this.generate(agendaSlotId, context, false);
      if (isTransactionConflict(error)) throw new ConflictException('Reassignment conflict; retry request');
      throw new InternalServerErrorException('Unable to generate offer', { cause: error });
    }
  }

  async acceptOffer(offerId: string, principal: AuthenticatedPrincipal, retry = true): Promise<AcceptanceResult> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const now = new Date();
        const user = await tx.user.findFirst({
          where: { id: principal.userId, status: 'ACTIVE', deletedAt: null },
          select: { id: true },
        });
        if (!user) throw new UnauthorizedException('Unauthorized');

        const offer = await tx.appointmentOffer.findUnique({
          where: { id: offerId },
          select: {
            id: true, reassignmentId: true, candidateId: true, agendaSlotId: true,
            status: true, expectedSlotVersion: true, expiresAt: true, respondedByUserId: true,
            respondedAt: true, resolvedAt: true, lockVersion: true,
            candidate: {
              select: {
                id: true, userId: true, waitlistEntryId: true, evaluationStatus: true,
                entryUpdatedAtSnapshot: true,
              },
            },
            reassignment: {
              select: {
                id: true, institutionId: true, appointmentId: true, agendaSlotId: true,
                serviceId: true, sourceUserId: true, status: true, lockVersion: true,
              },
            },
          },
        });
        if (!offer || offer.candidate.userId !== principal.userId) {
          throw new NotFoundException('Offer not found');
        }

        // A replay after a completed commit is idempotent only when every critical projection
        // still reflects the same successful acceptance.
        if (offer.status === 'ACCEPTED') {
          const slot = await tx.agendaSlot.findUnique({
            where: { id: offer.agendaSlotId },
            select: { status: true },
          });
          const appointment = await tx.appointment.findUnique({
            where: { id: offer.reassignment.appointmentId },
            select: {
              id: true, agendaSlotId: true, userId: true, startsAt: true, endsAt: true,
              status: { select: { code: true } },
            },
          });
          const entry = await tx.waitlistEntry.findUnique({
            where: { id: offer.candidate.waitlistEntryId },
            select: { userId: true, status: { select: { code: true, isFinal: true } } },
          });
          if (
            offer.respondedByUserId !== principal.userId || !offer.respondedAt || !offer.resolvedAt ||
            offer.reassignment.status !== 'COMPLETED' || slot?.status !== 'RESERVED' ||
            !appointment || appointment.agendaSlotId !== offer.agendaSlotId || appointment.userId !== principal.userId ||
            appointment.status.code !== 'AGENDADA' || !entry || entry.userId !== principal.userId ||
            entry.status.code !== 'FULFILLED' || !entry.status.isFinal
          ) {
            throw new ConflictException('Accepted offer state is inconsistent');
          }
          return {
            data: {
              offer: { id: offer.id, status: 'ACCEPTED', respondedAt: offer.respondedAt.toISOString() },
              appointment: {
                id: appointment.id, agendaSlotId: appointment.agendaSlotId, status: 'AGENDADA',
                startsAt: appointment.startsAt.toISOString(), endsAt: appointment.endsAt.toISOString(),
              },
              reassignment: { id: offer.reassignment.id, status: 'COMPLETED' },
            },
          };
        }

        if (offer.status !== 'PENDING') throw new ConflictException('Offer cannot be accepted');
        if (offer.expiresAt <= now) throw new ConflictException('Offer has expired');
        if (offer.candidate.evaluationStatus !== 'ELIGIBLE' || offer.reassignment.status !== 'OFFERING' ||
            offer.reassignment.agendaSlotId !== offer.agendaSlotId) {
          throw new ConflictException('Offer is no longer eligible');
        }

        const entry = await tx.waitlistEntry.findFirst({
          where: { id: offer.candidate.waitlistEntryId, userId: principal.userId, deletedAt: null },
          select: {
            id: true, institutionId: true, serviceId: true, statusId: true, updatedAt: true,
            status: { select: { code: true, isFinal: true } },
          },
        });
        if (
          !entry || entry.status.isFinal || entry.institutionId !== offer.reassignment.institutionId ||
          entry.serviceId !== offer.reassignment.serviceId ||
          entry.updatedAt.getTime() !== offer.candidate.entryUpdatedAtSnapshot.getTime()
        ) {
          throw new ConflictException('Waitlist entry changed after offer generation');
        }

        const slot = await tx.agendaSlot.findUnique({
          where: { id: offer.agendaSlotId },
          select: {
            id: true, status: true, lockVersion: true, startsAt: true, endsAt: true,
            availability: {
              select: {
                id: true, branchId: true, serviceId: true, professionalId: true, attentionPointId: true,
                branch: { select: { institutionId: true } },
              },
            },
            appointment: {
              select: {
                id: true, institutionId: true, branchId: true, serviceId: true, professionalId: true,
                attentionPointId: true, agendaSlotId: true, userId: true, statusId: true, origin: true,
                startsAt: true, endsAt: true, deletedAt: true,
                status: { select: { code: true, isFinal: true } },
              },
            },
          },
        });
        if (!slot) throw new ConflictException('Slot is no longer available');
        const appointment = slot.appointment;
        const availability = slot.availability;
        if (
          slot.status !== 'RELEASED' || slot.lockVersion !== offer.expectedSlotVersion ||
          slot.startsAt <= now || slot.endsAt <= slot.startsAt ||
          availability.branch.institutionId !== offer.reassignment.institutionId ||
          availability.serviceId !== offer.reassignment.serviceId ||
          !appointment || appointment.id !== offer.reassignment.appointmentId ||
          appointment.agendaSlotId !== offer.agendaSlotId || appointment.userId !== offer.reassignment.sourceUserId ||
          appointment.deletedAt || appointment.status.code !== 'CANCELADA' || !appointment.status.isFinal ||
          appointment.institutionId !== offer.reassignment.institutionId ||
          appointment.branchId !== availability.branchId || appointment.serviceId !== availability.serviceId ||
          appointment.professionalId !== availability.professionalId ||
          appointment.attentionPointId !== availability.attentionPointId ||
          appointment.startsAt.getTime() !== slot.startsAt.getTime() ||
          appointment.endsAt.getTime() !== slot.endsAt.getTime()
        ) {
          throw new ConflictException('Appointment or slot changed after offer generation');
        }

        const validAvailability = await tx.availability.count({
          where: {
            id: availability.id,
            ...availableAvailabilityWhere(
              {
                institutionId: offer.reassignment.institutionId,
                branchId: availability.branchId,
                serviceId: availability.serviceId,
              },
              availability.professionalId,
            ),
          },
        });
        if (!validAvailability) throw new ConflictException('Slot is no longer available');

        const scheduledStatus = await tx.appointmentStatus.findUnique({
          where: { code: 'AGENDADA' },
          select: { id: true, active: true, isFinal: true },
        });
        if (!scheduledStatus?.active || scheduledStatus.isFinal) {
          throw new ServiceUnavailableException('Appointment status unavailable');
        }
        const fulfilledStatus = await tx.waitlistStatus.findUnique({
          where: { code: 'FULFILLED' },
          select: { id: true, active: true, isFinal: true },
        });
        if (!fulfilledStatus?.active || !fulfilledStatus.isFinal) {
          throw new ServiceUnavailableException('FULFILLED waitlist status unavailable');
        }

        const accepted = await tx.appointmentOffer.updateMany({
          where: {
            id: offer.id, status: 'PENDING', lockVersion: offer.lockVersion,
            respondedByUserId: null, respondedAt: null, resolvedAt: null, expiresAt: { gt: now },
          },
          data: {
            status: 'ACCEPTED', respondedByUserId: principal.userId, respondedAt: now, resolvedAt: now,
            resolutionReasonCode: 'ACCEPTED_BY_RECIPIENT',
            resolutionDetails: { reassignmentId: offer.reassignment.id, candidateId: offer.candidate.id },
            lockVersion: { increment: 1 },
          },
        });
        if (accepted.count !== 1) throw new ConflictException('Offer changed; retry acceptance');

        const reserved = await tx.agendaSlot.updateMany({
          where: {
            id: slot.id, status: 'RELEASED', lockVersion: offer.expectedSlotVersion, startsAt: { gt: now },
          },
          data: { status: 'RESERVED', lockVersion: { increment: 1 } },
        });
        if (reserved.count !== 1) throw new ConflictException('Slot changed; retry acceptance');

        const transferred = await tx.appointment.updateMany({
          where: {
            id: appointment.id, agendaSlotId: slot.id, userId: offer.reassignment.sourceUserId,
            statusId: appointment.statusId, deletedAt: null,
          },
          data: {
            userId: principal.userId, statusId: scheduledStatus.id, origin: 'REASSIGNMENT', updatedAt: now,
          },
        });
        if (transferred.count !== 1) throw new ConflictException('Appointment changed; retry acceptance');

        const fulfilledAt = new Date(Math.max(now.getTime(), entry.updatedAt.getTime() + 1));
        const fulfilled = await tx.waitlistEntry.updateMany({
          where: {
            id: entry.id, userId: principal.userId, statusId: entry.statusId, deletedAt: null,
            updatedAt: offer.candidate.entryUpdatedAtSnapshot,
          },
          data: { statusId: fulfilledStatus.id, updatedAt: fulfilledAt },
        });
        if (fulfilled.count !== 1) throw new ConflictException('Waitlist entry changed; retry acceptance');

        const completed = await tx.reassignment.updateMany({
          where: {
            id: offer.reassignment.id, status: 'OFFERING', lockVersion: offer.reassignment.lockVersion,
          },
          data: {
            status: 'COMPLETED', finishedAt: now, closureReasonCode: 'OFFER_ACCEPTED',
            closureDetails: {
              offerId: offer.id, candidateId: offer.candidate.id,
              waitlistEntryId: entry.id, newUserId: principal.userId,
            },
            lockVersion: { increment: 1 },
          },
        });
        if (completed.count !== 1) throw new ConflictException('Reassignment changed; retry acceptance');

        await tx.appointmentHistory.create({
          data: {
            id: randomUUID(), appointmentId: appointment.id,
            previousStatusId: appointment.statusId, newStatusId: scheduledStatus.id,
            previousUserId: offer.reassignment.sourceUserId, newUserId: principal.userId,
            actorUserId: principal.userId, reason: 'REASSIGNMENT_ACCEPTED',
            details: {
              reassignmentId: offer.reassignment.id, offerId: offer.id,
              candidateId: offer.candidate.id, waitlistEntryId: entry.id,
              previousOrigin: appointment.origin, newOrigin: 'REASSIGNMENT',
            },
            occurredAt: now,
          },
          select: { id: true },
        });

        return {
          data: {
            offer: { id: offer.id, status: 'ACCEPTED', respondedAt: now.toISOString() },
            appointment: {
              id: appointment.id, agendaSlotId: appointment.agendaSlotId, status: 'AGENDADA',
              startsAt: appointment.startsAt.toISOString(), endsAt: appointment.endsAt.toISOString(),
            },
            reassignment: { id: offer.reassignment.id, status: 'COMPLETED' },
          },
        };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (error instanceof HttpException) throw error;
      if (isTransactionConflict(error) && retry) return this.acceptOffer(offerId, principal, false);
      if (isTransactionConflict(error)) throw new ConflictException('Offer acceptance conflict; retry request');
      throw new InternalServerErrorException('Unable to accept offer', { cause: error });
    }
  }


}
