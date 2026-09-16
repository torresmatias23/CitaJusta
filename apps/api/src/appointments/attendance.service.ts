import { AuditService } from '../audit/audit.service.js';
import { randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import type { AuthorizationContext } from '../authorization/types/authorization-context.js';
import { PrismaService } from '../database/prisma.service.js';
import { isTransactionConflict } from '../database/transaction-conflict.js';
import { Prisma } from '../generated/prisma/client.js';
import type { AttendanceStatus } from './attendance.schemas.js';

const select = {
  id: true, userId: true, statusId: true, branchId: true, serviceId: true, professionalId: true, attentionPointId: true,
  startsAt: true, endsAt: true, updatedAt: true,
  status: { select: { code: true, name: true, active: true, isFinal: true } },
  branch: { select: { id: true, name: true } }, service: { select: { id: true, name: true } },
  professional: { select: { id: true, titleOrFunction: true, user: { select: { firstNames: true, lastNames: true } } } },
  attentionPoint: { select: { branchId: true } },
  agendaSlot: { select: { availability: { select: { branchId: true, serviceId: true, professionalId: true, attentionPointId: true } } } },
} as const satisfies Prisma.AppointmentSelect;
type Record = Prisma.AppointmentGetPayload<{ select: typeof select }>;

function dto(row: Record) {
  return { id: row.id, status: { code: row.status.code, name: row.status.name },
    startsAt: row.startsAt.toISOString(), endsAt: row.endsAt.toISOString(),
    branch: { id: row.branch.id, name: row.branch.name }, service: { id: row.service.id, name: row.service.name },
    professional: { id: row.professional.id, firstNames: row.professional.user.firstNames,
      lastNames: row.professional.user.lastNames, titleOrFunction: row.professional.titleOrFunction } };
}

@Injectable()
export class AttendanceService {
  constructor(private readonly prisma: PrismaService) {}

  async record(id: string, status: AttendanceStatus, context: AuthorizationContext) {
    if (!context.institutionId) throw new BadRequestException('Institutional context required');
    const institutionId = context.institutionId;
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.prisma.$transaction(async (tx) => {
          await this.authorize(tx, context);
          const where = { id, institutionId, deletedAt: null,
            ...(context.branchId ? { branchId: context.branchId } : {}),
            branch: { institutionId }, service: { institutionId }, professional: { institutionId } };
          const appointment = await tx.appointment.findFirst({ where, select });
          if (!appointment) throw new NotFoundException('Appointment not found');
          const availability = appointment.agendaSlot.availability;
          if (availability.branchId !== appointment.branchId || availability.serviceId !== appointment.serviceId ||
              availability.professionalId !== appointment.professionalId || availability.attentionPointId !== appointment.attentionPointId ||
              (appointment.attentionPoint && appointment.attentionPoint.branchId !== appointment.branchId)) {
            throw new NotFoundException('Appointment not found');
          }
          if (appointment.status.code === status) return { data: dto(appointment) };
          if (appointment.status.code !== 'AGENDADA' || !appointment.status.active || appointment.status.isFinal) {
            throw new ConflictException('Appointment outcome cannot be changed');
          }
          const target = await tx.appointmentStatus.findUnique({ where: { code: status } });
          if (!target || !target.active || !target.isFinal || target.allowsCancellation || target.allowsConfirmation) {
            throw new ServiceUnavailableException('Attendance status unavailable');
          }
          const changed = await tx.appointment.updateMany({ where: { ...where, statusId: appointment.statusId,
            userId: appointment.userId, updatedAt: appointment.updatedAt }, data: { statusId: target.id } });
          if (changed.count !== 1) throw new ConflictException('Appointment changed; retry request');
          await tx.appointmentHistory.create({ data: {
            id: randomUUID(), appointmentId: appointment.id, previousStatusId: appointment.statusId, newStatusId: target.id,
            previousUserId: appointment.userId, newUserId: appointment.userId, actorUserId: context.userId,
            reason: status === 'ATENDIDA' ? 'ATTENDANCE_RECORDED' : 'NO_SHOW_RECORDED',
          } });
          await AuditService.record(tx, { institutionId, branchId: appointment.branchId, actorUserId: context.userId,
            actorType: 'USER', actionCode: status === 'ATENDIDA' ? 'ATTENDANCE_RECORDED' : 'NO_SHOW_RECORDED',
            resourceType: 'APPOINTMENT', resourceId: appointment.id, outcome: 'SUCCESS', previousState: 'AGENDADA', newState: status });
          return { data: dto({ ...appointment, status: target }) };
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      } catch (error) {
        if (!isTransactionConflict(error)) throw error;
        if (attempt === 0) continue;
        throw new ConflictException('Concurrent attendance change; retry request');
      }
    }
  }

  private async authorize(tx: Prisma.TransactionClient, context: AuthorizationContext) {
    if (!await tx.user.findFirst({ where: { id: context.userId, status: 'ACTIVE', deletedAt: null }, select: { id: true } })) {
      throw new UnauthorizedException('Unauthorized');
    }
    const now = new Date();
    const grant = await tx.userRole.count({ where: {
      userId: context.userId, active: true,
      role: { active: true, permissions: { some: { permission: { code: 'appointments.attendance' } } } },
      AND: [
        { OR: [{ validFrom: null }, { validFrom: { lte: now } }] },
        { OR: [{ validTo: null }, { validTo: { gte: now } }] },
        { OR: [{ role: { scope: 'GLOBAL' } }, { role: { scope: 'INSTITUTION' }, institutionId: context.institutionId },
          ...(context.branchId ? [{ role: { scope: 'BRANCH' as const }, branchId: context.branchId,
            OR: [{ institutionId: null }, { institutionId: context.institutionId }] }] : [])] },
      ],
    } });
    if (!grant) throw new ForbiddenException('Forbidden');
  }
}
