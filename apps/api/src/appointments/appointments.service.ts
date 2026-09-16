import { AuditService } from '../audit/audit.service.js';
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

const appointmentSummarySelect = {
  id: true,
  institutionId: true,
  startsAt: true,
  endsAt: true,
  origin: true,
  status: { select: { code: true } },
  branch: { select: { id: true, institutionId: true, name: true } },
  service: { select: { id: true, institutionId: true, name: true } },
  professional: {
    select: {
      id: true,
      institutionId: true,
      user: { select: { firstNames: true, lastNames: true } },
    },
  },
} as const satisfies Prisma.AppointmentSelect;

type AppointmentSummaryRecord = Prisma.AppointmentGetPayload<{ select: typeof appointmentSummarySelect }>;

function mapAppointmentSummary(appointment: AppointmentSummaryRecord) {
  return {
    id: appointment.id,
    institutionId: appointment.institutionId,
    status: appointment.status.code,
    startsAt: appointment.startsAt.toISOString(),
    endsAt: appointment.endsAt.toISOString(),
    origin: appointment.origin,
    branch: { id: appointment.branch.id, name: appointment.branch.name },
    service: { id: appointment.service.id, name: appointment.service.name },
    professional: {
      id: appointment.professional.id,
      firstNames: appointment.professional.user.firstNames,
      lastNames: appointment.professional.user.lastNames,
    },
  };
}

@Injectable()
export class AppointmentsService {
  constructor(private readonly prisma: PrismaService) {}

  async findMine(principal: AuthenticatedPrincipal) {
    const appointments = await this.prisma.appointment.findMany({
      where: { userId: principal.userId, deletedAt: null },
      orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
      select: appointmentSummarySelect,
    });

    return {
      data: appointments
        // Historical appointments remain visible when catalogs become inactive.
        // Inconsistent tenant relations must never expose another tenant's data.
        .filter((appointment) =>
          appointment.branch.institutionId === appointment.institutionId &&
          appointment.service.institutionId === appointment.institutionId &&
          appointment.professional.institutionId === appointment.institutionId,
        )
        .map(mapAppointmentSummary),
    };
  }

  async cancel(appointmentId: string, principal: AuthenticatedPrincipal) {
    return this.cancelWithRetry(appointmentId, principal, true);
  }

  private async cancelWithRetry(
    appointmentId: string,
    principal: AuthenticatedPrincipal,
    retrySerializationConflict: boolean,
  ): Promise<{ data: ReturnType<typeof mapAppointmentSummary> }> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const user = await tx.user.findFirst({
          where: { id: principal.userId, status: UserStatus.ACTIVE, deletedAt: null },
          select: { id: true },
        });
        if (!user) throw new UnauthorizedException('Unauthorized');

        const appointment = await tx.appointment.findFirst({
          where: { id: appointmentId, userId: principal.userId, deletedAt: null },
          select: {
            ...appointmentSummarySelect,
            statusId: true,
            branchId: true,
            serviceId: true,
            professionalId: true,
            status: { select: { code: true, active: true, isFinal: true, allowsCancellation: true } },
            agendaSlot: {
              select: {
                id: true,
                status: true,
                lockVersion: true,
                availability: {
                  select: {
                    branchId: true, serviceId: true, professionalId: true,
                    branch: { select: { institutionId: true } },
                  },
                },
              },
            },
          },
        });
        if (!appointment) throw new NotFoundException('Appointment not found');

        const slot = appointment.agendaSlot;
        if (
          appointment.branch.institutionId !== appointment.institutionId ||
          appointment.service.institutionId !== appointment.institutionId ||
          appointment.professional.institutionId !== appointment.institutionId ||
          slot.availability.branch.institutionId !== appointment.institutionId ||
          slot.availability.branchId !== appointment.branchId ||
          slot.availability.serviceId !== appointment.serviceId ||
          slot.availability.professionalId !== appointment.professionalId
        ) {
          throw new NotFoundException('Appointment not found');
        }

