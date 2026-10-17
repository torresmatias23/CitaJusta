import { BadGatewayException, BadRequestException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { z } from 'zod';

const TIMEOUT_MS = 5000;
const MAX_RESPONSE_BYTES = 256 * 1024;
const yearSchema = z.number().int().min(1900).max(2100);
const holidaySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((date) => {
    const parsed = new Date(`${date}T00:00:00Z`);
    return Number.isFinite(+parsed) && parsed.toISOString().slice(0, 10) === date;
  }),
  name: z.string().trim().min(1).max(180),
  countryCode: z.literal('CL'),
  nationalHoliday: z.boolean(),
  subdivisionCodes: z.array(z.string().regex(/^CL-[A-Z0-9]{1,3}$/)).max(32).nullable(),
  holidayTypes: z.array(z.enum(['Public', 'Bank', 'School', 'Authorities', 'Optional', 'Observance'])).min(1).max(6),
}).refine((holiday) => holiday.nationalHoliday
  ? !holiday.subdivisionCodes?.length
  : Boolean(holiday.subdivisionCodes?.length));
const responseSchema = z.array(holidaySchema).min(1).max(500);

// Civil dates and provider classifications, not institutional closure instructions.
export type ChileHoliday = z.infer<typeof holidaySchema>;

function invalidResponse(): BadGatewayException {
  return new BadGatewayException('Invalid holiday provider response');
}

async function readBody(response: Response): Promise<string> {
  if (!response.body) throw invalidResponse();
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let size = 0;
  let text = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) throw invalidResponse();
      try { text += decoder.decode(value, { stream: true }); }
      catch { throw invalidResponse(); }
    }
    try { return text + decoder.decode(); }
    catch { throw invalidResponse(); }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

@Injectable()
export class NagerDateHolidaysAdapter {
  protected request(year: number, signal: AbortSignal): Promise<Response> {
    return fetch(`https://nagerholidays.com/api/v4/Holidays/CL/${year}`, {
      method: 'GET', headers: { accept: 'application/json' }, redirect: 'error', signal,
    });
  }

  async findByYear(year: number): Promise<ChileHoliday[]> {
    if (!yearSchema.safeParse(year).success) throw new BadRequestException('Holiday year must be an integer between 1900 and 2100');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      let response: Response;
      try { response = await this.request(year, controller.signal); }
      catch { throw new ServiceUnavailableException('Holiday provider unavailable'); }
      if (!response.ok) {
        void response.body?.cancel().catch(() => undefined);
        if ([408, 429].includes(response.status) || response.status >= 500) {
          throw new ServiceUnavailableException('Holiday provider unavailable');
        }
        throw new BadGatewayException('Holiday provider rejected the query');
      }
      if (!/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') ?? '')) {
        void response.body?.cancel().catch(() => undefined);
        throw invalidResponse();
      }
      let body: unknown;
      try { body = JSON.parse(await readBody(response)); }
      catch (error) {
        if (controller.signal.aborted) throw new ServiceUnavailableException('Holiday provider unavailable');
        if (error instanceof BadGatewayException) throw error;
        if (error instanceof SyntaxError) throw invalidResponse();
        throw new ServiceUnavailableException('Holiday provider unavailable');
      }
      const parsed = responseSchema.safeParse(body);
      if (!parsed.success || parsed.data.some((holiday) => !holiday.date.startsWith(`${year}-`))) throw invalidResponse();
      const unique = new Map<string, ChileHoliday>();
      for (const holiday of parsed.data) {
        const normalized = { ...holiday,
          subdivisionCodes: holiday.subdivisionCodes === null ? null : [...new Set(holiday.subdivisionCodes)].sort(),
          holidayTypes: [...new Set(holiday.holidayTypes)].sort(),
        };
        unique.set(JSON.stringify(normalized), normalized);
      }
      // Stable order and exact-record deduplication; distinct events on one date remain distinct.
      return [...unique].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([, holiday]) => holiday);
    } finally {
      clearTimeout(timer);
    }
  }
}
