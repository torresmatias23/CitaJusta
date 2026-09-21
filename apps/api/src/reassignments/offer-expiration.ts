import { NotificationsService } from '../notifications/notifications.service.js';
import { ConflictException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { Prisma } from '../generated/prisma/client.js';
import { AuditService } from '../audit/audit.service.js';
import { availableAvailabilityWhere } from '../availability/availability.policy.js';
import { advanceReassignment, continuationOfferSelect, continuationSlotSelect,
  type ContinuationOffer, type ContinuationSlot } from './reassignment-continuation.js';
import { localTime } from './reassignments.policy.js';

export class ExpirationContention extends Error {}
type Closure = { status: 'CANCELLED' | 'FAILED'; reason: 'SLOT_NO_LONGER_REASSIGNABLE' | 'REASSIGNMENT_INVARIANT_VIOLATION' };

function closureFor(offer: ContinuationOffer, slot: ContinuationSlot | null, now: Date): Closure | null {
  const process = offer.reassignment;
  const appointment = slot?.appointment;
  if (!slot || !appointment || process.status !== 'OFFERING' || process.agendaSlotId !== offer.agendaSlotId ||
      appointment.id !== process.appointmentId || appointment.agendaSlotId !== slot.id ||
      slot.availability.branch.institutionId !== process.institutionId || appointment.institutionId !== process.institutionId ||
      slot.endsAt <= slot.startsAt || offer.candidate.evaluationStatus !== 'ELIGIBLE' || offer.candidate.rankingPosition === null ||
      offer.respondedAt !== null || offer.respondedByUserId !== null || offer.resolvedAt !== null) {
    return { status: 'FAILED', reason: 'REASSIGNMENT_INVARIANT_VIOLATION' };
  }
  if (slot.status !== 'RELEASED' || slot.lockVersion !== offer.expectedSlotVersion || slot.startsAt <= now ||
      (slot.blockedUntilAt !== null && slot.blockedUntilAt > now) || appointment.deletedAt !== null ||
      appointment.userId !== process.sourceUserId || appointment.status.code !== 'CANCELADA' || !appointment.status.isFinal ||
      slot.availability.serviceId !== process.serviceId || appointment.serviceId !== process.serviceId ||
      appointment.branchId !== slot.availability.branchId || appointment.professionalId !== slot.availability.professionalId ||
      appointment.attentionPointId !== slot.availability.attentionPointId ||
      appointment.startsAt.getTime() !== slot.startsAt.getTime() || appointment.endsAt.getTime() !== slot.endsAt.getTime()) {
    return { status: 'CANCELLED', reason: 'SLOT_NO_LONGER_REASSIGNABLE' };
  }
  try { localTime(slot.startsAt, slot.availability.branch.institution.timeZone); }
  catch { return { status: 'FAILED', reason: 'REASSIGNMENT_INVARIANT_VIOLATION' }; }
  return null;
}

async function closeProcess(tx: Prisma.TransactionClient, offer: ContinuationOffer, now: Date, closure: Closure) {
  const closed = await tx.reassignment.updateMany({
    where: { id: offer.reassignmentId, status: offer.reassignment.status, lockVersion: offer.reassignment.lockVersion },
    data: { status: closure.status, finishedAt: now, closureReasonCode: closure.reason,
      closureDetails: { expiredOfferId: offer.id }, lockVersion: { increment: 1 } },
  });
  if (closed.count !== 1) throw new ExpirationContention('Process changed during expiration');
  return { status: 'EXPIRED' as const, processStatus: closure.status };
}

// Called only inside the service's Serializable transaction; no HTTP/user impersonation.
export async function expireOfferInTransaction(tx: Prisma.TransactionClient, config: ConfigService, offerId: string) {
  const now = new Date();
  const offer = await tx.appointmentOffer.findUnique({ where: { id: offerId }, select: continuationOfferSelect });
  if (!offer) return { status: 'MISSING' as const };
  if (offer.status !== 'PENDING') return { status: 'TERMINAL' as const };
  if (offer.expiresAt > now) return { status: 'NOT_DUE' as const };
  // Do not rewrite a completed/terminal process to repair an impossible pending offer.
  if (!['PENDING', 'EVALUATING', 'OFFERING'].includes(offer.reassignment.status)) {
    throw new ConflictException('Pending offer belongs to a terminal reassignment');
  }
  const slot = await tx.agendaSlot.findUnique({ where: { id: offer.agendaSlotId }, select: continuationSlotSelect });
  const claimed = await tx.appointmentOffer.updateMany({
    where: { id: offer.id, status: 'PENDING', lockVersion: offer.lockVersion, expiresAt: { lte: now } },
    data: { status: 'EXPIRED', resolvedAt: now, resolutionReasonCode: 'OFFER_TTL_ELAPSED', lockVersion: { increment: 1 } },
  });
  if (claimed.count !== 1) throw new ExpirationContention('Offer changed during expiration');
  await AuditService.record(tx, {
    institutionId: offer.reassignment.institutionId,
    branchId: slot?.availability.branch.institutionId === offer.reassignment.institutionId ? slot.availability.branchId : null,
    actorType: 'SYSTEM', actorUserId: null, actionCode: 'OFFER_EXPIRED', resourceType: 'OFFER', resourceId: offer.id,
    outcome: 'SUCCESS', previousState: 'PENDING', newState: 'EXPIRED', reasonCode: 'OFFER_TTL_ELAPSED',
  });
  const closure = closureFor(offer, slot, now);
  if (closure?.status === 'FAILED') return closeProcess(tx, offer, now, closure);
  if (!slot) throw new Error('Unreachable missing expiration slot');
  // Relational incoherence is distinct from a normally deactivated operational context.
  const coherent = await tx.availability.count({ where: { id: slot.availability.id,
    service: { institutionId: offer.reassignment.institutionId }, professional: { institutionId: offer.reassignment.institutionId },
    OR: [{ attentionPointId: null }, { attentionPoint: { branchId: slot.availability.branchId } }],
  } });
  const recipient = await tx.waitlistEntry.findUnique({ where: { id: offer.candidate.waitlistEntryId },
    select: { institutionId: true, serviceId: true, userId: true } });
  if (!coherent || !recipient || recipient.institutionId !== offer.reassignment.institutionId ||
      recipient.serviceId !== offer.reassignment.serviceId || recipient.userId !== offer.candidate.userId) {
    return closeProcess(tx, offer, now, { status: 'FAILED', reason: 'REASSIGNMENT_INVARIANT_VIOLATION' });
  }
  await NotificationsService.create(tx, { recipientUserId: offer.candidate.userId, type: 'OFFER_EXPIRED',
    institutionId: offer.reassignment.institutionId, branchId: slot.availability.branchId, resourceType: 'OFFER', resourceId: offer.id,
    dedupeKey: `OFFER_EXPIRED:${offer.id}`, data: {} });
  if (closure) return closeProcess(tx, offer, now, closure);
  const available = await tx.availability.count({ where: { id: slot.availability.id,
    ...availableAvailabilityWhere({ institutionId: offer.reassignment.institutionId, branchId: slot.availability.branchId,
      serviceId: slot.availability.serviceId }, slot.availability.professionalId),
  } });
  if (!available) return closeProcess(tx, offer, now, { status: 'CANCELLED', reason: 'SLOT_NO_LONGER_REASSIGNABLE' });
  const continuation = await advanceReassignment(tx, config, offer, slot, now, { kind: 'EXPIRATION' });
  if (continuation.status === 'UNAVAILABLE') return closeProcess(tx, offer, now,
    { status: 'CANCELLED', reason: 'SLOT_NO_LONGER_REASSIGNABLE' });
  return { status: 'EXPIRED' as const, processStatus: continuation.status };
}
