import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { z } from 'zod';

const schema = z.object({
  date: z.string().date(),
  branchId: z.string().uuid().optional(),
  serviceId: z.string().uuid().optional(),
  professionalId: z.string().uuid().optional(),
  status: z.string().min(1).max(60).optional(),
}).strict();
export type AgendaQuery = z.infer<typeof schema>;

export function parseAgendaQuery(query: unknown, body: unknown): AgendaQuery {
  const parsed = schema.safeParse(query);
  if (!parsed.success || (body !== undefined && !z.object({}).strict().safeParse(body).success)) {
    throw new BadRequestException('Invalid agenda request');
  }
  return parsed.data;
}

// Same institutional IANA zone and Intl wall-date semantics as HU-014.
// Find actual day boundaries rather than assuming every local day has 24 hours.
export function institutionalDay(date: string, timeZone: string) {
  let formatter: Intl.DateTimeFormat;
  try { formatter = new Intl.DateTimeFormat('en-CA', { timeZone, era: 'short', year: 'numeric', month: '2-digit', day: '2-digit' }); }
  catch { throw new ServiceUnavailableException('Institution time zone unavailable'); }
  const localDate = (instant: number) => {
    const parts = Object.fromEntries(formatter.formatToParts(new Date(instant)).map((part) => [part.type, part.value]));
    const year = parts.era === 'BC' ? 1 - Number(parts.year) : Number(parts.year);
    return year * 10_000 + Number(parts.month) * 100 + Number(parts.day);
  };
  const anchor = Date.parse(`${date}T00:00:00Z`);
  const requestedDay = Number(date.replaceAll('-', ''));
  const boundary = (after: boolean) => {
    let low = anchor - 48 * 3_600_000;
    let high = anchor + 72 * 3_600_000;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      const day = localDate(middle);
      if (after ? day <= requestedDay : day < requestedDay) low = middle + 1;
      else high = middle;
    }
    return new Date(low);
  };
  return { gte: boundary(false), lt: boundary(true) };
}
