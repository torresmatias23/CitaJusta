import { ApiError, type ApiClient } from '../../lib/http-client.ts';
import { record, textField, timestampField, uuidField } from '../../lib/response.ts';

export const notificationTypes = ['APPOINTMENT_BOOKED', 'APPOINTMENT_CANCELLED', 'WAITLIST_ENTERED', 'WAITLIST_WITHDRAWN',
  'OFFER_CREATED', 'OFFER_ACCEPTED', 'OFFER_REJECTED', 'OFFER_EXPIRED'] as const;
export type Notification = { id: string; type: typeof notificationTypes[number]; title: string; message: string;
  createdAt: string; readAt: string | null; resourceType: 'APPOINTMENT' | 'WAITLIST_ENTRY' | 'OFFER';
  resourceId: string | null; path: '/mis-citas' | '/lista-de-espera' | '/ofertas' };
export type NotificationPage = { data: Notification[]; page: { nextCursor: string | null }; unreadCount: number };
function invalid(): never { throw new Error('Respuesta de notificaciones inválida.'); }
function count(value: unknown): number { return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : invalid(); }
export function parseNotification(value: unknown): Notification {
  const row = record(value); const type = notificationTypes.find((type) => type === row['type']);
  const resourceType = row['resourceType'], path = row['path'];
  if (!type || (resourceType !== 'APPOINTMENT' && resourceType !== 'WAITLIST_ENTRY' && resourceType !== 'OFFER') ||
      (path !== '/mis-citas' && path !== '/lista-de-espera' && path !== '/ofertas')) return invalid();
  return { id: uuidField(row['id']), type, title: textField(row['title']), message: textField(row['message']),
    createdAt: timestampField(row['createdAt']), readAt: row['readAt'] === null ? null : timestampField(row['readAt']),
    resourceType, resourceId: row['resourceId'] === null ? null : uuidField(row['resourceId']), path };
}
export function createNotificationsApi(api: ApiClient) {
  return {
    async list(cursor?: string, signal?: AbortSignal): Promise<NotificationPage> {
      const result = record(await api.request('notifications/me', { ...(signal ? { signal } : {}), ...(cursor ? { query: { cursor } } : {}) }));
      const page = record(result['page']); const next = page['nextCursor'];
      if (!Array.isArray(result['data']) || result['data'].length > 100 ||
          (next !== null && (typeof next !== 'string' || !/^[A-Za-z0-9_-]{1,300}$/.test(next)))) return invalid();
      return { data: result['data'].map(parseNotification), page: { nextCursor: next }, unreadCount: count(result['unreadCount']) };
    },
    async unreadCount(signal?: AbortSignal) {
      return count(record(record(await api.request('notifications/me/unread-count', signal ? { signal } : {}))['data'])['unreadCount']);
    },
    async read(id: string, signal?: AbortSignal) {
      uuidField(id);
      const row = record(record(await api.request(`notifications/${id}/read`, { method: 'POST', ...(signal ? { signal } : {}) }))['data']);
      if (uuidField(row['id']) !== id) return invalid();
      return { id, readAt: timestampField(row['readAt']) };
    },
  };
}
export function notificationError(error: unknown) {
  if (error instanceof ApiError && error.status === 401) return 'Tu sesión terminó. Inicia sesión nuevamente.';
  if (error instanceof ApiError && error.status === 404) return 'Esta notificación ya no está disponible.';
  return 'No pudimos actualizar las notificaciones. Intenta nuevamente.';
}
