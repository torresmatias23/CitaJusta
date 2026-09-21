import { ConflictException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import type { Prisma } from '../generated/prisma/client.js';
import { AuditService } from '../audit/audit.service.js';
import { candidateSelect, exclusionReason } from './reassignments.policy.js';

export const continuationOfferSelect = {
  id: true, reassignmentId: true, candidateId: true, agendaSlotId: true, attemptNumber: true,
  status: true, expectedSlotVersion: true, expiresAt: true, respondedByUserId: true,
  respondedAt: true, resolvedAt: true, lockVersion: true,
  candidate: {
    select: {
      id: true, userId: true, waitlistEntryId: true, evaluationStatus: true,
      rankingPosition: true, entryUpdatedAtSnapshot: true,
    },
  },
  reassignment: {
    select: {
      id: true, institutionId: true, appointmentId: true, agendaSlotId: true,
      serviceId: true, sourceUserId: true, status: true, lockVersion: true,
      policy: { select: { offerTtlMinutes: true } },
    },
  },
} as const satisfies Prisma.AppointmentOfferSelect;
export const continuationSlotSelect = {
  id: true, status: true, lockVersion: true, startsAt: true, endsAt: true, blockedUntilAt: true,
  availability: {
    select: {
      id: true, branchId: true, serviceId: true, professionalId: true, attentionPointId: true,
      branch: {
        select: {
          institutionId: true,
          institution: { select: { timeZone: true } },
        },
      },
    },
  },
  appointment: {
    select: {
      id: true, institutionId: true, branchId: true, serviceId: true, professionalId: true,
      attentionPointId: true, agendaSlotId: true, userId: true, deletedAt: true,
      startsAt: true, endsAt: true,
      status: { select: { code: true, isFinal: true } },
    },
  },
} as const satisfies Prisma.AgendaSlotSelect;
export type ContinuationOffer = Prisma.AppointmentOfferGetPayload<{ select: typeof continuationOfferSelect }>;
export type ContinuationSlot = Prisma.AgendaSlotGetPayload<{ select: typeof continuationSlotSelect }>;
type Cause = { kind: 'REJECTION'; actorUserId: string } | { kind: 'EXPIRATION' };
interface NextOffer { id: string; status: 'PENDING'; agendaSlotId: string; createdAt: string; expiresAt: string }
export type ContinuationResult = { status: 'OFFERING' | 'EXHAUSTED'; nextOffer: NextOffer | null } |
  { status: 'UNAVAILABLE'; nextOffer: null };

// One continuation algorithm, using the original process ranking and bound policy.
export async function advanceReassignment(tx: Prisma.TransactionClient, config: ConfigService,
  offer: ContinuationOffer, slot: ContinuationSlot, now: Date, cause: Cause): Promise<ContinuationResult> {
  if (offer.candidate.rankingPosition === null) throw new ConflictException('Candidate has no persisted ranking');
  const availability = slot.availability;
  const auditContext = { institutionId: offer.reassignment.institutionId, branchId: availability.branchId,
    actorUserId: cause.kind === 'REJECTION' ? cause.actorUserId : null,
    actorType: cause.kind === 'REJECTION' ? 'USER' as const : 'SYSTEM' as const, outcome: 'SUCCESS' as const };
  const reasonCode = cause.kind === 'REJECTION' ? 'CANDIDATES_EXHAUSTED_AFTER_REJECTION' : 'CANDIDATES_EXHAUSTED_AFTER_EXPIRATION';
  const pendingOffers = await tx.appointmentOffer.count({
    where: { reassignmentId: offer.reassignmentId, status: 'PENDING' },
  });
  if (pendingOffers) throw new ConflictException('Reassignment already has a pending offer');

  const nextCandidates = await tx.reassignmentCandidate.findMany({
    where: {
      reassignmentId: offer.reassignmentId,
      evaluationStatus: 'ELIGIBLE',
      rankingPosition: { gt: offer.candidate.rankingPosition },
      offers: { none: {} },
      waitlistEntry: { deletedAt: null, status: { isFinal: false } },
    },
    select: {
      id: true, userId: true, waitlistEntryId: true, rankingPosition: true,
      entryUpdatedAtSnapshot: true,
      waitlistEntry: { select: candidateSelect },
    },
    orderBy: [{ rankingPosition: 'asc' }, { id: 'asc' }],
  });

  const slotContext = {
    institutionId: offer.reassignment.institutionId,
    serviceId: offer.reassignment.serviceId,
    branchId: availability.branchId,
    sourceUserId: offer.reassignment.sourceUserId,
    startsAt: slot.startsAt,
    endsAt: slot.endsAt,
    timeZone: availability.branch.institution.timeZone,
  };
  let winner: (typeof nextCandidates)[number] | undefined;
  for (const candidate of nextCandidates) {
    const entry = candidate.waitlistEntry;
    if (
      candidate.userId !== entry.userId ||
      entry.updatedAt.getTime() !== candidate.entryUpdatedAtSnapshot.getTime() ||
      exclusionReason(entry, slotContext, now) !== null
    ) {
      continue;
    }
    winner = candidate;
    break;
  }

  if (cause.kind === 'EXPIRATION' && slot.startsAt <= new Date()) return { status: 'UNAVAILABLE', nextOffer: null };
  if (!winner) {
    const exhausted = await tx.reassignment.updateMany({
      where: {
        id: offer.reassignment.id,
        status: 'OFFERING',
        lockVersion: offer.reassignment.lockVersion,
      },
      data: {
        status: 'EXHAUSTED',
        finishedAt: now,
        closureReasonCode: reasonCode,
        closureDetails: cause.kind === 'REJECTION' ? { rejectedOfferId: offer.id, rejectedCandidateId: offer.candidate.id, rejectedByUserId: cause.actorUserId } : { expiredOfferId: offer.id, expiredCandidateId: offer.candidate.id },
        lockVersion: { increment: 1 },
      },
    });
    if (exhausted.count !== 1) throw new ConflictException('Reassignment changed; retry rejection');
    await AuditService.record(tx, { ...auditContext, actionCode: 'REASSIGNMENT_EXHAUSTED', resourceType: 'REASSIGNMENT',
      resourceId: offer.reassignment.id, previousState: 'OFFERING', newState: 'EXHAUSTED', reasonCode });
    return { status: 'EXHAUSTED', nextOffer: null };
  }

  const createdAt = new Date();
  const ttl = offer.reassignment.policy?.offerTtlMinutes ?? config.getOrThrow<number>('WAITLIST_OFFER_TTL_MINUTES');
  const expiresAt = new Date(createdAt.getTime() + ttl * 60_000);
  if (!Number.isFinite(expiresAt.getTime())) {
    throw new ServiceUnavailableException('Offer TTL out of supported range');
  }
  const slotStillAvailable = await tx.agendaSlot.count({
    where: {
      id: offer.agendaSlotId,
      status: 'RELEASED',
      lockVersion: offer.expectedSlotVersion,
      startsAt: { gt: createdAt },
    },
  });
  if (!slotStillAvailable) {
    if (cause.kind === 'EXPIRATION') return { status: 'UNAVAILABLE', nextOffer: null };
    throw new ConflictException('Slot is no longer eligible');
  }

  const nextOffer = await tx.appointmentOffer.create({
    data: {
      id: randomUUID(),
      reassignmentId: offer.reassignmentId,
      candidateId: winner.id,
      agendaSlotId: offer.agendaSlotId,
      attemptNumber: offer.attemptNumber + 1,
      status: 'PENDING',
      expectedSlotVersion: offer.expectedSlotVersion,
      createdAt,
      expiresAt,
    },
    select: { id: true },
  });
  await AuditService.record(tx, { ...auditContext, actorUserId: null, actorType: 'SYSTEM',
    actionCode: 'OFFER_CREATED', resourceType: 'OFFER', resourceId: nextOffer.id, newState: 'PENDING' });

  return { status: 'OFFERING', nextOffer: { id: nextOffer.id, status: 'PENDING', agendaSlotId: offer.agendaSlotId,
    createdAt: createdAt.toISOString(), expiresAt: expiresAt.toISOString() } };
}
