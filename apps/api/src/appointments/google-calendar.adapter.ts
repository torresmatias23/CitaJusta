import { BadGatewayException, BadRequestException, ForbiddenException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OAuth2Client } from 'google-auth-library';
import { isGoogleCalendarOrigin } from '../config/environment.validation.js';

export const GOOGLE_CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.events.owned';
const TIMEOUT_MS = 10_000;
export type CalendarEvent = {
  id: string; summary: string; description: string; location?: string;
  start: { dateTime: string; timeZone: string }; end: { dateTime: string; timeZone: string };
};
export type CalendarExportStatus = 'CREATED' | 'ALREADY_EXISTS';

// Google accepts base32hex (0-9, a-v). Namespace and UUID hex use that alphabet.
export function calendarEventId(appointmentId: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(appointmentId)) throw new Error('Invalid appointment identifier');
  return `citajusta${appointmentId.replaceAll('-', '').toLowerCase()}`;
}

function providerStatus(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null || !('response' in error)) return undefined;
  const response = error.response;
  return typeof response === 'object' && response !== null && 'status' in response && typeof response.status === 'number' ? response.status : undefined;
}

@Injectable()
export class GoogleCalendarAdapter {
  constructor(private readonly config: ConfigService) {}

  assertEnabled(): void {
    if (this.config.get<boolean>('GOOGLE_CALENDAR_ENABLED') !== true ||
      !/^[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/.test(this.config.get<string>('GOOGLE_CLIENT_ID') ?? '') ||
      !this.config.get<string>('GOOGLE_CALENDAR_CLIENT_SECRET')?.trim() ||
      !isGoogleCalendarOrigin(this.config.get<string>('GOOGLE_CALENDAR_REDIRECT_URI') ?? '')) {
      throw new ServiceUnavailableException('Google Calendar unavailable');
    }
  }

  protected createOAuthClient(): OAuth2Client {
    // A fresh client per export: no credentials, token listeners or offline session retained.
    const client = new OAuth2Client({ clientId: this.config.getOrThrow<string>('GOOGLE_CLIENT_ID'),
      clientSecret: this.config.getOrThrow<string>('GOOGLE_CALENDAR_CLIENT_SECRET'),
      redirectUri: this.config.getOrThrow<string>('GOOGLE_CALENDAR_REDIRECT_URI') });
    client.transporter.interceptors.request.add({ resolved: async (options) => ({ ...options,
      timeout: TIMEOUT_MS, signal: AbortSignal.timeout(TIMEOUT_MS), retry: false }) });
    return client;
  }

  protected sendEvent(event: CalendarEvent, accessToken: string): Promise<Response> {
    return fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events?sendUpdates=none', {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' }, body: JSON.stringify(event),
    });
  }

  async insert(code: string, buildEvent: () => Promise<CalendarEvent>): Promise<CalendarExportStatus> {
    this.assertEnabled();
    const client = this.createOAuthClient();
    let accessToken: string;
    try {
      const { tokens } = await client.getToken({ code, redirect_uri: this.config.getOrThrow<string>('GOOGLE_CALENDAR_REDIRECT_URI') });
      if (!tokens.scope?.split(/\s+/).includes(GOOGLE_CALENDAR_SCOPE)) throw new ForbiddenException('Google Calendar permission required');
      if (!tokens.access_token) throw new BadGatewayException('Invalid Google Calendar authorization response');
      accessToken = tokens.access_token;
      // Never set client credentials, return tokens, or retain any refresh token.
    } catch (error: unknown) {
      if (error instanceof ForbiddenException || error instanceof BadGatewayException) throw error;
      const status = providerStatus(error);
      if (status === 400 || status === 401) throw new BadRequestException('Invalid Google Calendar authorization');
      if (status === 403) throw new ForbiddenException('Google Calendar authorization denied');
      throw new ServiceUnavailableException('Google Calendar authorization unavailable');
    }
    // Revalidate ownership/status after code exchange, with no DB transaction across HTTP.
    const event = await buildEvent();
    let response: Response;
    try {
      response = await this.sendEvent(event, accessToken);
    } catch { throw new ServiceUnavailableException('Google Calendar unavailable'); }
    // Discard the provider body: the response contract contains only our deterministic ID.
    await response.body?.cancel().catch(() => undefined);
    if (response.status === 409) return 'ALREADY_EXISTS';
    if (response.ok) return 'CREATED';
    if (response.status === 401 || response.status === 403) throw new ForbiddenException('Google Calendar permission denied');
    if (response.status === 429 || response.status >= 500) throw new ServiceUnavailableException('Google Calendar unavailable');
    throw new BadGatewayException('Google Calendar rejected the event');
  }
}
