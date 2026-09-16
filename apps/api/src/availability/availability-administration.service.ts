import { AuditService } from '../audit/audit.service.js';
import { randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { AuthorizationContext } from '../authorization/types/authorization-context.js';
import { PrismaService } from '../database/prisma.service.js';
import { isTransactionConflict } from '../database/transaction-conflict.js';
import { Prisma } from '../generated/prisma/client.js';
import { exceedsCapacity, futureInterval, localWindow, slotIntervals,
  type CreateAvailabilityInput, type UpdateAvailabilityInput, type CreateBlockInput } from './availability-administration.schemas.js';

const slotSelect = { id: true, startsAt: true, endsAt: true, status: true } as const;
const protectedSlotSelect = { ...slotSelect, lockVersion: true, blockedUntilAt: true,
  appointment: { select: { id: true } }, reassignments: { select: { id: true }, take: 1 } } as const;
type SelectedSlot = Prisma.AgendaSlotGetPayload<{ select: typeof slotSelect }>;
type ProtectedSlot = Prisma.AgendaSlotGetPayload<{ select: typeof protectedSlotSelect }>;
type AvailabilityRecord = Prisma.AvailabilityGetPayload<object>;

@Injectable()
export class AvailabilityAdministrationService {
  constructor(private readonly prisma: PrismaService) {}

  create(input: CreateAvailabilityInput, context: AuthorizationContext) {
    return this.write(async (tx) => {
      const institution = await this.authorize(tx, context, input.branchId, 'availability.create');
      const duration = await this.requireRelations(tx, context.institutionId!, input);
      const { start, end } = futureInterval(input.startsAt, input.endsAt);
      const window = localWindow(start, end, institution.timeZone);
      const intervals = slotIntervals(start, end, duration);
      await this.requireNoOverlap(tx, input, window, start, end);
      const availability = await tx.availability.create({ data: {
        id: randomUUID(), professionalId: input.professionalId, serviceId: input.serviceId,
        branchId: input.branchId, attentionPointId: input.attentionPointId ?? null,
        ...window, origin: 'MANUAL', capacity: 1,
      } });
      const slots = await this.materialize(tx, availability, intervals, context.institutionId!, institution.timeZone);
      await AuditService.record(tx, { institutionId: context.institutionId!, branchId: input.branchId, actorUserId: context.userId,
        actorType: 'USER', actionCode: 'AVAILABILITY_CREATED', resourceType: 'AVAILABILITY', resourceId: availability.id, outcome: 'SUCCESS' });
      return { data: this.dto(availability, slots, institution.timeZone) };
    });
  }

  update(id: string, input: UpdateAvailabilityInput, context: AuthorizationContext) {
    return this.write(async (tx) => {
      if (!context.institutionId) throw new BadRequestException('Institutional context required');
      const existing = await tx.availability.findFirst({ where: {
        id, branch: { institutionId: context.institutionId },
        professional: { institutionId: context.institutionId }, service: { institutionId: context.institutionId },
        ...(context.branchId ? { branchId: context.branchId } : {}),
      } });
      if (!existing) throw new NotFoundException('Availability not found');
      const institution = await this.authorize(tx, context, existing.branchId, 'availability.update');
      const oldSlots = await tx.agendaSlot.findMany({ where: { availabilityId: id }, select: protectedSlotSelect });
      if (oldSlots.some((slot) => this.isProtected(slot) || slot.status === 'BLOCKED' ||
          (slot.blockedUntilAt !== null && slot.blockedUntilAt > new Date()))) {
        throw new ConflictException('Availability has protected or blocked slots');
      }
      let window = { date: existing.date, startTime: existing.startTime, endTime: existing.endTime };
      let intervals: Array<{ startsAt: Date; endsAt: Date }> = [];
      const active = input.active ?? existing.active;
      if (input.startsAt !== undefined && input.endsAt !== undefined) {
        const duration = await this.requireRelations(tx, context.institutionId, existing);
        const { start, end } = futureInterval(input.startsAt, input.endsAt);
        window = localWindow(start, end, institution.timeZone);
        intervals = slotIntervals(start, end, duration);
        if (active) await this.requireNoOverlap(tx, existing, window, start, end, id);
      }
      for (const slot of oldSlots) {
        const changed = await tx.agendaSlot.updateMany({ where: {
          id: slot.id, lockVersion: slot.lockVersion, status: slot.status,
          appointment: { is: null }, reassignments: { none: {} },
        }, data: { status: 'EXPIRED', lockVersion: { increment: 1 } } });
        if (changed.count !== 1) throw new ConflictException('Agenda slot changed');
      }
      const availability = await tx.availability.update({ where: { id }, data: { ...window, active } });
      const slots = active ? await this.materialize(tx, availability, intervals, context.institutionId, institution.timeZone) : [];
      await AuditService.record(tx, { institutionId: context.institutionId, branchId: existing.branchId, actorUserId: context.userId,
        actorType: 'USER', actionCode: 'AVAILABILITY_UPDATED', resourceType: 'AVAILABILITY', resourceId: id, outcome: 'SUCCESS' });
      return { data: this.dto(availability, slots, institution.timeZone) };
    });
  }

  block(input: CreateBlockInput, context: AuthorizationContext) {
    return this.write(async (tx) => {
      await this.authorize(tx, context, input.branchId, 'availability.block');
      const institutionId = context.institutionId!;
      await this.requireBlockRelations(tx, institutionId, input);
      const { start, end } = futureInterval(input.startsAt, input.endsAt);
      const scope = { institutionId, branchId: input.branchId,
        professionalId: input.professionalId ?? null, attentionPointId: input.attentionPointId ?? null };
      if (await tx.scheduleBlock.findFirst({ where: { ...scope, startsAt: start, endsAt: end }, select: { id: true } })) {
        throw new ConflictException('Equivalent schedule block already exists');
      }
      const where: Prisma.AgendaSlotWhereInput = {
        startsAt: { lt: end }, endsAt: { gt: start },
        availability: { branchId: input.branchId, branch: { institutionId },
          ...(input.professionalId ? { professionalId: input.professionalId } : {}),
          ...(input.attentionPointId ? { attentionPointId: input.attentionPointId } : {}),
        },
      };
      const slots = await tx.agendaSlot.findMany({ where, select: protectedSlotSelect, take: 5001 });
      if (slots.length > 5000) throw new BadRequestException('Block exceeds 5000 materialized slots');
      // Check appointments independently as a defense against inconsistent legacy slot intervals.
      const appointments = await tx.appointment.count({ where: {
        institutionId, branchId: input.branchId, startsAt: { lt: end }, endsAt: { gt: start },
        ...(input.professionalId ? { professionalId: input.professionalId } : {}),
        ...(input.attentionPointId ? { attentionPointId: input.attentionPointId } : {}),
      } });
      if (appointments || slots.some((slot) => this.isProtected(slot))) {
        throw new ConflictException('Block overlaps an appointment or protected slot');
      }
      const block = await tx.scheduleBlock.create({ data: {
        id: randomUUID(), ...scope, startsAt: start, endsAt: end,
        type: input.type, reason: input.reason, createdByUserId: context.userId,
      } });
      for (const slot of slots.filter((slot) => slot.status === 'AVAILABLE')) {
        const changed = await tx.agendaSlot.updateMany({ where: {
          id: slot.id, status: 'AVAILABLE', lockVersion: slot.lockVersion,
          appointment: { is: null }, reassignments: { none: {} },
        }, data: { status: 'BLOCKED', lockVersion: { increment: 1 } } });
        if (changed.count !== 1) throw new ConflictException('Agenda slot changed');
      }
      await AuditService.record(tx, { institutionId, branchId: input.branchId, actorUserId: context.userId, actorType: 'USER',
        actionCode: 'SCHEDULE_BLOCK_CREATED', resourceType: 'SCHEDULE_BLOCK', resourceId: block.id, outcome: 'SUCCESS' });
      return { data: { id: block.id, branchId: block.branchId, professionalId: block.professionalId,
        attentionPointId: block.attentionPointId, type: block.type, reason: block.reason,
        startsAt: block.startsAt.toISOString(), endsAt: block.endsAt.toISOString(), createdAt: block.createdAt.toISOString() } };
    });
  }

  private isProtected(slot: ProtectedSlot) {
    return slot.appointment !== null || slot.reassignments.length > 0 || slot.status === 'RESERVED' || slot.status === 'RELEASED';
  }

  private async authorize(tx: Prisma.TransactionClient, context: AuthorizationContext, branchId: string, permission: string) {
    if (!context.institutionId) throw new BadRequestException('Institutional context required');
    if (context.branchId && context.branchId !== branchId) throw new NotFoundException('Branch not found');
    const now = new Date();
    const grant = await tx.userRole.count({ where: {
      userId: context.userId, active: true, user: { status: 'ACTIVE', deletedAt: null },
      role: { active: true, permissions: { some: { permission: { code: permission } } } },
      AND: [
        { OR: [{ validFrom: null }, { validFrom: { lte: now } }] },
        { OR: [{ validTo: null }, { validTo: { gte: now } }] },
        { OR: [ { role: { scope: 'GLOBAL' } }, { role: { scope: 'INSTITUTION' }, institutionId: context.institutionId },
          ...(context.branchId === branchId ? [{ role: { scope: 'BRANCH' as const }, branchId,
            OR: [{ institutionId: null }, { institutionId: context.institutionId }] }] : []) ] },
      ],
    } });
    if (!grant) throw new ForbiddenException('Forbidden');
    const branch = await tx.branch.findFirst({ where: { id: branchId, institutionId: context.institutionId,
      status: 'ACTIVE', deletedAt: null, institution: { status: 'ACTIVE', deletedAt: null } },
      select: { institution: { select: { timeZone: true } } } });
    if (!branch) throw new NotFoundException('Branch not found');
    return branch.institution;
  }

  private async requireRelations(tx: Prisma.TransactionClient, institutionId: string,
    input: { professionalId: string; serviceId: string; branchId: string; attentionPointId?: string | null }) {
    const professional = await tx.professional.findFirst({ where: {
      id: input.professionalId, institutionId, status: 'ACTIVE', deletedAt: null,
      user: { status: 'ACTIVE', deletedAt: null },
      branchAssignments: { some: { branchId: input.branchId, active: true } },
      serviceAssignments: { some: { serviceId: input.serviceId, active: true } },
    }, select: { serviceAssignments: { where: { serviceId: input.serviceId, active: true }, select: { customDurationMinutes: true } } } });
    const service = await tx.service.findFirst({ where: { id: input.serviceId, institutionId, active: true, deletedAt: null,
      branchAssignments: { some: { branchId: input.branchId, active: true } } }, select: { durationMinutes: true } });
    if (!professional || !service) throw new NotFoundException('Professional/service context unavailable');
    await this.requirePoint(tx, input.branchId, input.attentionPointId);
    return professional.serviceAssignments[0]?.customDurationMinutes ?? service.durationMinutes;
  }

  private async requirePoint(tx: Prisma.TransactionClient, branchId: string, attentionPointId?: string | null) {
    if (!attentionPointId) return null;
    const point = await tx.attentionPoint.findFirst({ where: { id: attentionPointId, branchId, active: true }, select: { capacity: true } });
    if (!point || point.capacity < 1) throw new NotFoundException('Attention point unavailable');
    return point;
  }

  private async requireBlockRelations(tx: Prisma.TransactionClient, institutionId: string, input: CreateBlockInput) {
    if (input.professionalId && !await tx.professional.findFirst({ where: { id: input.professionalId, institutionId,
      status: 'ACTIVE', deletedAt: null, branchAssignments: { some: { branchId: input.branchId, active: true } } }, select: { id: true } })) {
      throw new NotFoundException('Professional not found');
    }
    await this.requirePoint(tx, input.branchId, input.attentionPointId);
  }

  private async requireNoOverlap(tx: Prisma.TransactionClient,
    input: { professionalId: string; attentionPointId?: string | null }, window: ReturnType<typeof localWindow>, start: Date, end: Date, excludeId?: string) {
    const overlapping = await tx.availability.findMany({ where: {
      ...(excludeId ? { id: { not: excludeId } } : {}), active: true, date: window.date,
      startTime: { lt: window.endTime }, endTime: { gt: window.startTime },
      OR: [{ professionalId: input.professionalId }, ...(input.attentionPointId ? [{ attentionPointId: input.attentionPointId }] : [])],
    }, select: { id: true, professionalId: true, startTime: true, endTime: true } });
    if (overlapping.some((row) => row.professionalId === input.professionalId)) throw new ConflictException('Professional availability overlaps');
    const occupied = await tx.agendaSlot.findFirst({ where: {
      startsAt: { lt: end }, endsAt: { gt: start },
      availability: { professionalId: input.professionalId, ...(excludeId ? { id: { not: excludeId } } : {}) },
      OR: [{ status: { not: 'EXPIRED' } }, { appointment: { isNot: null } }, { reassignments: { some: {} } }],
    }, select: { id: true } });
    if (occupied) throw new ConflictException('Professional has overlapping materialized slots');
    if (input.attentionPointId) {
      const point = await tx.attentionPoint.findUniqueOrThrow({ where: { id: input.attentionPointId }, select: { capacity: true } });
      // Include retained slots of inactive parents without double-counting active availability.
      const retained = await tx.agendaSlot.findMany({ where: {
        startsAt: { lt: end }, endsAt: { gt: start },
        availability: { attentionPointId: input.attentionPointId, active: false, ...(excludeId ? { id: { not: excludeId } } : {}) },
        OR: [{ status: { not: 'EXPIRED' } }, { appointment: { isNot: null } }],
      }, select: { startsAt: true, endsAt: true } });
      const offset = +start - +window.startTime;
      const intervals = [{ start: +start, end: +end },
        ...overlapping.map((row) => ({ start: +row.startTime + offset, end: +row.endTime + offset })),
        ...retained.map((row) => ({ start: +row.startsAt, end: +row.endsAt }))];
      if (exceedsCapacity(intervals, point.capacity)) throw new ConflictException('Attention point capacity exceeded');
    }
  }

  private async materialize(tx: Prisma.TransactionClient, availability: AvailabilityRecord,
    intervals: Array<{ startsAt: Date; endsAt: Date }>, institutionId: string, timeZone: string) {
    const first = intervals[0]; const last = intervals.at(-1);
    if (!first || !last) throw new BadRequestException('Explicit interval required for activation');
    const blocks = await tx.scheduleBlock.findMany({ where: {
      institutionId, startsAt: { lt: last.endsAt }, endsAt: { gt: first.startsAt },
      AND: [ { OR: [{ branchId: null }, { branchId: availability.branchId }] },
        { OR: [{ professionalId: null }, { professionalId: availability.professionalId }] },
        { OR: [{ attentionPointId: null }, { attentionPointId: availability.attentionPointId }] } ],
    }, select: { startsAt: true, endsAt: true } });
    const holidays = await tx.holiday.findMany({ where: { institutionId, date: availability.date,
      OR: [{ branchId: null }, { branchId: availability.branchId }] },
      select: { blocksEntireDay: true, startTime: true, endTime: true } });
    const slots: SelectedSlot[] = [];
    for (const interval of intervals) {
      const wall = localWindow(interval.startsAt, interval.endsAt, timeZone);
      const blocked = blocks.some((block) => block.startsAt < interval.endsAt && block.endsAt > interval.startsAt) ||
        holidays.some((holiday) => holiday.blocksEntireDay || !holiday.startTime || !holiday.endTime ||
          (holiday.startTime < wall.endTime && holiday.endTime > wall.startTime));
      slots.push(await tx.agendaSlot.upsert({
        where: { availabilityId_startsAt_endsAt: { availabilityId: availability.id, ...interval } },
        create: { id: randomUUID(), availabilityId: availability.id, ...interval, status: blocked ? 'BLOCKED' : 'AVAILABLE' },
        update: { status: blocked ? 'BLOCKED' : 'AVAILABLE', lockVersion: { increment: 1 } }, select: slotSelect,
      }));
    }
    return slots;
  }

  private dto(availability: AvailabilityRecord, slots: SelectedSlot[], timeZone: string) {
    return { id: availability.id, professionalId: availability.professionalId, serviceId: availability.serviceId,
      branchId: availability.branchId, attentionPointId: availability.attentionPointId, date: availability.date.toISOString().slice(0, 10),
      startTime: availability.startTime.toISOString().slice(11, 16), endTime: availability.endTime.toISOString().slice(11, 16),
      timeZone, active: availability.active, capacity: availability.capacity, origin: availability.origin,
      createdAt: availability.createdAt.toISOString(), updatedAt: availability.updatedAt.toISOString(),
      slots: slots.map((slot) => ({ id: slot.id, startsAt: slot.startsAt.toISOString(), endsAt: slot.endsAt.toISOString(), status: slot.status })) };
  }

  private async write<T>(operation: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try { return await this.prisma.$transaction(operation, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }); }
      catch (error) {
        if (isTransactionConflict(error)) {
          if (attempt === 0) continue;
          throw new ConflictException('Concurrent availability change; retry request');
        }
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new ConflictException('Equivalent availability already exists');
        throw error;
      }
    }
  }
}
