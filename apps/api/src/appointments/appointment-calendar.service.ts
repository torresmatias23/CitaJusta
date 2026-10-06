import { ConflictException, ForbiddenException, Injectable, Logger, NotFoundException, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AuthenticatedPrincipal, AuthenticatedRequest } from '../auth/types/authenticated-principal.js';
import { AuditService } from '../audit/audit.service.js';
import { PrismaService } from '../database/prisma.service.js';
import { Prisma, SlotStatus, UserStatus } from '../generated/prisma/client.js';
import { calendarEventId, GoogleCalendarAdapter, type CalendarEvent } from './google-calendar.adapter.js';

const select = {
  id: true, institutionId: true, branchId: true, serviceId: true, professionalId: true, attentionPointId: true,
  startsAt: true, endsAt: true,
  status: { select: { code: true, active: true, isFinal: true } },
  institution: { select: { timeZone: true } },
  branch: { select: { institutionId: true, addressLine1: true, addressLine2: true, municipality: true, region: true, country: true } },
  service: { select: { institutionId: true, name: true } },
  professional: { select: { institutionId: true, user: { select: { firstNames: true, lastNames: true } } } },
  attentionPoint: { select: { branchId: true } },
  agendaSlot: { select: { startsAt: true, endsAt: true, status: true,
    availability: { select: { branchId: true, serviceId: true, professionalId: true, attentionPointId: true,
      branch: { select: { institutionId: true } } } } } },
} as const satisfies Prisma.AppointmentSelect;
type Record = Prisma.AppointmentGetPayload<{ select: typeof select }>;

export function buildCalendarEvent(appointment: Record): CalendarEvent {
  const location = [appointment.branch.addressLine1, appointment.branch.addressLine2,
    appointment.branch.municipality, appointment.branch.region, appointment.branch.country]
    .map((value) => value?.trim()).filter(Boolean).join(', ');
  const professional = `${appointment.professional.user.firstNames} ${appointment.professional.user.lastNames}`.trim();
  return {
    id: calendarEventId(appointment.id), summary: `CitaJusta · ${appointment.service.name}`,
    description: `Profesional: ${professional}. Cita registrada en CitaJusta. Consulta CitaJusta para verificar su estado vigente.`,
    ...(location ? { location } : {}),
    start: { dateTime: appointment.startsAt.toISOString(), timeZone: appointment.institution.timeZone },
    end: { dateTime: appointment.endsAt.toISOString(), timeZone: appointment.institution.timeZone },
  };
}

@Injectable()
export class AppointmentCalendarService {
  private readonly logger = new Logger(AppointmentCalendarService.name);
  constructor(private readonly prisma: PrismaService, private readonly calendar: GoogleCalendarAdapter, private readonly config: ConfigService) {}

  private async eligible(appointmentId: string, principal: AuthenticatedPrincipal): Promise<Record> {
    if (!await this.prisma.user.findFirst({ where: { id: principal.userId, status: UserStatus.ACTIVE, deletedAt: null }, select: { id: true } })) {
      throw new UnauthorizedException('Unauthorized');
    }
    const appointment = await this.prisma.appointment.findFirst({
      where: { id: appointmentId, userId: principal.userId, deletedAt: null }, select,
    });
    if (!appointment) throw new NotFoundException('Appointment not found');
    const slot = appointment.agendaSlot, availability = slot.availability;
    if (appointment.branch.institutionId !== appointment.institutionId || appointment.service.institutionId !== appointment.institutionId ||
      appointment.professional.institutionId !== appointment.institutionId || availability.branch.institutionId !== appointment.institutionId ||
      availability.branchId !== appointment.branchId || availability.serviceId !== appointment.serviceId ||
      availability.professionalId !== appointment.professionalId || availability.attentionPointId !== appointment.attentionPointId ||
      (appointment.attentionPoint && appointment.attentionPoint.branchId !== appointment.branchId)) throw new NotFoundException('Appointment not found');
    if (appointment.status.code !== 'AGENDADA' || !appointment.status.active || appointment.status.isFinal || slot.status !== SlotStatus.RESERVED ||
      !Number.isFinite(appointment.startsAt.getTime()) || !Number.isFinite(appointment.endsAt.getTime()) ||
      appointment.startsAt.getTime() <= Date.now() || appointment.endsAt <= appointment.startsAt ||
      appointment.startsAt.getTime() !== slot.startsAt.getTime() || appointment.endsAt.getTime() !== slot.endsAt.getTime()) {
      throw new ConflictException('Appointment cannot be exported');
    }
    try { new Intl.DateTimeFormat('en', { timeZone: appointment.institution.timeZone }); }
    catch { throw new ServiceUnavailableException('Institution time zone unavailable'); }
    return appointment;
  }

  async export(appointmentId: string, code: string, principal: AuthenticatedPrincipal, headers: AuthenticatedRequest['headers']) {
    this.calendar.assertEnabled();
    if (headers['x-requested-with'] !== 'XmlHttpRequest' || headers.origin !== this.config.get<string>('GOOGLE_CALENDAR_REDIRECT_URI')) {
      throw new ForbiddenException('Invalid Google Calendar popup request');
    }
    let appointment = await this.eligible(appointmentId, principal);
    const status = await this.calendar.insert(code, async () => {
      appointment = await this.eligible(appointmentId, principal);
      return buildCalendarEvent(appointment);
    });
    if (status === 'CREATED') {
      try {
        await AuditService.record(this.prisma, { institutionId: appointment.institutionId, branchId: appointment.branchId,
          actorUserId: principal.userId, actorType: 'USER', actionCode: 'GOOGLE_CALENDAR_EVENT_CREATED',
          resourceType: 'APPOINTMENT', resourceId: appointmentId, outcome: 'SUCCESS' });
      } catch { this.logger.warn('Google Calendar export audit unavailable'); }
    }
    return { data: { appointmentId, eventId: calendarEventId(appointmentId), status } };
  }
}
