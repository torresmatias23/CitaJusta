import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';

const bookingInputSchema = z.object({ agendaSlotId: z.string().uuid() }).strict();
const myAppointmentsInputSchema = z.object({}).strict();
const cancellationParamsSchema = z.object({ appointmentId: z.string().uuid() }).strict();
const emptyCancellationInputSchema = z.object({}).strict();

export function parseCalendarInput(params: unknown, query: unknown, body: unknown) {
  const ids = cancellationParamsSchema.safeParse(params);
  const input = z.object({ code: z.string().min(1).max(4096).regex(/^\S+$/) }).strict().safeParse(body);
  if (!ids.success || !input.success || !emptyCancellationInputSchema.safeParse(query).success) {
    throw new BadRequestException('Invalid Google Calendar input');
  }
  return { ...ids.data, ...input.data };
}

export function parseCancellationInput(params: unknown, query: unknown, body: unknown) {
  const result = cancellationParamsSchema.safeParse(params);
  if (
    !result.success ||
    !emptyCancellationInputSchema.safeParse(query).success ||
    !emptyCancellationInputSchema.optional().safeParse(body).success
  ) {
    throw new BadRequestException('Invalid appointment cancellation input');
  }
  return result.data;
}

export function parseMyAppointmentsInput(query: unknown, body: unknown) {
  if (
    !myAppointmentsInputSchema.safeParse(query).success ||
    !myAppointmentsInputSchema.optional().safeParse(body).success
  ) {
    throw new BadRequestException('Appointment listing does not accept filters or body fields');
  }
}

export function parseBookingInput(body: unknown) {
  const result = bookingInputSchema.safeParse(body);
  if (!result.success) throw new BadRequestException('Invalid appointment input');
  return result.data;
}
