import { branch, service, profile as base } from './catalog.mjs';
export { branch, service };
export const account = { id: '10000000-0000-4000-8000-000000000008', email: 'professional@example.test', firstNames: 'Ana', lastNames: 'Profesional' };
export const professional = { id: '10000000-0000-4000-8000-000000000009', user: account, internalCode: 'PRO-1', titleOrFunction: 'Atención', description: null,
  status: 'ACTIVE', createdAt: '2026-09-23T12:00:00.000Z', updatedAt: '2026-09-23T12:00:00.000Z', branchIds: [branch.id], serviceIds: [service.id] };
export const profile = { ...base, permissions: ['professionals.read', 'professionals.create', 'professionals.update', 'branches.read', 'services.read'] };
export const writeResult = () => { const { user, ...rest } = professional; return { data: { ...rest, userId: user.id } }; };
export function response(path, options = {}) {
  if (options.method) return writeResult();
  if (path === 'professionals/administration') return { data: [professional] };
  if (path === 'professionals/eligible-users') return { data: account };
  if (path === 'branches/administration') return { data: [branch] };
  if (path === 'services/administration') return { data: [service] };
  throw new Error('Unexpected path');
}
