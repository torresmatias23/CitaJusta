import { randomUUID } from 'node:crypto';
import { ConflictException, HttpException, Injectable, InternalServerErrorException, Logger, NotFoundException, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../database/prisma.service.js';
import { isTransactionConflict } from '../database/transaction-conflict.js';
import { AuditService } from '../audit/audit.service.js';
import type { AuthenticatedPrincipal } from '../auth/types/authenticated-principal.js';
import type { AuthorizationContext } from '../authorization/types/authorization-context.js';
import { confirmationSelect, confirmationStates } from './attendance-confirmation.policy.js';

function confirmationConflict(error: unknown): boolean {
  if (isTransactionConflict(error)) return true;
  // Raw SQL in Prisma 7 wraps the same adapter error in P2010. Unwrap only
  // that typed envelope; the shared classifier still requires TransactionWriteConflict
  // and SQLSTATE 40001/40P01. Other raw SQL/constraint/programming errors propagate.
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2010' &&
    isTransactionConflict(error.meta?.driverAdapterError);
}

@Injectable()
export class AttendanceConfirmationService {
  private readonly logger = new Logger(AttendanceConfirmationService.name);
  constructor(private readonly prisma: PrismaService) {}

  async confirm(appointmentId: string, principal: AuthenticatedPrincipal, context: AuthorizationContext) {
    if (context.userId !== principal.userId) throw new UnauthorizedException('Unauthorized');
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.prisma.$transaction(async tx => {
          if (!await tx.user.findFirst({ where: { id: principal.userId, status: 'ACTIVE', deletedAt: null }, select: { id: true } })) {
            throw new UnauthorizedException('Unauthorized');
          }
          // Lock the same parent row changed by cancellation, attendance and transfer.
          // Together with the confirmation predicate read under Serializable, this
          // serializes duplicate inserts without changing Appointment/AgendaSlot.
          const locked = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
            SELECT id FROM citas WHERE id = ${appointmentId}::uuid AND usuario_id = ${principal.userId}::uuid AND deleted_at IS NULL
              ${context.institutionId ? Prisma.sql`AND institucion_id = ${context.institutionId}::uuid` : Prisma.empty}
              ${context.branchId ? Prisma.sql`AND sede_id = ${context.branchId}::uuid` : Prisma.empty}
            FOR UPDATE
          `);
          if (!locked.length) throw new NotFoundException('Appointment not found');
          const appointment = await tx.appointment.findFirst({ where: { id: appointmentId, userId: principal.userId, deletedAt: null }, select: {
            ...confirmationSelect, id: true, institutionId: true, startsAt: true, endsAt: true,
            branch: { select: { institutionId: true } }, professional: { select: { institutionId: true } },
          } });
          if (!appointment) throw new NotFoundException('Appointment not found');
          const state = (await confirmationStates(tx, principal.userId, [appointment])).get(appointmentId);
          if (!state?.eligible) throw new ConflictException('Appointment does not allow attendance confirmation');
          if (state.confirmed) return { data: { appointmentId, confirmed: true as const, confirmedAt: state.confirmedAt } };
          // The final deadline check and insert are one SQL statement. clock_timestamp
          // (not transaction-start now()) prevents a slow transaction confirming after start.
          const created = await tx.$queryRaw<{ confirmedAt: Date }[]>(Prisma.sql`
            INSERT INTO confirmaciones (id, cita_id, usuario_id, confirmada, confirmada_at)
            SELECT ${randomUUID()}::uuid, id, usuario_id, true, clock_timestamp() AT TIME ZONE 'UTC'
            FROM citas WHERE id = ${appointmentId}::uuid AND usuario_id = ${principal.userId}::uuid
              AND deleted_at IS NULL AND inicio_at > (clock_timestamp() AT TIME ZONE 'UTC')
            RETURNING confirmada_at AS "confirmedAt"
          `);
          if (created.length !== 1) throw new ConflictException('Appointment has already started');
          await AuditService.record(tx, { institutionId: appointment.institutionId, branchId: appointment.branchId,
            actorUserId: principal.userId, actorType: 'USER', actionCode: 'APPOINTMENT_ATTENDANCE_CONFIRMED',
            resourceType: 'APPOINTMENT', resourceId: appointmentId, outcome: 'SUCCESS' });
          return { data: { appointmentId, confirmed: true as const, confirmedAt: created[0]!.confirmedAt.toISOString() } };
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      } catch (error) {
        if (error instanceof HttpException) throw error;
        if (confirmationConflict(error)) {
          if (attempt === 0) continue;
          throw new ConflictException('Concurrent confirmation change; retry request');
        }
        if (error instanceof Prisma.PrismaClientInitializationError || (error instanceof Prisma.PrismaClientKnownRequestError &&
          ['P1001', 'P1002', 'P1008', 'P1017', 'P2024'].includes(error.code))) {
          this.logger.warn('Attendance confirmation storage unavailable');
          throw new ServiceUnavailableException('Attendance confirmation unavailable');
        }
        this.logger.error('Unexpected attendance confirmation failure');
        throw new InternalServerErrorException('Attendance confirmation unavailable');
      }
    }
  }
}
