import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';

const professionalParamsSchema = z.object({
  professionalId: z.string().uuid(),
});

export function parseProfessionalParams(value: unknown): {
  professionalId: string;
} {
  const result = professionalParamsSchema.safeParse(value);

  if (!result.success) {
    throw new BadRequestException('Invalid professional id');
  }

  return result.data;
}
