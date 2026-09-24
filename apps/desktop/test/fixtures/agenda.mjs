import { profile as catalogProfile, branch, service, institutionId } from './catalog.mjs';
export { branch, service, institutionId };
export const profile = { ...catalogProfile, permissions: ['agenda.read'] };
export const appointment = {
  id: '20000000-0000-4000-8000-000000000001', startsAt: '2026-09-24T13:00:00.000Z', endsAt: '2026-09-24T13:30:00.000Z', origin: 'WEB',
  status: { code: 'AGENDADA', name: 'Agendada' }, branch: { id: branch.id, name: branch.name }, service: { id: service.id, name: service.name },
  professional: { id: '20000000-0000-4000-8000-000000000002', firstNames: 'Persona', lastNames: 'Profesional', titleOrFunction: 'Atención general' },
  user: { id: '20000000-0000-4000-8000-000000000003', firstNames: 'Usuario', lastNames: 'Atendido' },
};
export function catalogResponse(path) {
  if (path === `institutions/${institutionId}`) return { data: { id: institutionId, name: 'Institución', timeZone: 'America/Bogota' } };
  if (path === `institutions/${institutionId}/branches`) return { data: [{ id: branch.id, institutionId, name: branch.name }] };
  if (path === `branches/${branch.id}/services`) return { data: [{ ...appointment.service, institution: { id: institutionId } }] };
  if (path === `branches/${branch.id}/professionals`) return { data: [{ ...appointment.professional, institution: { id: institutionId } }] };
  throw new Error('Unexpected route');
}
export function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
