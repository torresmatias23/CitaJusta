import { randomUUID } from 'node:crypto';
import { ConflictException, HttpException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { Prisma } from '../generated/prisma/client.js';
import { AuditService } from '../audit/audit.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { availableAvailabilityWhere } from '../availability/availability.policy.js';
import { candidateSelect, rankCandidates, exclusionReason, localTime, preferenceSnapshot } from './reassignments.policy.js';

const RULE = 'PRIORITY_FIFO_V1';
export interface GenerationResult {
  data: { id: string; status: 'OFFERING' | 'EXHAUSTED'; offer: { id: string; status: 'PENDING'; agendaSlotId: string; createdAt: string; expiresAt: string } | null };
}
type Scope = { institutionId: string; branchId: string | null };
type ManualStart = Scope & { kind: 'MANUAL'; userId: string };
type AutomaticStart = Scope & { kind: 'CANCELLATION'; cancellationId: string };

export function startReassignment(tx: Prisma.TransactionClient, config: ConfigService, agendaSlotId: string, context: ManualStart, now?: Date): Promise<GenerationResult>;
export function startReassignment(tx: Prisma.TransactionClient, config: ConfigService, agendaSlotId: string, context: AutomaticStart, now?: Date): Promise<GenerationResult | null>;
// Caller owns the Serializable transaction and authorization. Automatic scope comes
// from the owned appointment, never request headers. No catch of persistence errors.
export async function startReassignment(tx: Prisma.TransactionClient, config: ConfigService, agendaSlotId: string,
  context: ManualStart | AutomaticStart, now = new Date()): Promise<GenerationResult | null> {
  const actorUserId = context.kind === 'MANUAL' ? context.userId : null;
  const unavailable = (error: HttpException): null => {
    if (context.kind === 'MANUAL') throw error;
    return null;
  };
  const slot = await tx.agendaSlot.findFirst({
    where: { id: agendaSlotId, availability: { branch: { institutionId: context.institutionId }, ...(context.branchId ? { branchId: context.branchId } : {}) } },
    include: {
      availability: { include: { branch: { include: { institution: { select: { timeZone: true,
        currentReassignmentPolicy: { select: { id: true, rankingStrategy: true, offerTtlMinutes: true } },
      } } } } } },
      appointment: { include: { status: true, cancellations: { where: { releasesSlot: true, ...(context.kind === 'CANCELLATION' ? { id: context.cancellationId } : {}) }, orderBy: [{ cancelledAt: 'desc' }, { id: 'desc' }], take: 1 } } },
    },
  });
  if (!slot) return unavailable(new NotFoundException('Released slot not found'));
  if (slot.status !== 'RELEASED' || slot.startsAt <= now || slot.endsAt <= slot.startsAt ||
      (slot.blockedUntilAt && slot.blockedUntilAt > now)) return unavailable(new ConflictException('Slot is not available for reassignment'));
  const availability = slot.availability;
  const institutionId = context.institutionId;
  const validContext = await tx.availability.count({ where: { id: availability.id,
    ...availableAvailabilityWhere({ institutionId, branchId: availability.branchId, serviceId: availability.serviceId }, availability.professionalId),
  } });
  if (!validContext) return unavailable(new NotFoundException('Invalid institutional relationships'));
  const appointment = slot.appointment;
  const cancellation = appointment?.cancellations[0];
  if (!appointment || !cancellation || appointment.deletedAt || appointment.status.code !== 'CANCELADA' ||
      !appointment.status.isFinal || appointment.institutionId !== institutionId ||
      appointment.branchId !== availability.branchId || appointment.serviceId !== availability.serviceId ||
      appointment.professionalId !== availability.professionalId || appointment.attentionPointId !== availability.attentionPointId ||
      appointment.startsAt.getTime() !== slot.startsAt.getTime() || appointment.endsAt.getTime() !== slot.endsAt.getTime()) {
    return unavailable(new ConflictException('Cancelled appointment and release required'));
  }
  const previous = await tx.reassignment.count({ where: { OR: [
    { originCancellationId: cancellation.id },
    { agendaSlotId, status: { in: ['PENDING', 'EVALUATING', 'OFFERING'] } },
  ] } });
  const pending = await tx.appointmentOffer.count({ where: { agendaSlotId, status: 'PENDING' } });
  if (previous || pending) return unavailable(new ConflictException('Release has already been evaluated or offered'));
  const timeZone = availability.branch.institution.timeZone;
  try { localTime(slot.startsAt, timeZone); } catch { return unavailable(new ServiceUnavailableException('Institution time zone unavailable')); }
  const entries = await tx.waitlistEntry.findMany({
    where: { institutionId, serviceId: availability.serviceId, deletedAt: null, status: { isFinal: false } },
    select: candidateSelect,
    orderBy: [{ priority: { level: 'asc' } }, { enteredAt: 'asc' }, { id: 'asc' }],
  });
  const slotContext = { institutionId, serviceId: availability.serviceId, branchId: availability.branchId,
    sourceUserId: appointment.userId, startsAt: slot.startsAt, endsAt: slot.endsAt, timeZone };
  const policy = availability.branch.institution.currentReassignmentPolicy;
  const strategy = policy?.rankingStrategy ?? 'PRIORITY_THEN_WAITING';
  const evaluations = rankCandidates(entries, strategy).map((entry) => ({ entry, reason: exclusionReason(entry, slotContext, now), id: randomUUID() }));
  const eligible = evaluations.filter((evaluation) => evaluation.reason === null);
  const ttl = policy?.offerTtlMinutes ?? config.getOrThrow<number>('WAITLIST_OFFER_TTL_MINUTES');
  // Finish evaluation before claiming or inserting anything. An elapsed automatic
  // release can then be skipped without leaving a partial process in the cancellation.
  const createdAt = new Date();
  if (slot.startsAt <= createdAt) return unavailable(new ConflictException('Slot is no longer eligible'));
  const expiresAt = new Date(createdAt.getTime() + ttl * 60_000);
  if (eligible.length && !Number.isFinite(expiresAt.getTime())) throw new ServiceUnavailableException('Offer TTL out of supported range');
  const claimed = await tx.agendaSlot.updateMany({
    where: { id: agendaSlotId, status: 'RELEASED', lockVersion: slot.lockVersion, startsAt: { gt: createdAt } },
    data: { lockVersion: { increment: 1 } },
  });
  if (claimed.count !== 1) throw new ConflictException('Slot changed; retry request');
  const reassignmentId = randomUUID();
  await tx.reassignment.create({ data: {
    id: reassignmentId, institutionId, policyId: policy?.id ?? null, originCancellationId: cancellation.id, appointmentId: appointment.id,
    agendaSlotId, serviceId: availability.serviceId, sourceUserId: appointment.userId,
    initialSlotVersion: slot.lockVersion, ruleCode: strategy === 'PRIORITY_THEN_WAITING' ? RULE : 'FIFO_PRIORITY_V1',
    scoringVersion: strategy === 'PRIORITY_THEN_WAITING' ? 'priority-level-asc-fifo-v1' : 'fifo-priority-level-asc-v1',
    criteriaSnapshot: { timeZone, startsAt: slot.startsAt.toISOString(), endsAt: slot.endsAt.toISOString(), branchId: availability.branchId,
      professionalId: availability.professionalId, offerTtlMinutes: ttl, actorUserId,
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
    // Ranking uses the selected ordering; this legacy score representation is unchanged.
    totalScore: reason ? null : new Prisma.Decimal(-entry.priority.level),
    scoreFactors: [{ code: 'PRIORITY_LEVEL', value: entry.priority.level }, { code: 'ENTERED_AT', value: entry.enteredAt.toISOString() }],
    evaluationContext: preferenceSnapshot(entry), exclusionReasonCode: reason, evaluatedAt: now,
  })) });
  const auditContext = { institutionId, branchId: availability.branchId, actorUserId,
    actorType: context.kind === 'MANUAL' ? 'USER' as const : 'SYSTEM' as const, outcome: 'SUCCESS' as const };
  await AuditService.record(tx, { ...auditContext, actionCode: 'REASSIGNMENT_STARTED', resourceType: 'REASSIGNMENT',
    resourceId: reassignmentId, newState: eligible.length ? 'OFFERING' : 'EXHAUSTED' });
  const winner = eligible[0];
  if (!winner) {
    await AuditService.record(tx, { ...auditContext, actionCode: 'REASSIGNMENT_EXHAUSTED', resourceType: 'REASSIGNMENT',
      resourceId: reassignmentId, newState: 'EXHAUSTED', reasonCode: 'NO_ELIGIBLE_CANDIDATES' });
    return { data: { id: reassignmentId, status: 'EXHAUSTED', offer: null } };
  }
  const offer = await tx.appointmentOffer.create({ data: {
    id: randomUUID(), reassignmentId, candidateId: winner.id, agendaSlotId, attemptNumber: 1,
    status: 'PENDING', expectedSlotVersion: slot.lockVersion + 1, createdAt, expiresAt,
  }, select: { id: true } });
  await AuditService.record(tx, { ...auditContext, actionCode: 'OFFER_CREATED', resourceType: 'OFFER', resourceId: offer.id, newState: 'PENDING' });
  await NotificationsService.create(tx, { recipientUserId: winner.entry.userId, type: 'OFFER_CREATED',
    institutionId, branchId: availability.branchId, resourceType: 'OFFER', resourceId: offer.id,
    dedupeKey: `OFFER_CREATED:${offer.id}`, data: { startsAt: slot.startsAt.toISOString(), expiresAt: expiresAt.toISOString() } });
  return { data: { id: reassignmentId, status: 'OFFERING', offer: { id: offer.id, status: 'PENDING', agendaSlotId,
    createdAt: createdAt.toISOString(), expiresAt: expiresAt.toISOString() } } };
}
