import { ApiError } from '@citajusta/client-core';
import type { ApiClient, UserProfile } from '@citajusta/client-core';
import { canReadAgenda, record, text, uuid } from '../agenda/agenda-api.ts';
import type { AgendaAppointment } from '../agenda/agenda-api.ts';
import { uuidPattern } from '../catalog/catalog-api.ts';

export type AttendanceStatus = 'ATENDIDA' | 'INASISTENCIA';
export type AttendanceResult = { id: string; status: { code: AttendanceStatus; name: string } };
export function attendancePermissions(user: UserProfile) {
  const read = canReadAgenda(user);
  return { read, record: read && user.permissions.includes('appointments.attendance') };
}
export function canRecordAttendance(user: UserProfile, appointment: AgendaAppointment): boolean {
  return attendancePermissions(user).record && appointment.status.code === 'AGENDADA'
    && (!user.context.branchId || user.context.branchId === appointment.branch.id);
}
export function attendanceError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 400) return 'Solicitud inválida. Revisa la cita y el resultado seleccionado.';
    if (error.status === 401) return 'Tu sesión no es válida. Inicia sesión nuevamente.';
    if (error.status === 403) return 'No tienes permiso para registrar asistencia en este contexto.';
    if (error.status === 404) return 'La cita o el contexto no está disponible.';
    if (error.status === 409) return 'La cita ya cambió, está en un estado final o existe un conflicto concurrente. Vuelve a consultar antes de reintentar.';
  }
  return 'No pudimos confirmar el registro. Vuelve a consultar antes de reintentar.';
}
export function createAttendanceApi(api: ApiClient, user: UserProfile) {
  const institutionContext = { institutionId: user.context.institutionId ?? '', ...(user.context.branchId ? { branchId: user.context.branchId } : {}) };
  return {
    async record(appointmentId: string, status: AttendanceStatus, signal: AbortSignal): Promise<AttendanceResult> {
      if (!attendancePermissions(user).record) throw new ApiError(403);
      if (!uuidPattern.test(appointmentId) || (status !== 'ATENDIDA' && status !== 'INASISTENCIA')) throw new ApiError(400);
      const row = record(record(await api.request(`appointments/${appointmentId}/attendance`, {
        method: 'POST', institutionContext, body: { status }, signal, retryAfterRefresh: false,
      })).data);
      const resultId = uuid(row.id), resultStatus = record(row.status);
      if (resultId !== appointmentId || resultStatus.code !== status) throw new Error('Respuesta inválida.');
      // Only retain the receipt needed to confirm the operation; GET /agenda refreshes the display.
      return { id: resultId, status: { code: status, name: text(resultStatus.name) } };
    },
  };
}
