import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';

type Resource = 'users' | 'waitlist';
const cursorSchema = z.object({
  v: z.literal(1), resource: z.enum(['users', 'waitlist']), id: z.string().uuid(),
}).strict();

export function encodeInstitutionalCursor(resource: Resource, id: string): string {
  return Buffer.from(JSON.stringify({ v: 1, resource, id })).toString('base64url');
}

export function decodeInstitutionalCursor(resource: Resource, value: string): { id: string } {
  try {
    if (value.length > 300 || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error();
    const parsed = cursorSchema.parse(JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as unknown);
    if (parsed.resource !== resource || encodeInstitutionalCursor(resource, parsed.id) !== value) throw new Error();
    return { id: parsed.id };
  } catch {
    throw new BadRequestException('Invalid institutional listing cursor');
  }
}

export function institutionalPageFields(resource: Resource) {
  return {
    branchId: z.string().uuid().optional(),
    limit: z.string().regex(/^[1-9][0-9]*$/).transform(Number)
      .pipe(z.number().int().max(100)).optional().default(50),
    cursor: z.string().min(1).max(300).transform(value => decodeInstitutionalCursor(resource, value)).optional(),
  };
}

export function parseInstitutionalListing<T>(schema: z.ZodType<T>, query: unknown, body: unknown): T {
  const parsed = schema.safeParse(query);
  if (!parsed.success || (body !== undefined && !z.object({}).strict().safeParse(body).success)) {
    throw new BadRequestException('Invalid institutional listing query');
  }
  return parsed.data;
}
