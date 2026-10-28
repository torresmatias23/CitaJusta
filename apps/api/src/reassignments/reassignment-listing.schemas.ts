import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';

export const reassignmentStatuses = [
  'PENDING', 'EVALUATING', 'OFFERING', 'COMPLETED', 'EXHAUSTED', 'CANCELLED', 'FAILED',
] as const;

const cursorSchema = z.object({ v: z.literal(1), id: z.string().uuid() }).strict();

export function encodeReassignmentCursor(row: { id: string }) {
  return Buffer.from(JSON.stringify({ v: 1, id: row.id })).toString('base64url');
}

export function decodeReassignmentCursor(value: string) {
  try {
    if (value.length > 300 || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error();
    const parsed = cursorSchema.parse(JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as unknown);
    if (encodeReassignmentCursor({ id: parsed.id }) !== value) throw new Error();
    return { id: parsed.id };
  } catch {
    throw new BadRequestException('Invalid reassignment cursor');
  }
}

const querySchema = z.object({
  status: z.enum(reassignmentStatuses).optional(),
  cursor: z.string().min(1).max(300).optional(),
  limit: z.string().regex(/^[1-9][0-9]*$/).transform(Number).pipe(z.number().int().max(100)).optional().default(50),
}).strict();

export type ReassignmentListingQuery = z.infer<typeof querySchema>;

export function parseReassignmentListingQuery(query: unknown, body: unknown): ReassignmentListingQuery {
  const parsed = querySchema.safeParse(query);
  if (!parsed.success || (body !== undefined && !z.object({}).strict().safeParse(body).success)) {
    throw new BadRequestException('Invalid reassignment listing query');
  }
  if (parsed.data.cursor) decodeReassignmentCursor(parsed.data.cursor);
  return parsed.data;
}
