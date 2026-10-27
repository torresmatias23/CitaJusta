import { ForbiddenException, HttpException, Injectable, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { Prisma } from '../generated/prisma/client.js';
import type { AuthorizationContext } from '../authorization/types/authorization-context.js';
import { SUPERVISE_REASSIGNMENTS_PERMISSION } from './reassignment-supervision.service.js';
import { decodeReassignmentCursor, encodeReassignmentCursor, type ReassignmentListingQuery } from './reassignment-listing.schemas.js';

const listingSelect = {
  id: true, institutionId: true, serviceId: true, agendaSlotId: true, appointmentId: true, originCancellationId: true,
  status: true, detectedAt: true, startedAt: true, finishedAt: true, closureReasonCode: true,
  service: { select: { id: true, name: true, institutionId: true } },
  agendaSlot: { select: {
    id: true, startsAt: true, endsAt: true,
    availability: { select: { serviceId: true, branch: { select: { id: true, name: true, institutionId: true } } } },
  } },
  appointment: { select: { id: true, institutionId: true, agendaSlotId: true, serviceId: true, branchId: true } },
  originCancellation: { select: { appointmentId: true } },
  candidates: { select: { id: true, waitlistEntry: { select: { institutionId: true, serviceId: true } } } },
  offers: { select: { candidateId: true } },
} as const satisfies Prisma.ReassignmentSelect;

type ListingRecord = Prisma.ReassignmentGetPayload<{ select: typeof listingSelect }>;

function summary(row: ListingRecord) {
  return {
    id: row.id,
    status: row.status,
    detectedAt: row.detectedAt.toISOString(),
    startedAt: row.startedAt?.toISOString() ?? null,
    finishedAt: row.finishedAt?.toISOString() ?? null,
    closureReasonCode: row.closureReasonCode,
    branch: { id: row.agendaSlot.availability.branch.id, name: row.agendaSlot.availability.branch.name },
    service: { id: row.service.id, name: row.service.name },
    agendaSlot: { id: row.agendaSlot.id, startsAt: row.agendaSlot.startsAt.toISOString(), endsAt: row.agendaSlot.endsAt.toISOString() },
  };
}

function isConsistent(row: ListingRecord, institutionId: string) {
  return row.institutionId === institutionId &&
    row.service.institutionId === institutionId &&
    row.agendaSlot.availability.branch.institutionId === institutionId &&
    row.appointment.institutionId === institutionId &&
    row.appointment.agendaSlotId === row.agendaSlotId &&
    row.appointment.serviceId === row.serviceId &&
    row.agendaSlot.availability.serviceId === row.serviceId &&
    row.appointment.branchId === row.agendaSlot.availability.branch.id &&
    row.originCancellation.appointmentId === row.appointmentId &&
    row.candidates.every((candidate) => candidate.waitlistEntry.institutionId === institutionId &&
      candidate.waitlistEntry.serviceId === row.serviceId) &&
    row.offers.every((offer) => row.candidates.some((candidate) => candidate.id === offer.candidateId));
}

@Injectable()
export class ReassignmentListingService {
  constructor(private readonly prisma: PrismaService) {}

  async find(query: ReassignmentListingQuery, context: AuthorizationContext) {
    if (!context.institutionId || !context.permissions.includes(SUPERVISE_REASSIGNMENTS_PERMISSION)) {
      throw new ForbiddenException('Forbidden');
    }
    const institutionId = context.institutionId;
    try {
      const cursor = query.cursor ? decodeReassignmentCursor(query.cursor) : undefined;
      const where: Prisma.ReassignmentWhereInput = {
        institutionId: context.institutionId,
        ...(query.status ? { status: query.status } : {}),
        service: { institutionId: context.institutionId },
        appointment: { institutionId: context.institutionId },
        agendaSlot: { availability: { branch: {
          institutionId: context.institutionId,
          ...(context.branchId ? { id: context.branchId } : {}),
        } } },
      };
      if (cursor) {
        const anchor = await this.prisma.reassignment.findFirst({ where: { ...where, id: cursor.id }, select: listingSelect });
        if (!anchor || !isConsistent(anchor, context.institutionId)) throw new NotFoundException('Resource not found');
      }
      const rows = await this.prisma.reassignment.findMany({
        where,
        select: listingSelect,
        ...(cursor ? { cursor: { id: cursor.id }, skip: 1 } : {}),
        take: query.limit + 1,
        orderBy: [{ detectedAt: 'desc' }, { id: 'desc' }],
      });
      const scanned = rows.slice(0, query.limit);
      const last = scanned.at(-1);
      return {
        data: scanned.filter((row) => isConsistent(row, institutionId)).map(summary),
        page: { nextCursor: rows.length > query.limit && last ? encodeReassignmentCursor(last) : null },
      };
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new InternalServerErrorException('Unable to list reassignments', { cause: error });
    }
  }
}
