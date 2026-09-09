import { ApiError, type ApiClient } from '../../lib/http-client.ts';

export type AppointmentSummary = {
  id: string;
  institutionId: string;
  status: string;
  startsAt: string;
  endsAt: string;
  origin: string;
  branch: { id: string; name: string };
  service: { id: string; name: string };
  professional: { id: string; firstNames: string; lastNames: string };
};

export type BookingResponse = {
  id: string;
  agendaSlotId: string;
  institutionId: string;
  branchId: string;
  serviceId: string;
  professionalId: string;
  startsAt: string;
  endsAt: string;
  status: string;
  origin: string;
};

function invalidResponse(): never {
  throw new Error('La respuesta de citas no tiene el formato esperado.');
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown> : invalidResponse();
}

function text(value: unknown): string {
  return typeof value === 'string' && value.trim().length > 0 ? value : invalidResponse();
}

function date(value: unknown): string {
  const result = text(value);
  return /^\d{4}-\d{2}-\d{2}T/.test(result) && Number.isFinite(Date.parse(result)) ? result : invalidResponse();
}

export function isAppointmentId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function id(value: unknown): string {
  const result = text(value);
  return isAppointmentId(result) ? result : invalidResponse();
}

export function parseAppointment(value: unknown): AppointmentSummary {
  const item = record(value);
  const branch = record(item.branch);
  const service = record(item.service);
  const professional = record(item.professional);
  return {
    id: id(item.id), institutionId: id(item.institutionId), status: text(item.status),
    startsAt: date(item.startsAt), endsAt: date(item.endsAt), origin: text(item.origin),
    branch: { id: id(branch.id), name: text(branch.name) },
    service: { id: id(service.id), name: text(service.name) },
    professional: { id: id(professional.id), firstNames: text(professional.firstNames), lastNames: text(professional.lastNames) },
  };
}

function parseBooking(value: unknown): BookingResponse {
  const item = record(value);
  return {
    id: id(item.id), agendaSlotId: id(item.agendaSlotId), institutionId: id(item.institutionId),
    branchId: id(item.branchId), serviceId: id(item.serviceId), professionalId: id(item.professionalId),
    startsAt: date(item.startsAt), endsAt: date(item.endsAt), status: text(item.status), origin: text(item.origin),
  };
}

export function createAppointmentsApi(client: ApiClient) {
  return {
    async list(signal?: AbortSignal): Promise<AppointmentSummary[]> {
      const response = record(await client.request('appointments/me', signal ? { signal } : {}));
      if (!Array.isArray(response.data)) return invalidResponse();
      return response.data.map(parseAppointment);
    },
    async reserve(agendaSlotId: string, signal?: AbortSignal): Promise<BookingResponse> {
      if (!isAppointmentId(agendaSlotId)) throw new Error('Identificador de cupo inválido.');
      const response = record(await client.request('appointments', {
        method: 'POST', body: { agendaSlotId }, ...(signal ? { signal } : {}),
      }));
      return parseBooking(response.data);
    },
    async cancel(appointmentId: string, signal?: AbortSignal): Promise<AppointmentSummary> {
      if (!isAppointmentId(appointmentId)) throw new Error('Identificador de cita inválido.');
      const response = record(await client.request(`appointments/${appointmentId}/cancel`, {
        method: 'POST', ...(signal ? { signal } : {}),
      }));
      const appointment = parseAppointment(response.data);
      if (appointment.id !== appointmentId) return invalidResponse();
      return appointment;
    },
  };
}

export function appointmentErrorMessage(error: unknown, action: 'list' | 'reserve' | 'cancel'): string {
  if (error instanceof ApiError) {
    if (error.status === 400) return 'Revisa los datos de la solicitud y vuelve a intentarlo.';
    if (error.status === 401) return 'Tu sesión terminó. Vuelve a iniciar sesión.';
    if (error.status === 403) return 'No tienes acceso a esta atención.';
    if (error.status === 404) return action === 'reserve' ? 'Este cupo ya no está disponible.' : 'La cita no está disponible para tu cuenta.';
    if (error.status === 409) return action === 'reserve'
      ? 'El cupo cambió o ya fue reservado. Actualiza los resultados para elegir otra hora.'
      : 'La cita cambió y no se pudo cancelar. Actualiza tus citas para consultar su estado.';
    if (error.status === 503) return 'El servicio de citas no está disponible por ahora. Inténtalo más tarde.';
  }
  return action === 'list'
    ? 'No pudimos cargar tus citas. Revisa tu conexión e inténtalo de nuevo.'
    : 'No pudimos verificar el resultado. Consulta Mis citas antes de repetir la operación.';
}

// Doble clic: el bloqueo se adquiere sin esperar un render ni reenviar la escritura.
export function createSubmissionLock() {
  let busy = false;
  return {
    async run<T>(operation: () => Promise<T>): Promise<T | undefined> {
      if (busy) return undefined;
      busy = true;
      try { return await operation(); } finally { busy = false; }
    },
  };
}
