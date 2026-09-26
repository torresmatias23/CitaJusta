import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';

export const blockQuerySchema = z.object({ date: z.string().date(), branchId: z.string().uuid().optional(), professionalId: z.string().uuid().optional() }).strict();
export const availabilityQuerySchema = blockQuerySchema.extend({ serviceId: z.string().uuid().optional() });
export type AvailabilityQuery = z.infer<typeof availabilityQuerySchema>;
export type BlockQuery = z.infer<typeof blockQuerySchema>;
export function parseReadQuery<T>(schema: z.ZodType<T>, query: unknown, body: unknown): T {
  const parsed = schema.safeParse(query);
  if (!parsed.success || (body !== undefined && !z.object({}).strict().safeParse(body).success)) throw new BadRequestException('Invalid query');
  return parsed.data;
}
