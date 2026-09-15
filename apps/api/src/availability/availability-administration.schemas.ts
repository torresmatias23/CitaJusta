import { BadRequestException, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { z } from 'zod';
import type { AuthorizedRequest } from '../authorization/types/authorization-context.js';

const timestamp = z.string().datetime({ offset: true }).refine((value) => new Date(value).getTime() % 60_000 === 0);
export const createAvailabilitySchema = z.object({
  branchId: z.string().uuid(), professionalId: z.string().uuid(), serviceId: z.string().uuid(),
  attentionPointId: z.string().uuid().nullable().optional(), startsAt: timestamp, endsAt: timestamp,
}).strict();
export const updateAvailabilitySchema = z.object({
  startsAt: timestamp.optional(), endsAt: timestamp.optional(), active: z.boolean().optional(),
}).strict().refine((value) => Object.keys(value).length > 0)
  .refine((value) => (value.startsAt === undefined) === (value.endsAt === undefined))
  .refine((value) => value.startsAt !== undefined || value.active === false);
export const createBlockSchema = z.object({
  branchId: z.string().uuid(), professionalId: z.string().uuid().optional(), attentionPointId: z.string().uuid().optional(),
  startsAt: timestamp, endsAt: timestamp,
  type: z.enum(['VACATION', 'LEAVE', 'MEETING', 'MAINTENANCE', 'MANUAL', 'OTHER']).default('MANUAL'),
  reason: z.string().trim().min(1).max(2000).nullable().optional(),
}).strict();
export type CreateAvailabilityInput = z.infer<typeof createAvailabilitySchema>;
export type UpdateAvailabilityInput = z.infer<typeof updateAvailabilitySchema>;
export type CreateBlockInput = z.infer<typeof createBlockSchema>;

export function parseAdministrationInput<T>(schema: z.ZodType<T>, body: unknown, query: unknown): T {
  const parsed = schema.safeParse(body);
  if (!parsed.success || !z.object({}).strict().safeParse(query).success) throw new BadRequestException('Invalid availability request');
  return parsed.data;
}
export function administrationContext(request: AuthorizedRequest) {
  if (!request.principal || !request.authorization || request.principal.userId !== request.authorization.userId) throw new UnauthorizedException('Unauthorized');
  if (!request.authorization.institutionId) throw new BadRequestException('Institutional context required');
  return request.authorization;
}
export function parseAvailabilityId(params: unknown) {
  const parsed = z.object({ availabilityId: z.string().uuid() }).strict().safeParse(params);
  if (!parsed.success) throw new BadRequestException('Invalid availability id');
  return parsed.data.availabilityId;
}

export function futureInterval(startsAt: string, endsAt: string, now = new Date()) {
  const start = new Date(startsAt);
  const end = new Date(endsAt);
  if (!Number.isFinite(+start) || !Number.isFinite(+end) || start <= now || end <= start) throw new BadRequestException('Invalid future interval');
  return { start, end };
}

export function localWindow(start: Date, end: Date, timeZone: string) {
  let formatter: Intl.DateTimeFormat;
  try { formatter = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }); }
  catch { throw new ServiceUnavailableException('Institution time zone unavailable'); }
  const parts = (date: Date) => Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
  const a = parts(start); const b = parts(end);
  const dateText = `${a.year}-${a.month}-${a.day}`;
  const startMinutes = Number(a.hour) * 60 + Number(a.minute);
  const endMinutes = Number(b.hour) * 60 + Number(b.minute);
  if (dateText !== `${b.year}-${b.month}-${b.day}` || endMinutes <= startMinutes ||
      (endMinutes - startMinutes) * 60_000 !== +end - +start) {
    throw new BadRequestException('Availability must fit one institutional date without a time-zone transition');
  }
  return { date: new Date(`${dateText}T00:00:00Z`),
    startTime: new Date(Date.UTC(1970, 0, 1, Number(a.hour), Number(a.minute))),
    endTime: new Date(Date.UTC(1970, 0, 1, Number(b.hour), Number(b.minute))) };
}

export function slotIntervals(start: Date, end: Date, durationMinutes: number) {
  const step = durationMinutes * 60_000;
  const count = (+end - +start) / step;
  if (!Number.isInteger(durationMinutes) || durationMinutes <= 0 || !Number.isInteger(count) || count < 1 || count > 500) {
    throw new BadRequestException('Interval must contain 1 to 500 complete service slots');
  }
  return Array.from({ length: count }, (_, index) => ({ startsAt: new Date(+start + index * step), endsAt: new Date(+start + (index + 1) * step) }));
}

export function exceedsCapacity(intervals: Array<{ start: number; end: number }>, capacity: number) {
  const events = intervals.flatMap((interval) => [[interval.start, 1], [interval.end, -1]] as const)
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let concurrent = 0;
  for (const [, delta] of events) { concurrent += delta; if (concurrent > capacity) return true; }
  return false;
}
