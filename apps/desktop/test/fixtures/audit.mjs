import { profile as base, branch, institutionId } from './catalog.mjs';
export { branch, institutionId };
export const profile = { ...base, permissions: ['audit.read'] };
export const eventId = 'a0000000-0000-4000-8000-000000000001';
export const actorId = 'a0000000-0000-4000-8000-000000000002';
export const resourceId = 'a0000000-0000-4000-8000-000000000003';
export function auditEvent(patch = {}) {
  return { id: eventId, institutionId, branchId: branch.id, actorUserId: actorId, actorType: 'USER',
    actionCode: 'APPOINTMENT_CANCELLED', resourceType: 'APPOINTMENT', resourceId, outcome: 'SUCCESS',
    previousState: 'AGENDADA', newState: 'CANCELADA', reasonCode: null, occurredAt: '2026-10-01T12:30:00.000Z', ...patch };
}
export function page(data = [auditEvent()], nextCursor = null) { return { data, page: { nextCursor } }; }
export function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
