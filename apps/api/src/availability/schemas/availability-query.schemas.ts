import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';
import { availabilityQueryLimits } from '../availability-query.limits.js';

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
  .refine(isValidAvailabilityRange);

export interface AvailabilityRange {
  from: Date;
  to: Date;
}

function isValidAvailabilityRange({ from, to }: AvailabilityRange): boolean {
  if (!(from instanceof Date) || !(to instanceof Date)) return false;
  const duration = to.getTime() - from.getTime();
  return Number.isFinite(duration) && duration > 0 && duration <= availabilityQueryLimits.maxRangeMs;
}

export function assertAvailabilityRange(range: AvailabilityRange): void {
  if (!isValidAvailabilityRange(range)) throw new BadRequestException('Invalid availability range');
}

export function parseAvailabilityRange(value: unknown): AvailabilityRange {
  const result = availabilityRangeSchema.safeParse(value);

  if (!result.success) {
    throw new BadRequestException('Invalid availability range');
  }

  return result.data;
}
