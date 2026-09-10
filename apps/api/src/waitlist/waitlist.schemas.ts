import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';

const emptyInput = z.object({}).strict();
const entryInput = z.object({
  serviceId: z.string().uuid(),
  branchId: z.string().uuid().optional(),
}).strict();

export function parseWaitlistEntry(body: unknown, query: unknown) {
  const result = entryInput.safeParse(body);
  if (!result.success || !emptyInput.safeParse(query).success) {
    throw new BadRequestException('Invalid waitlist input');
  }
  return result.data;
}

export function parseWaitlistListing(query: unknown, body: unknown) {
  if (!emptyInput.safeParse(query).success || !emptyInput.optional().safeParse(body).success) {
    throw new BadRequestException('Waitlist listing does not accept filters or body fields');
  }
}
