import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';

const bookingInputSchema = z.object({ agendaSlotId: z.string().uuid() }).strict();

export function parseBookingInput(body: unknown) {
  const result = bookingInputSchema.safeParse(body);
  if (!result.success) throw new BadRequestException('Invalid appointment input');
  return result.data;
}
