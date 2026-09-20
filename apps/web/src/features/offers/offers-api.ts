import { ApiError, type ApiClient } from '../../lib/http-client.ts';
import { listData, record, textField, timestampField, uuidField } from '../../lib/response.ts';

export const offerStatuses = ['PENDING', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'INVALIDATED', 'CANCELLED'] as const;
export type OfferStatus = typeof offerStatuses[number];
export type Offer = {
  id: string; status: OfferStatus; createdAt: string; expiresAt: string; respondedAt: string | null;
  startsAt: string; endsAt: string;
  service: { id: string; name: string };
  branch: { id: string; name: string };
  professional: { id: string; firstNames: string; lastNames: string };
};

function invalid(): never { throw new Error('Respuesta de ofertas inválida.'); }
function statusField(value: unknown): OfferStatus {
  const status = offerStatuses.find((status) => status === value);
  return status ?? invalid();
}
function named(value: unknown) {
  const item = record(value);
  return { id: uuidField(item['id']), name: textField(item['name']) };
}
function interval(item: Record<string, unknown>) {
  const startsAt = timestampField(item['startsAt']); const endsAt = timestampField(item['endsAt']);
  if (Date.parse(endsAt) <= Date.parse(startsAt)) return invalid();
  return { startsAt, endsAt };
}
export function parseOffer(value: unknown): Offer {
  const item = record(value); const professional = record(item['professional']);
  const createdAt = timestampField(item['createdAt']); const expiresAt = timestampField(item['expiresAt']);
  if (Date.parse(expiresAt) <= Date.parse(createdAt)) return invalid();
  return {
    id: uuidField(item['id']), status: statusField(item['status']), createdAt, expiresAt,
    respondedAt: item['respondedAt'] === null ? null : timestampField(item['respondedAt']),
    ...interval(item), service: named(item['service']), branch: named(item['branch']),
    professional: { id: uuidField(professional['id']), firstNames: textField(professional['firstNames']), lastNames: textField(professional['lastNames']) },
  };
}
function ownResolution(value: unknown, id: string, expected: 'ACCEPTED' | 'REJECTED') {
  const offer = record(value);
  if (uuidField(offer['id']) !== id || offer['status'] !== expected) return invalid();
  return { id, status: expected, respondedAt: timestampField(offer['respondedAt']) };
}

export function createOffersApi(api: ApiClient) {
  return {
    async list(signal?: AbortSignal): Promise<Offer[]> {
      return listData(await api.request('reassignments/offers/me', signal ? { signal } : {}), parseOffer);
    },
    async accept(offerId: string, signal?: AbortSignal) {
      const id = uuidField(offerId);
      const data = record(record(await api.request(`reassignments/offers/${id}/accept`, {
        method: 'POST', retryAfterRefresh: false, ...(signal ? { signal } : {}),
      }))['data']);
      const offer = ownResolution(data['offer'], id, 'ACCEPTED');
      const appointment = record(data['appointment']);
      if (appointment['status'] !== 'AGENDADA') return invalid();
      return { offer, appointment: { id: uuidField(appointment['id']), status: 'AGENDADA' as const, ...interval(appointment) } };
    },
    async reject(offerId: string, signal?: AbortSignal) {
      const id = uuidField(offerId);
      const data = record(record(await api.request(`reassignments/offers/${id}/reject`, {
        method: 'POST', retryAfterRefresh: false, ...(signal ? { signal } : {}),
      }))['data']);
      // nextOffer is process information and may belong to another recipient: never retain it.
      return { offer: ownResolution(data['offer'], id, 'REJECTED') };
    },
  };
}

export function canRespondToOffer(offer: Offer, now: number): boolean {
  return offer.status === 'PENDING' && now < Date.parse(offer.expiresAt);
}

export function offerErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 400) return 'La solicitud no es válida. Actualiza tus ofertas.';
    if (error.status === 401) return 'Vuelve a iniciar sesión o actualiza tus ofertas antes de responder otra vez.';
    if (error.status === 403) return 'No tienes acceso a esta oferta.';
    if (error.status === 404) return 'La oferta no está disponible para tu cuenta.';
    if (error.status === 409) return 'La oferta venció o cambió. Actualiza la lista para consultar su estado.';
    if (error.status === 503) return 'El servicio no está disponible por ahora. Inténtalo más tarde.';
  }
  return 'No pudimos verificar el resultado. Actualiza tus ofertas y consulta Mis citas antes de repetir una acción.';
}
