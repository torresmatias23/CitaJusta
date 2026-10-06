import { ApiError } from '../../lib/http-client.ts';
import { googleClientId } from '../auth/google-identity.ts';
import { loadGoogleSdk } from '../auth/google-sdk.ts';
import type { AppointmentSummary } from './appointments-api.ts';

export const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.events.owned';
export function calendarClientId(enabled: unknown, clientId: unknown): string | undefined {
  return enabled === 'true' ? googleClientId(clientId) : undefined;
}
export function calendarEligible(appointment: Pick<AppointmentSummary, 'status' | 'startsAt' | 'endsAt'>, now = Date.now()): boolean {
  const start = Date.parse(appointment.startsAt), end = Date.parse(appointment.endsAt);
  return appointment.status === 'AGENDADA' && Number.isFinite(start) && Number.isFinite(end) && start > now && end > start;
}

export class CalendarAuthorizationError extends Error {
  readonly reason: 'cancelled' | 'denied' | 'unavailable';
  constructor(reason: CalendarAuthorizationError['reason']) { super('Google Calendar authorization failed'); this.reason = reason; }
}
export function calendarErrorMessage(error: unknown): string {
  if (error instanceof CalendarAuthorizationError) return error.reason === 'cancelled'
    ? 'No se agregó la cita: cerraste o cancelaste la autorización de Google.'
    : error.reason === 'denied' ? 'No autorizaste el permiso necesario de Google Calendar.'
      : 'No pudimos abrir Google Calendar. Revisa los permisos de ventanas emergentes o inténtalo más tarde.';
  if (error instanceof ApiError) {
    if (error.status === 401) return 'Tu sesión terminó. Vuelve a iniciar sesión antes de agregar la cita.';
    if (error.status === 404) return 'La cita no está disponible para tu cuenta.';
    if (error.status === 409) return 'La cita ya no es una reserva futura vigente. Actualiza Mis citas.';
    if (error.status === 400 || error.status === 403) return 'No se pudo validar la autorización de Google Calendar. Vuelve a autorizar el permiso.';
    if (error.status === 503 || error.status === 502) return 'Google Calendar no está disponible en este momento. Tu cita en CitaJusta se conserva.';
  }
  return 'No pudimos verificar la copia en Google Calendar. Tu cita en CitaJusta se conserva; puedes volver a autorizar e intentar.';
}

export interface CalendarOAuthApi {
  initCodeClient(options: {
    client_id: string; scope: string; ux_mode: 'popup'; include_granted_scopes: false;
    callback: (response: { code?: string; error?: string }) => void;
    error_callback: (error: { type?: string }) => void;
  }): { requestCode(): void };
}
export function createCalendarCodeClient(clientId: string, api: CalendarOAuthApi) {
  let pending: { resolve: (code: string) => void; reject: (error: unknown) => void } | undefined;
  let disposed = false;
  const client = api.initCodeClient({ client_id: clientId, scope: CALENDAR_SCOPE, ux_mode: 'popup', include_granted_scopes: false,
    callback: (response) => {
      const current = pending; pending = undefined;
      if (!current) return;
      if (response.error || !response.code) current.reject(new CalendarAuthorizationError('denied'));
      else current.resolve(response.code);
    },
    error_callback: (error) => {
      const current = pending; pending = undefined;
      current?.reject(new CalendarAuthorizationError(error.type === 'popup_closed' ? 'cancelled' : 'unavailable'));
    },
  });
  return {
    requestCode(): Promise<string> {
      if (disposed || pending) return Promise.reject(new CalendarAuthorizationError('unavailable'));
      return new Promise<string>((resolve, reject) => {
        pending = { resolve, reject };
        // Called synchronously from the explicit click after SDK preparation, preserving user activation.
        try { client.requestCode(); }
        catch { pending = undefined; reject(new CalendarAuthorizationError('unavailable')); }
      });
    },
    dispose() { disposed = true; pending?.reject(new CalendarAuthorizationError('cancelled')); pending = undefined; },
  };
}
export async function prepareCalendarCodeClient(clientId: string) {
  await loadGoogleSdk();
  const api = (window as Window & { google?: { accounts?: { oauth2?: CalendarOAuthApi } } }).google?.accounts?.oauth2;
  if (!api) throw new CalendarAuthorizationError('unavailable');
  return createCalendarCodeClient(clientId, api);
}
