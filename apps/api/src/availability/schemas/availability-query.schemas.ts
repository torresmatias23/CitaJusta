import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';

const timezoneSuffixPattern = /(?:Z|[+-]\d{2}:\d{2})$/;
const timestampSchema = z
  .string()
  .datetime({ offset: true })
  .refine((value) => timezoneSuffixPattern.test(value))
  .transform((value) => new Date(value));

const availabilityRangeSchema = z
  .object({
    from: timestampSchema,
    to: timestampSchema,
  })
  .refine(({ from, to }) => from < to);

export interface AvailabilityRange {
  from: Date;
  to: Date;
}

export function parseAvailabilityRange(value: unknown): AvailabilityRange {
  const result = availabilityRangeSchema.safeParse(value);

  if (!result.success) {
    throw new BadRequestException('Invalid availability range');
  }

  return result.data;
}
