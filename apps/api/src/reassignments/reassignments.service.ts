import { NotificationsService } from '../notifications/notifications.service.js';
import { expireOfferInTransaction, ExpirationContention } from './offer-expiration.js';
import { advanceReassignment, continuationOfferSelect, continuationSlotSelect } from './reassignment-continuation.js';
import { AuditService } from '../audit/audit.service.js';
import { randomUUID } from 'node:crypto';
import { ConflictException, ForbiddenException, HttpException, Injectable, InternalServerErrorException, NotFoundException, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../database/prisma.service.js';
import { isTransactionConflict } from '../database/transaction-conflict.js';
import { Prisma } from '../generated/prisma/client.js';
import type { AuthenticatedPrincipal } from '../auth/types/authenticated-principal.js';
import type { AuthorizationContext } from '../authorization/types/authorization-context.js';
import { availableAvailabilityWhere } from '../availability/availability.policy.js';
import { localTime } from './reassignments.policy.js';
import { startReassignment, type GenerationResult } from './reassignment-start.js';
export type { GenerationResult } from './reassignment-start.js';

export const GENERATE_OFFERS_PERMISSION = 'reassignments.generate';
export interface AcceptanceResult {
  data: {
    offer: { id: string; status: 'ACCEPTED'; respondedAt: string };
    appointment: { id: string; agendaSlotId: string; status: 'AGENDADA'; startsAt: string; endsAt: string };
    reassignment: { id: string; status: 'COMPLETED' };
  };
}

export interface RejectionResult {
  data: {
    offer: { id: string; status: 'REJECTED'; respondedAt: string };
    reassignment: { id: string; status: 'OFFERING' | 'EXHAUSTED' };
    nextOffer: {
      id: string;
      status: 'PENDING';
      agendaSlotId: string;
      createdAt: string;
      expiresAt: string;
    } | null;
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
        return startReassignment(tx, this.config, agendaSlotId, {
          kind: 'MANUAL', userId: context.userId, institutionId: context.institutionId, branchId: context.branchId ?? null,
        }, now);
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
        const auditContext = { institutionId: appointment.institutionId, branchId: availability.branchId,
          actorUserId: principal.userId, actorType: 'USER' as const, outcome: 'SUCCESS' as const };
        await AuditService.record(tx, { ...auditContext, actionCode: 'OFFER_ACCEPTED', resourceType: 'OFFER', resourceId: offer.id,
          previousState: 'PENDING', newState: 'ACCEPTED' });
        await NotificationsService.create(tx, { recipientUserId: principal.userId, type: 'OFFER_ACCEPTED',
          institutionId: appointment.institutionId, branchId: availability.branchId, resourceType: 'OFFER', resourceId: offer.id,
          dedupeKey: `OFFER_ACCEPTED:${offer.id}`, data: { startsAt: slot.startsAt.toISOString() } });
        await AuditService.record(tx, { ...auditContext, actionCode: 'REASSIGNMENT_COMPLETED', resourceType: 'REASSIGNMENT',
          resourceId: offer.reassignment.id, previousState: 'OFFERING', newState: 'COMPLETED' });

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


  async rejectOffer(offerId: string, principal: AuthenticatedPrincipal, retry = true): Promise<RejectionResult> {
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
          select: continuationOfferSelect,
        });
        if (!offer || offer.candidate.userId !== principal.userId) {
          throw new NotFoundException('Offer not found');
        }

        if (offer.status === 'REJECTED') {
          if (offer.respondedByUserId !== principal.userId || !offer.respondedAt || !offer.resolvedAt) {
            throw new ConflictException('Rejected offer state is inconsistent');
          }
          const nextOffer = await tx.appointmentOffer.findFirst({
            where: {
              reassignmentId: offer.reassignmentId,
              status: 'PENDING',
              attemptNumber: { gt: offer.attemptNumber },
            },
            orderBy: [{ attemptNumber: 'asc' }, { id: 'asc' }],
            select: { id: true, agendaSlotId: true, createdAt: true, expiresAt: true },
          });
          if (
            (offer.reassignment.status === 'OFFERING' && !nextOffer) ||
            (offer.reassignment.status === 'EXHAUSTED' && nextOffer) ||
            !['OFFERING', 'EXHAUSTED'].includes(offer.reassignment.status)
          ) {
            throw new ConflictException('Rejected offer state is inconsistent');
          }
          return {
            data: {
              offer: { id: offer.id, status: 'REJECTED', respondedAt: offer.respondedAt.toISOString() },
              reassignment: { id: offer.reassignment.id, status: offer.reassignment.status as 'OFFERING' | 'EXHAUSTED' },
              nextOffer: nextOffer ? {
                id: nextOffer.id, status: 'PENDING', agendaSlotId: nextOffer.agendaSlotId,
                createdAt: nextOffer.createdAt.toISOString(), expiresAt: nextOffer.expiresAt.toISOString(),
              } : null,
            },
          };
        }

        if (offer.status !== 'PENDING') throw new ConflictException('Offer cannot be rejected');
        if (offer.expiresAt <= now) throw new ConflictException('Offer has expired');
        if (offer.candidate.evaluationStatus !== 'ELIGIBLE' || offer.candidate.rankingPosition === null ||
            offer.reassignment.status !== 'OFFERING' || offer.reassignment.agendaSlotId !== offer.agendaSlotId) {
          throw new ConflictException('Offer is no longer eligible');
        }

        const slot = await tx.agendaSlot.findUnique({
          where: { id: offer.agendaSlotId },
          select: continuationSlotSelect,
        });
        if (!slot) throw new ConflictException('Slot is no longer available');
        const appointment = slot.appointment;
        const availability = slot.availability;
        if (
          slot.status !== 'RELEASED' || slot.lockVersion !== offer.expectedSlotVersion ||
          slot.startsAt <= now || slot.endsAt <= slot.startsAt ||
          (slot.blockedUntilAt && slot.blockedUntilAt > now) ||
          availability.branch.institutionId !== offer.reassignment.institutionId ||
          availability.serviceId !== offer.reassignment.serviceId ||
          !appointment || appointment.id !== offer.reassignment.appointmentId ||
          appointment.agendaSlotId !== offer.agendaSlotId ||
          appointment.userId !== offer.reassignment.sourceUserId ||
          appointment.deletedAt || appointment.status.code !== 'CANCELADA' || !appointment.status.isFinal ||
          appointment.institutionId !== offer.reassignment.institutionId ||
          appointment.branchId !== availability.branchId ||
          appointment.serviceId !== availability.serviceId ||
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

        const rejected = await tx.appointmentOffer.updateMany({
          where: {
            id: offer.id, status: 'PENDING', lockVersion: offer.lockVersion,
            respondedByUserId: null, respondedAt: null, resolvedAt: null, expiresAt: { gt: now },
          },
          data: {
            status: 'REJECTED', respondedByUserId: principal.userId, respondedAt: now, resolvedAt: now,
            resolutionReasonCode: 'REJECTED_BY_RECIPIENT',
            resolutionDetails: { reassignmentId: offer.reassignment.id, candidateId: offer.candidate.id },
            lockVersion: { increment: 1 },
          },
        });
        if (rejected.count !== 1) throw new ConflictException('Offer changed; retry rejection');
        const auditContext = { institutionId: offer.reassignment.institutionId, branchId: availability.branchId,
          actorUserId: principal.userId, actorType: 'USER' as const, outcome: 'SUCCESS' as const };
        await AuditService.record(tx, { ...auditContext, actionCode: 'OFFER_REJECTED', resourceType: 'OFFER', resourceId: offer.id,
          previousState: 'PENDING', newState: 'REJECTED' });
        await NotificationsService.create(tx, { recipientUserId: principal.userId, type: 'OFFER_REJECTED',
          institutionId: offer.reassignment.institutionId, branchId: availability.branchId, resourceType: 'OFFER', resourceId: offer.id,
          dedupeKey: `OFFER_REJECTED:${offer.id}`, data: {} });

        const continuation = await advanceReassignment(tx, this.config, offer, slot, now,
          { kind: 'REJECTION', actorUserId: principal.userId });
        if (continuation.status === 'UNAVAILABLE') throw new ConflictException('Slot is no longer eligible');
        return { data: {
          offer: { id: offer.id, status: 'REJECTED', respondedAt: now.toISOString() },
          reassignment: { id: offer.reassignment.id, status: continuation.status },
          nextOffer: continuation.nextOffer,
        } };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (error instanceof HttpException) throw error;
      if (isTransactionConflict(error) && retry) return this.rejectOffer(offerId, principal, false);
      if (isTransactionConflict(error)) throw new ConflictException('Offer rejection conflict; retry request');
      throw new InternalServerErrorException('Unable to reject offer', { cause: error });
    }
  }


  async expireOffer(offerId: string, retry = true): Promise<Awaited<ReturnType<typeof expireOfferInTransaction>>> {
    try {
      return await this.prisma.$transaction((tx) => expireOfferInTransaction(tx, this.config, offerId),
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if ((error instanceof ExpirationContention || isTransactionConflict(error)) && retry) return this.expireOffer(offerId, false);
      if (error instanceof ExpirationContention || isTransactionConflict(error)) throw new ConflictException('Offer expiration conflict; retry later');
      if (error instanceof HttpException) throw error;
      throw new InternalServerErrorException('Unable to expire offer', { cause: error });
    }
  }

}
