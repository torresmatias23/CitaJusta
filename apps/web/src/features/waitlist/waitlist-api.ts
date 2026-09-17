import { ApiError, type ApiClient } from '../../lib/http-client.ts';
import { listData, record, textField, timestampField, uuidField } from '../../lib/response.ts';

type Named = { id: string; name: string };
export type WaitlistEntry = {
  id: string; status: string; enteredAt: string; service: Named; branch: Named | null;
};
export type WaitlistPreferences = {
  preferredDays: number[];
  timeRanges: { start: string; end: string }[];
  preferredBranchIds: string[];
  allowsOtherBranches: boolean;
  acceptsAnyProfessional: boolean;
};

function invalid(): never { throw new Error('Respuesta de lista de espera inválida.'); }
function named(value: unknown): Named {
  const item = record(value);
  return { id: uuidField(item.id), name: textField(item.name) };
}
function boolean(value: unknown): boolean { return typeof value === 'boolean' ? value : invalid(); }
function array(value: unknown): unknown[] { return Array.isArray(value) ? value : invalid(); }
function time(value: unknown): string {
  const result = textField(value);
  return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(result) ? result : invalid();
}
function entry(value: unknown): WaitlistEntry {
  const item = record(value);
  const status = textField(item.status);
  if (!status.trim()) return invalid();
  return { id: uuidField(item.id), status, enteredAt: timestampField(item.enteredAt),
    service: named(item.service), branch: item.branch === null ? null : named(item.branch) };
}
export function parsePreferences(value: unknown): WaitlistPreferences {
  const item = record(value);
  return {
    preferredDays: array(item.preferredDays).map((day) => typeof day === 'number' && Number.isInteger(day) && day >= 1 && day <= 7 ? day : invalid()),
    timeRanges: array(item.timeRanges).map((value) => {
      const range = record(value);
      return { start: time(range.start), end: time(range.end) };
    }),
    preferredBranchIds: array(item.preferredBranchIds).map(uuidField),
    allowsOtherBranches: boolean(item.allowsOtherBranches),
    acceptsAnyProfessional: boolean(item.acceptsAnyProfessional),
  };
}

export function createWaitlistApi(api: ApiClient) {
  return {
    async list(signal?: AbortSignal) {
      return listData(await api.request('waitlist', { ...(signal ? { signal } : {}) }), entry);
    },
    async enter(input: { serviceId: string; branchId?: string }, signal?: AbortSignal) {
      const body = { serviceId: uuidField(input.serviceId), ...(input.branchId ? { branchId: uuidField(input.branchId) } : {}) };
      return entry(record(await api.request('waitlist', { method: 'POST', body, retryAfterRefresh: false, ...(signal ? { signal } : {}) })).data);
    },
    async preferences(id: string, signal?: AbortSignal) {
      return parsePreferences(record(await api.request(`waitlist/${uuidField(id)}/preferences`, { ...(signal ? { signal } : {}) })).data);
    },
    async updatePreferences(id: string, input: WaitlistPreferences, signal?: AbortSignal) {
      return parsePreferences(record(await api.request(`waitlist/${uuidField(id)}/preferences`, {
        method: 'PUT', body: parsePreferences(input), retryAfterRefresh: false, ...(signal ? { signal } : {}),
      })).data);
    },
    async withdraw(id: string, signal?: AbortSignal) {
      const data = record(record(await api.request(`waitlist/${uuidField(id)}/withdraw`, {
        method: 'POST', retryAfterRefresh: false, ...(signal ? { signal } : {}),
      })).data);
      if (uuidField(data.id) !== id || data.status !== 'WITHDRAWN') return invalid();
      return { id, status: 'WITHDRAWN' as const };
    },
    async services(signal?: AbortSignal) {
      return listData(await api.request('services', { ...(signal ? { signal } : {}) }), (value) => ({
        ...named(value), institution: named(record(value).institution),
      }));
    },
    async branches(serviceId: string, signal?: AbortSignal) {
      const data = record(record(await api.request(`services/${uuidField(serviceId)}`, { ...(signal ? { signal } : {}) })).data);
      return array(data.branches).map(named);
    },
  };
}

export function waitlistErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 400) return 'Revisa los datos: días, horarios sin superposición y sedes seleccionadas.';
    if (error.status === 401) return 'Revisa tu sesión. Si fue renovada, actualiza los datos antes de intentar nuevamente.';
    if (error.status === 403) return 'No tienes autorización para esta operación.';
    if (error.status === 404) return 'El recurso solicitado no está disponible para tu cuenta.';
    if (error.status === 409) return 'La operación entra en conflicto con el estado actual. Actualiza la lista antes de continuar; puede existir una espera para este servicio o no admitir nuevas entradas.';
    if (error.status === 503) return 'La lista de espera no está disponible por ahora. Inténtalo más tarde.';
  }
  return 'No pudimos verificar el resultado. Actualiza los datos antes de repetir una operación.';
}
