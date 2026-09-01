import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';

const institutionParamsSchema = z.object({
  institutionId: z.string().uuid(),
});

export function parseInstitutionParams(value: unknown): {
  institutionId: string;
} {
  const result = institutionParamsSchema.safeParse(value);

  if (!result.success) {
    throw new BadRequestException('Invalid institution id');
  }

  return result.data;
}
