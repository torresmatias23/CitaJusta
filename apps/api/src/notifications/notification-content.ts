import { z } from 'zod';

const empty = z.object({}).strict();
const appointment = z.object({ startsAt: z.string().datetime() }).strict();
export const notificationContentSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('APPOINTMENT_BOOKED'), data: appointment }),
  z.object({ type: z.literal('APPOINTMENT_CANCELLED'), data: appointment }),
  z.object({ type: z.literal('WAITLIST_ENTERED'), data: empty }),
  z.object({ type: z.literal('WAITLIST_WITHDRAWN'), data: empty }),
  z.object({ type: z.literal('OFFER_CREATED'), data: appointment.extend({ expiresAt: z.string().datetime() }).strict() }),
  z.object({ type: z.literal('OFFER_ACCEPTED'), data: appointment }),
  z.object({ type: z.literal('OFFER_REJECTED'), data: empty }),
  z.object({ type: z.literal('OFFER_EXPIRED'), data: empty }),
]);
export type NotificationContent = z.infer<typeof notificationContentSchema>;
const date = (value: string, timeZone: string) =>`${new Intl.DateTimeFormat('es-CL', {dateStyle: 'medium',timeStyle: 'short',timeZone,}).format(new Date(value))} (${timeZone})`;

// Internal content is also reusable by future channel adapters; no external delivery here.
export function notificationContent(value: unknown, timeZone = 'UTC') {
  const item = notificationContentSchema.parse(value);
  switch (item.type) {
    case 'APPOINTMENT_BOOKED': return { title: 'Reserva registrada', message: `Tu reserva para ${date(item.data.startsAt, timeZone)} quedó agendada.`, path: '/mis-citas' };
    case 'APPOINTMENT_CANCELLED': return { title: 'Cita cancelada', message: `Se canceló tu reserva para ${date(item.data.startsAt, timeZone)}.`, path: '/mis-citas' };
    case 'WAITLIST_ENTERED': return { title: 'Ingreso a lista de espera', message: 'Tu solicitud fue registrada. Revisa tus preferencias para recibir ofertas compatibles.', path: '/lista-de-espera' };
    case 'WAITLIST_WITHDRAWN': return { title: 'Retiro de lista de espera', message: 'Tu solicitud fue retirada de la lista de espera.', path: '/lista-de-espera' };
    case 'OFFER_CREATED': return { title: 'Recibiste una oferta', message: `Se ofreció una hora para ${date(item.data.startsAt, timeZone)}, con plazo hasta ${date(item.data.expiresAt, timeZone)}. Consulta su estado actual en Ofertas.`, path: '/ofertas' };
    case 'OFFER_ACCEPTED': return { title: 'Oferta aceptada', message: `Tu hora para ${date(item.data.startsAt, timeZone)} quedó agendada.`, path: '/mis-citas' };
    case 'OFFER_REJECTED': return { title: 'Oferta rechazada', message: 'Tu rechazo de la oferta quedó registrado.', path: '/ofertas' };
    case 'OFFER_EXPIRED': return { title: 'Oferta vencida', message: 'Finalizó el plazo para responder a esta oferta.', path: '/ofertas' };
  }
}
