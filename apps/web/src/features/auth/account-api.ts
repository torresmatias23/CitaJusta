import { ApiError, type ApiClient } from '../../lib/http-client';
import { record, textField, uuidField } from '../../lib/response';

export type PersonalDetails = { firstName: string; lastName: string; phone: string | null };
export type EmailPreferences = { appointmentEmailsEnabled: boolean; offerEmailsEnabled: boolean };
export type AccountProfile = PersonalDetails & { id: string; email: string; status: 'ACTIVE'; notificationPreferences: EmailPreferences };
function bounded(value: unknown, max: number): string {
  const result = textField(value);
  if (!result.trim() || result.length > max) throw new Error('Perfil inválido.');
  return result;
}
function personal(value: unknown): PersonalDetails {
  const row = record(value);
  return { firstName: bounded(row.firstName, 120), lastName: bounded(row.lastName, 120), phone: row.phone === null ? null : bounded(row.phone, 30) };
}
function preferences(value: unknown): EmailPreferences {
  const row = record(value);
  if (typeof row.appointmentEmailsEnabled !== 'boolean' || typeof row.offerEmailsEnabled !== 'boolean') throw new Error('Preferencias inválidas.');
  return { appointmentEmailsEnabled: row.appointmentEmailsEnabled, offerEmailsEnabled: row.offerEmailsEnabled };
}
export function createAccountApi(api: ApiClient) {
  return {
    async find(signal: AbortSignal): Promise<AccountProfile> {
      const row = record(record(await api.request('users/me', { signal })).data);
      if (row.status !== 'ACTIVE') throw new Error('Estado de cuenta inválido.');
      const email = bounded(row.email, 254); if (!email.includes('@')) throw new Error('Correo inválido.');
      return { ...personal(row), id: uuidField(row.id), email, status: 'ACTIVE', notificationPreferences: preferences(row.notificationPreferences) };
    },
    async updateProfile(input: PersonalDetails, signal: AbortSignal): Promise<PersonalDetails> {
      return personal(record(await api.request('users/me', { method: 'PATCH', body: { firstName: input.firstName, lastName: input.lastName, phone: input.phone }, signal, retryAfterRefresh: false })).data);
    },
    async updatePreferences(input: EmailPreferences, signal: AbortSignal): Promise<EmailPreferences> {
      return preferences(record(await api.request('users/me/notification-preferences', { method: 'PUT', body: {
        appointmentEmailsEnabled: input.appointmentEmailsEnabled, offerEmailsEnabled: input.offerEmailsEnabled }, signal, retryAfterRefresh: false })).data);
    },
  };
}
export function accountError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 400) return 'Revisa los datos: nombres de hasta 120 caracteres y teléfono de hasta 30.';
    if (error.status === 401) return 'Tu sesión terminó. Inicia sesión nuevamente.';
    if (error.status === 409) return 'Hubo una actualización simultánea. Revisa los datos y vuelve a guardar.';
    if (error.status === 503) return 'La cuenta no está disponible temporalmente. Intenta más tarde.';
  }
  return 'No pudimos completar la operación. Revisa tu conexión e intenta nuevamente.';
}
