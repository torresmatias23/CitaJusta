import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';
import { notificationContentSchema, type NotificationContent } from './notification-content.js';

const uuid = z.string().uuid();
const envelope = z.object({
  recipientUserId: uuid, institutionId: uuid.nullable(), branchId: uuid.nullable(),
  resourceType: z.enum(['APPOINTMENT', 'WAITLIST_ENTRY', 'OFFER']), resourceId: uuid.nullable(),
  dedupeKey: z.string().max(140), type: z.string(), data: z.unknown(),
}).strict().refine((value) => !value.branchId || !!value.institutionId);
export type NotificationInput = Omit<z.infer<typeof envelope>, 'type' | 'data'> & NotificationContent;
export function parseNotification(input: NotificationInput) {
  const base = envelope.parse(input); const content = notificationContentSchema.parse(base);
  const expectedResource = content.type.startsWith('APPOINTMENT_') ? 'APPOINTMENT' : content.type.startsWith('WAITLIST_') ? 'WAITLIST_ENTRY' : 'OFFER';
  const sourceId = base.dedupeKey.slice(content.type.length + 1);
  if (!base.dedupeKey.startsWith(`${content.type}:`) || !uuid.safeParse(sourceId).success || base.resourceType !== expectedResource ||
      (content.type !== 'APPOINTMENT_CANCELLED' && sourceId !== base.resourceId)) throw new Error('Invalid notification event identity');
  return { ...base, ...content };
}

const cursorSchema = z.object({ v: z.literal(1), at: z.string().datetime(), id: uuid }).strict();
export function encodeNotificationCursor(row: { id: string; createdAt: Date }) {
  return Buffer.from(JSON.stringify({ v: 1, at: row.createdAt.toISOString(), id: row.id })).toString('base64url');
}
export function decodeNotificationCursor(value: string) {
  try {
    if (value.length > 300 || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error();
    const parsed = cursorSchema.parse(JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as unknown);
    const result = { id: parsed.id, createdAt: new Date(parsed.at) };
    if (encodeNotificationCursor(result) !== value) throw new Error();
    return result;
  } catch { throw new BadRequestException('Invalid notification cursor'); }
}
const querySchema = z.object({ cursor: z.string().min(1).max(300).optional(),
  limit: z.string().regex(/^[1-9][0-9]*$/).transform(Number).pipe(z.number().int().max(100)).optional().default(50),
}).strict();
export type NotificationQuery = z.infer<typeof querySchema>;
export function emptyInput(value: unknown) {
  if (value !== undefined && !z.object({}).strict().safeParse(value).success) throw new BadRequestException('Invalid notification request');
}
export function parseNotificationQuery(value: unknown): NotificationQuery {
  const result = querySchema.safeParse(value);
  if (!result.success) throw new BadRequestException('Invalid notification query');
  if (result.data.cursor) decodeNotificationCursor(result.data.cursor);
  return result.data;
}
export function parseNotificationId(value: unknown) {
  const parsed = z.object({ notificationId: uuid }).strict().safeParse(value);
  if (!parsed.success) throw new BadRequestException('Invalid notification id');
  return parsed.data.notificationId;
}
