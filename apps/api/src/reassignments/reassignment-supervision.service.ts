import { ForbiddenException, HttpException, Injectable, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { z } from 'zod';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../database/prisma.service.js';
import type { AuthorizationContext } from '../authorization/types/authorization-context.js';

export const SUPERVISE_REASSIGNMENTS_PERMISSION = 'reassignments.read';
const date = z.string().datetime();
const uuid = z.string().uuid();
// Allowlist recorded evaluation fields: never expose arbitrary operational JSON/notes.
const criteriaSchema = z.object({
  timeZone: z.string().optional(), startsAt: date.optional(), endsAt: date.optional(),
  branchId: uuid.optional(), professionalId: uuid.optional(), offerTtlMinutes: z.number().optional(),
  actorUserId: uuid.optional(), emptyPreferences: z.string().optional(), explicitDaysOverrideWeekendFlag: z.boolean().optional(),
});
const evaluationSchema = z.object({
  statusCode: z.string().optional(), enteredAt: date.optional(), branchId: uuid.nullable().optional(),
  preferredBranchIds: z.array(uuid).optional(), allowsOtherBranches: z.boolean().optional(),
  minimumNoticeMinutes: z.number().optional(), deadlineDate: date.nullable().optional(),
  priorityCode: z.string().optional(), priorityActive: z.boolean().optional(),
  preferences: z.object({
    acceptsAnyProfessional: z.boolean(), acceptsAnyTime: z.boolean(), acceptsWeekend: z.boolean(),
    preferredDays: z.array(z.number()), timeRanges: z.array(z.object({ start: z.string(), end: z.string() })),
  }).nullable().optional(),
});
const factorsSchema = z.array(z.discriminatedUnion('code', [
  z.object({ code: z.literal('PRIORITY_LEVEL'), value: z.number() }),
  z.object({ code: z.literal('ENTERED_AT'), value: date }),
]));
const named = { id: true, name: true } as const;
export const supervisionSelect = {
  policy: { select: { id: true, version: true, rankingStrategy: true, offerTtlMinutes: true } },
  id: true, institutionId: true, serviceId: true, agendaSlotId: true, status: true,
  ruleCode: true, scoringVersion: true, criteriaSnapshot: true, initialSlotVersion: true,
  lockVersion: true, closureReasonCode: true, detectedAt: true, startedAt: true, finishedAt: true,
  createdAt: true, updatedAt: true,
  institution: { select: named }, service: { select: { ...named, institutionId: true } },
  originCancellation: { select: { id: true, appointmentId: true, cancelledAt: true, cancelledByUserId: true } },
  agendaSlot: { select: { id: true, status: true, startsAt: true, endsAt: true, lockVersion: true,
    availability: { select: { serviceId: true, branch: { select: { ...named, institutionId: true } } } },
  } },
  appointment: { select: { id: true, institutionId: true, agendaSlotId: true, serviceId: true, branchId: true,
    userId: true, status: { select: { code: true } }, origin: true, startsAt: true, endsAt: true,
  } },
  candidates: { select: {
    id: true, waitlistEntryId: true, userId: true, evaluationStatus: true, rankingPosition: true,
    exclusionReasonCode: true, priorityLevelSnapshot: true, entryUpdatedAtSnapshot: true,
    totalScore: true, scoreFactors: true, evaluationContext: true, evaluatedAt: true, createdAt: true,
    waitlistEntry: { select: { institutionId: true, serviceId: true } },
  }, orderBy: [{ rankingPosition: { sort: 'asc', nulls: 'last' } }, { id: 'asc' }] },
  offers: { select: {
    id: true, candidateId: true, attemptNumber: true, status: true, expectedSlotVersion: true,
    lockVersion: true, createdAt: true, expiresAt: true, respondedAt: true, resolvedAt: true,
    respondedByUserId: true, resolutionReasonCode: true,
  }, orderBy: [{ attemptNumber: 'asc' }, { id: 'asc' }] },
} as const satisfies Prisma.ReassignmentSelect;
type SupervisionRecord = Prisma.ReassignmentGetPayload<{ select: typeof supervisionSelect }>;
const iso = (value: Date | null) => value?.toISOString() ?? null;

export function mapSupervision(record: SupervisionRecord, observedAt: Date) {
  const criteria = criteriaSchema.safeParse(record.criteriaSnapshot).data ?? {};
  const candidates = record.candidates.map((candidate) => ({
    id: candidate.id, waitlistEntryId: candidate.waitlistEntryId, recipient: { id: candidate.userId },
    evaluationStatus: candidate.evaluationStatus, rankingPosition: candidate.rankingPosition,
    exclusionReasonCode: candidate.exclusionReasonCode, evaluatedAt: iso(candidate.evaluatedAt), createdAt: iso(candidate.createdAt),
    snapshot: {
      priorityLevel: candidate.priorityLevelSnapshot, entryUpdatedAt: iso(candidate.entryUpdatedAtSnapshot),
      totalScore: candidate.totalScore?.toString() ?? null,
      scoreFactors: factorsSchema.safeParse(candidate.scoreFactors).data ?? [],
      evaluationContext: evaluationSchema.safeParse(candidate.evaluationContext).data ?? {},
    },
  }));
  const offers = record.offers.map((offer) => ({
    id: offer.id, candidateId: offer.candidateId,
    recipient: { id: record.candidates.find((candidate) => candidate.id === offer.candidateId)!.userId },
    attemptNumber: offer.attemptNumber, status: offer.status, expectedSlotVersion: offer.expectedSlotVersion,
    lockVersion: offer.lockVersion, createdAt: iso(offer.createdAt), expiresAt: iso(offer.expiresAt),
    respondedAt: iso(offer.respondedAt), resolvedAt: iso(offer.resolvedAt),
    respondedByUserId: offer.respondedByUserId, resolutionReasonCode: offer.resolutionReasonCode,
  }));
  const pending = record.offers.find((offer) => offer.status === 'PENDING');
  return { data: {
    policy: record.policy ? { id: record.policy.id, version: record.policy.version,
      rankingStrategy: record.policy.rankingStrategy, offerTtlMinutes: record.policy.offerTtlMinutes } : null,
    id: record.id, status: record.status, institution: { id: record.institution.id, name: record.institution.name },
    branch: { id: record.agendaSlot.availability.branch.id, name: record.agendaSlot.availability.branch.name },
    service: { id: record.service.id, name: record.service.name },
    agendaSlot: { id: record.agendaSlot.id, status: record.agendaSlot.status, startsAt: iso(record.agendaSlot.startsAt),
      endsAt: iso(record.agendaSlot.endsAt), lockVersion: record.agendaSlot.lockVersion },
    appointment: { id: record.appointment.id, status: record.appointment.status.code, origin: record.appointment.origin,
      currentUserId: record.appointment.userId, startsAt: iso(record.appointment.startsAt), endsAt: iso(record.appointment.endsAt) },
    originCancellation: { id: record.originCancellation.id, cancelledAt: iso(record.originCancellation.cancelledAt), actorUserId: record.originCancellation.cancelledByUserId },
    evaluation: { ruleCode: record.ruleCode, scoringVersion: record.scoringVersion, criteriaSnapshot: criteria,
      initiation: { kind: criteria.actorUserId ? 'AUTHORIZED_REQUEST' : 'NOT_RECORDED', actorUserId: criteria.actorUserId ?? null } },
    initialSlotVersion: record.initialSlotVersion, lockVersion: record.lockVersion, closureReasonCode: record.closureReasonCode,
    detectedAt: iso(record.detectedAt), startedAt: iso(record.startedAt), finishedAt: iso(record.finishedAt),
    createdAt: iso(record.createdAt), updatedAt: iso(record.updatedAt), observedAt: iso(observedAt),
    candidates, offers,
    pendingOfferId: pending?.id ?? null,
    activeOfferId: record.status === 'OFFERING' && pending && pending.expiresAt > observedAt ? pending.id : null,
  } };
}

@Injectable()
export class ReassignmentSupervisionService {
  constructor(private readonly prisma: PrismaService) {}
  async getDetail(id: string, context: AuthorizationContext) {
    if (!context.institutionId || !context.permissions.includes(SUPERVISE_REASSIGNMENTS_PERMISSION)) throw new ForbiddenException('Forbidden');
    try {
      return await this.prisma.$transaction(async (tx) => {
        const record = await tx.reassignment.findFirst({ where: {
          id, institutionId: context.institutionId,
          ...(context.branchId ? { agendaSlot: { availability: { branchId: context.branchId } } } : {}),
        }, select: supervisionSelect });
        if (!record || record.service.institutionId !== context.institutionId ||
            record.agendaSlot.availability.branch.institutionId !== context.institutionId ||
            record.appointment.institutionId !== context.institutionId || record.appointment.agendaSlotId !== record.agendaSlotId ||
            record.appointment.serviceId !== record.serviceId || record.agendaSlot.availability.serviceId !== record.serviceId ||
            record.appointment.branchId !== record.agendaSlot.availability.branch.id ||
            record.originCancellation.appointmentId !== record.appointment.id ||
            record.candidates.some((candidate) => candidate.waitlistEntry.institutionId !== context.institutionId || candidate.waitlistEntry.serviceId !== record.serviceId) ||
            record.offers.some((offer) => !record.candidates.some((candidate) => candidate.id === offer.candidateId))) {
          throw new NotFoundException('Reassignment not found');
        }
        return mapSupervision(record, new Date());
      }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new InternalServerErrorException('Unable to read reassignment', { cause: error });
    }
  }
}
