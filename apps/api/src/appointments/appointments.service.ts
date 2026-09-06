import { randomUUID } from 'node:crypto';
import {
  ConflictException,
  HttpException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import type { AuthenticatedPrincipal } from '../auth/types/authenticated-principal.js';
import { availableAvailabilityWhere } from '../availability/availability.policy.js';
import { PrismaService } from '../database/prisma.service.js';
import {
  AppointmentOrigin,
  Prisma,
  SlotStatus,
  UserStatus,
} from '../generated/prisma/client.js';

@Injectable()
export class AppointmentsService {
  constructor(private readonly prisma: PrismaService) {}

  async reserve(agendaSlotId: string, principal: AuthenticatedPrincipal) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const user = await tx.user.findFirst({
          where: { id: principal.userId, status: UserStatus.ACTIVE, deletedAt: null },
          select: { id: true },
        });
        if (!user) throw new UnauthorizedException('Unauthorized');

        const slot = await tx.agendaSlot.findUnique({
          where: { id: agendaSlotId },
          select: {
            id: true,
            startsAt: true,
            endsAt: true,
            status: true,
            blockedUntilAt: true,
            lockVersion: true,
            appointment: { select: { id: true } },
            availability: {
              select: {
                branchId: true,
                serviceId: true,
                professionalId: true,
                attentionPointId: true,
                branch: { select: { institutionId: true } },
              },
            },
          },
        });
        if (!slot) throw new NotFoundException('Agenda slot not found');

        const context = {
          institutionId: slot.availability.branch.institutionId,
          branchId: slot.availability.branchId,
          serviceId: slot.availability.serviceId,
        };
        const availability = availableAvailabilityWhere(
          context, slot.availability.professionalId,
        );
        const validContext = await tx.agendaSlot.findFirst({
          where: { id: agendaSlotId, availability },
          select: { id: true },
        });
        if (!validContext) {
          throw new NotFoundException('Agenda slot context unavailable');
        }

        const now = new Date();
        if (slot.startsAt <= now || slot.endsAt <= slot.startsAt) {
          throw new ConflictException('Agenda slot has expired or has an invalid interval');
        }
        if (
          slot.status !== SlotStatus.AVAILABLE || slot.appointment !== null ||
          (slot.blockedUntilAt !== null && slot.blockedUntilAt > now)
        ) {
          throw new ConflictException('Agenda slot is not available');
        }

        const status = await tx.appointmentStatus.findUnique({
          where: { code: 'AGENDADA' },
          select: { id: true, code: true, active: true, isFinal: true },
        });
        if (!status || !status.active || status.isFinal) {
          throw new ServiceUnavailableException('Initial appointment status unavailable');
        }

        const writeTime = new Date();
        const reserved = await tx.agendaSlot.updateMany({
          where: {
            id: agendaSlotId,
            status: SlotStatus.AVAILABLE,
            lockVersion: slot.lockVersion,
            startsAt: { gt: writeTime },
            OR: [{ blockedUntilAt: null }, { blockedUntilAt: { lte: writeTime } }],
            availability,
            appointment: { is: null },
          },
          data: { status: SlotStatus.RESERVED, lockVersion: { increment: 1 } },
        });
        if (reserved.count !== 1) throw new ConflictException('Agenda slot changed; retry availability');

        const appointment = await tx.appointment.create({
          data: {
            id: randomUUID(),
            ...context,
            agendaSlotId,
            professionalId: slot.availability.professionalId,
            attentionPointId: slot.availability.attentionPointId,
            userId: principal.userId,
            createdByUserId: principal.userId,
            statusId: status.id,
            origin: AppointmentOrigin.WEB,
            startsAt: slot.startsAt,
            endsAt: slot.endsAt,
          },
          select: {
            id: true,
            agendaSlotId: true,
            institutionId: true,
            branchId: true,
            serviceId: true,
            professionalId: true,
            startsAt: true,
            endsAt: true,
            origin: true,
          },
        });
        await tx.appointmentHistory.create({
          data: {
            id: randomUUID(),
            appointmentId: appointment.id,
            previousStatusId: null,
            newStatusId: status.id,
            previousUserId: null,
            newUserId: principal.userId,
            actorUserId: principal.userId,
          },
          select: { id: true },
        });

        return {
          data: {
            id: appointment.id,
            agendaSlotId: appointment.agendaSlotId,
            institutionId: appointment.institutionId,
            branchId: appointment.branchId,
            serviceId: appointment.serviceId,
            professionalId: appointment.professionalId,
            startsAt: appointment.startsAt.toISOString(),
            endsAt: appointment.endsAt.toISOString(),
            origin: appointment.origin,
            status: status.code,
          },
        };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (error instanceof HttpException) throw error;
      const code = typeof error === 'object' && error !== null && 'code' in error
        ? error.code : undefined;
      if (code === 'P2002' || code === 'P2034' || code === 'P2003') {
        throw new ConflictException('Booking conflict; retry availability');
      }
      throw new InternalServerErrorException('Unable to reserve appointment');
    }
  }
}
