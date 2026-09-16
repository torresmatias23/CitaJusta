import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';

export const actions = [
  'AUTH_LOGIN_SUCCESS', 'AUTH_LOGIN_FAILURE', 'AUTH_LOGOUT',
  'APPOINTMENT_CREATED', 'APPOINTMENT_CANCELLED', 'ATTENDANCE_RECORDED', 'NO_SHOW_RECORDED',
  'OFFER_CREATED', 'OFFER_ACCEPTED', 'OFFER_REJECTED',
  'REASSIGNMENT_STARTED', 'REASSIGNMENT_COMPLETED', 'REASSIGNMENT_EXHAUSTED',
  'BRANCH_CREATED', 'BRANCH_UPDATED', 'SERVICE_CREATED', 'SERVICE_UPDATED',
  'PROFESSIONAL_CREATED', 'PROFESSIONAL_UPDATED', 'AVAILABILITY_CREATED', 'AVAILABILITY_UPDATED',
  'SCHEDULE_BLOCK_CREATED', 'REASSIGNMENT_POLICY_VERSION_CREATED',
] as const;
export const resources = ['AUTH', 'APPOINTMENT', 'OFFER', 'REASSIGNMENT', 'BRANCH', 'SERVICE', 'PROFESSIONAL', 'AVAILABILITY', 'SCHEDULE_BLOCK', 'REASSIGNMENT_POLICY'] as const;
const states = z.enum(['AGENDADA', 'CANCELADA', 'ATENDIDA', 'INASISTENCIA', 'PENDING', 'ACCEPTED', 'REJECTED', 'OFFERING', 'COMPLETED', 'EXHAUSTED', 'ACTIVE', 'INACTIVE']);
const nullableId = z.string().uuid().nullable().optional();
export const auditRecordSchema = z.object({
  institutionId: nullableId, branchId: nullableId, actorUserId: nullableId,
  actorType: z.enum(['USER', 'SYSTEM']), actionCode: z.enum(actions), resourceType: z.enum(resources), resourceId: nullableId,
  outcome: z.enum(['SUCCESS', 'FAILURE']), previousState: states.nullable().optional(), newState: states.nullable().optional(),
  reasonCode: z.enum(['INVALID_CREDENTIALS', 'NO_ELIGIBLE_CANDIDATES', 'CANDIDATES_EXHAUSTED_AFTER_REJECTION']).nullable().optional(),
}).strict().refine((value) => !value.branchId || !!value.institutionId);
export type AuditRecord = z.infer<typeof auditRecordSchema>;

const cursorSchema = z.object({ v: z.literal(1), at: z.string().datetime(), id: z.string().uuid() }).strict();
export function encodeCursor(event: { occurredAt: Date; id: string }) {
  return Buffer.from(JSON.stringify({ v: 1, at: event.occurredAt.toISOString(), id: event.id })).toString('base64url');
}
export function decodeCursor(value: string) {
  try {
    if (value.length > 300 || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error();
    const parsed = cursorSchema.parse(JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as unknown);
    const occurredAt = new Date(parsed.at);
    if (encodeCursor({ occurredAt, id: parsed.id }) !== value) throw new Error();
    return { occurredAt, id: parsed.id };
  } catch { throw new BadRequestException('Invalid audit cursor'); }
}
const querySchema = z.object({
  from: z.string().date().optional(), to: z.string().date().optional(),
  branchId: z.string().uuid().optional(), actorUserId: z.string().uuid().optional(),
  action: z.enum(actions).optional(), resourceType: z.enum(resources).optional(),
  cursor: z.string().min(1).max(300).optional(),
  limit: z.string().regex(/^[1-9][0-9]*$/).transform(Number).pipe(z.number().int().max(100)).optional().default(50),
}).strict().refine(({ from, to }) => !from || !to || from <= to);
export type AuditQuery = z.infer<typeof querySchema>;
export function parseAuditQuery(query: unknown, body: unknown): AuditQuery {
  const parsed = querySchema.safeParse(query);
  if (!parsed.success || (body !== undefined && !z.object({}).strict().safeParse(body).success)) throw new BadRequestException('Invalid audit query');
  if (parsed.data.cursor) decodeCursor(parsed.data.cursor);
  return parsed.data;
}
