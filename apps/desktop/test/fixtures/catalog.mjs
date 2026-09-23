export const institutionId = '10000000-0000-4000-8000-000000000001';
export const branch = { id: '10000000-0000-4000-8000-000000000002', code: 'CENTRO', name: 'Sede centro',
  addressLine1: 'Calle principal', addressLine2: null, municipality: 'Santiago', region: 'Metropolitana', country: 'Chile',
  latitude: '-33.1234567', longitude: null, phone: '1234', email: 'contact@example.invalid', status: 'INACTIVE' };
export const category = { id: '10000000-0000-4000-8000-000000000003', name: 'General' };
export const service = { id: '10000000-0000-4000-8000-000000000004', code: 'ATENCION', name: 'Atención',
  description: 'Servicio institucional', categoryId: category.id, durationMinutes: 30, minimumAdvanceMinutes: 0,
  maximumAdvanceDays: null, allowsWaitlist: true, requiresConfirmation: false, active: false, branchIds: [branch.id] };
export const profile = { id: '10000000-0000-4000-8000-000000000005', firstName: 'Ana', lastName: 'Prueba',
  email: 'controlled@example.invalid', status: 'ACTIVE', context: { institutionId }, roles: [],
  permissions: ['branches.read', 'services.read', 'branches.create', 'branches.update', 'services.create', 'services.update'] };
export function catalogResponse(path) {
  if (path === 'branches/administration') return { data: [branch] };
  if (path === 'services/administration') return { data: [service] };
  if (path === 'services/categories') return { data: [category] };
  throw new Error('Unexpected route');
}
