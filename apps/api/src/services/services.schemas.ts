import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';

const branchParamsSchema = z.object({
  branchId: z.string().uuid(),
});

const serviceParamsSchema = z.object({
  serviceId: z.string().uuid(),
});

export function parseBranchParams(value: unknown): { branchId: string } {
  const result = branchParamsSchema.safeParse(value);

  if (!result.success) {
    throw new BadRequestException('Invalid branch id');
  }

  return result.data;
}

export function parseServiceParams(value: unknown): { serviceId: string } {
  const result = serviceParamsSchema.safeParse(value);

  if (!result.success) {
    throw new BadRequestException('Invalid service id');
  }

  return result.data;
}
