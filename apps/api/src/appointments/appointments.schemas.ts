import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';

const bookingInputSchema = z.object({ agendaSlotId: z.string().uuid() }).strict();
const myAppointmentsInputSchema = z.object({}).strict();

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
