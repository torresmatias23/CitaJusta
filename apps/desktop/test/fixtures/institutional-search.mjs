import { profile as base, branch, institutionId, service } from './catalog.mjs';
export { branch, institutionId, service };
export { deferred } from './audit.mjs';
export const userId = '20000000-0000-4000-8000-000000000001';
export const entryId = '20000000-0000-4000-8000-000000000002';
export const otherId = '20000000-0000-4000-8000-000000000003';
export const profile = { ...base, permissions: ['users.read', 'waitlist.read'] };
export const person = (patch = {}) => ({ id: userId, firstNames: 'Ana', lastNames: 'Prueba', ...patch });
export const waiting = (patch = {}) => ({ id: entryId, enteredAt: '2026-11-01T12:30:00.000Z', status: { code: 'ACTIVE', name: 'Activa' },
  user: person(), service: { id: service.id, name: service.name }, branch: { id: branch.id, name: branch.name }, ...patch });
export const page = (resource, data = [resource === 'users' ? person() : waiting()], nextCursor = null) => ({ data, page: { nextCursor } });