        // A retry must not release again or create another cancellation/history.
        if (appointment.status.code === 'CANCELADA') {
          return { data: mapAppointmentSummary(appointment) };
        }
        if (
          appointment.status.code !== 'AGENDADA' || !appointment.status.active ||
          appointment.status.isFinal || !appointment.status.allowsCancellation ||
          slot.status !== SlotStatus.RESERVED
        ) {
          throw new ConflictException('Appointment cannot be cancelled');
        }
        const cancelledStatus = await tx.appointmentStatus.findUnique({
          where: { code: 'CANCELADA' },
          select: { id: true, code: true, active: true, isFinal: true, allowsCancellation: true, allowsConfirmation: true },
        });
        if (
          !cancelledStatus || !cancelledStatus.active || !cancelledStatus.isFinal ||
          cancelledStatus.allowsCancellation || cancelledStatus.allowsConfirmation
        ) {
          throw new ServiceUnavailableException('Cancellation status unavailable');
        }

        const released = await tx.agendaSlot.updateMany({
          where: {
            id: slot.id, status: SlotStatus.RESERVED, lockVersion: slot.lockVersion,
            appointment: { is: {
              id: appointmentId, userId: principal.userId,
              deletedAt: null, statusId: appointment.statusId,
            } },
          },
          // RELEASED is not public availability; the unique appointment remains attached.
          data: { status: SlotStatus.RELEASED, lockVersion: { increment: 1 } },
        });
        if (released.count !== 1) throw new ConflictException('Appointment changed; retry cancellation');

        const cancelled = await tx.appointment.updateMany({
          where: {
            id: appointmentId, userId: principal.userId, deletedAt: null,
            agendaSlotId: slot.id, statusId: appointment.statusId,
            status: { code: 'AGENDADA', active: true, isFinal: false, allowsCancellation: true },
          },
          data: { statusId: cancelledStatus.id },
        });
        if (cancelled.count !== 1) throw new ConflictException('Appointment changed; retry cancellation');

        await tx.cancellation.create({
          data: {
            id: randomUUID(), appointmentId,
            cancelledByUserId: principal.userId, releasesSlot: true,
          },
          select: { id: true },
        });
        await tx.appointmentHistory.create({
          data: {
            id: randomUUID(), appointmentId,
            previousStatusId: appointment.statusId, newStatusId: cancelledStatus.id,
            previousUserId: principal.userId, newUserId: principal.userId,
            actorUserId: principal.userId,
          },
          select: { id: true },
        });
        await AuditService.record(tx, { institutionId: appointment.institutionId, branchId: appointment.branchId,
          actorUserId: principal.userId, actorType: 'USER', actionCode: 'APPOINTMENT_CANCELLED', resourceType: 'APPOINTMENT',
          resourceId: appointmentId, outcome: 'SUCCESS', previousState: 'AGENDADA', newState: 'CANCELADA' });
        return {
          data: mapAppointmentSummary({ ...appointment, status: { code: cancelledStatus.code } }),
        };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (error instanceof HttpException) throw error;
      const code = typeof error === 'object' && error !== null && 'code' in error
        ? error.code : undefined;
      if (code === 'P2034' && retrySerializationConflict) {
        // A fresh transaction can observe a concurrent cancellation as an idempotent success.
        return this.cancelWithRetry(appointmentId, principal, false);
      }
      if (code === 'P2002' || code === 'P2034' || code === 'P2003') {
        throw new ConflictException('Cancellation conflict; retry cancellation');
      }
      throw new InternalServerErrorException('Unable to cancel appointment');
    }
  }

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

        await AuditService.record(tx, { institutionId: appointment.institutionId, branchId: appointment.branchId,
          actorUserId: principal.userId, actorType: 'USER', actionCode: 'APPOINTMENT_CREATED', resourceType: 'APPOINTMENT',
          resourceId: appointment.id, outcome: 'SUCCESS', newState: 'AGENDADA' });
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
