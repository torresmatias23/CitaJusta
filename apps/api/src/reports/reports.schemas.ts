import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';

const schema = z.object({
  from: z.string().date(),
  to: z.string().date(),
  branchId: z.string().uuid().optional(),
  serviceId: z.string().uuid().optional(),
  professionalId: z.string().uuid().optional(),
}).strict().refine(({ from, to }) => {
  const days = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000 + 1;
  return days >= 1 && days <= 366;
});

export type ReportsQuery = z.infer<typeof schema>;

export function parseReportsQuery(query: unknown, body: unknown): ReportsQuery {
  const parsed = schema.safeParse(query);
  if (!parsed.success || (body !== undefined && !z.object({}).strict().safeParse(body).success)) {
    throw new BadRequestException('Invalid indicators request');
  }
  return parsed.data;
}
