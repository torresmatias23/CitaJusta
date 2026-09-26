import { profile as agendaProfile, appointment, branch, service, institutionId, catalogResponse } from './agenda.mjs';
export { branch, service, institutionId, catalogResponse };
export const profile = { ...agendaProfile, permissions: ['availability.read', 'availability.create', 'availability.update', 'availability.block'] };
export const availability = { id: appointment.id, date: '2035-01-15', startTime: '09:00', endTime: '10:00', timeZone: 'America/Bogota',
  active: true, capacity: 1, origin: 'MANUAL', branch: appointment.branch, service: appointment.service, professional: appointment.professional,
  attentionPoint: null, createdAt: '2026-09-26T10:00:00.000Z', updatedAt: '2026-09-26T10:00:00.000Z' };
export const block = { id: appointment.id, branch: appointment.branch, professional: null, attentionPoint: null, type: 'MANUAL', reason: null,
  startsAt: '2035-01-15T14:00:00.000Z', endsAt: '2035-01-15T15:00:00.000Z', createdAt: '2026-09-26T10:00:00.000Z' };
export const input = { branchId: branch.id, serviceId: service.id, professionalId: appointment.professional.id, date: availability.date, startTime: '09:00', endTime: '10:00' };
export function response(path) {
  if (path === 'availability/administration') return { data: [availability] };
  if (path === 'availability/blocks/administration') return { data: [block] };
  if (path === `branches/${branch.id}/services/${service.id}/professionals`) return { data: [{ ...appointment.professional, institution: { id: institutionId } }] };
  return catalogResponse(path);
}
