export interface SearchSelection { institutionId: string; branchId: string; serviceId: string; days: string }
export const initialSelection: SearchSelection = { institutionId: '', branchId: '', serviceId: '', days: '7' };

export function changeSelection(current: SearchSelection, field: keyof SearchSelection, value: string): SearchSelection {
  if (field === 'institutionId') return { ...current, institutionId: value, branchId: '', serviceId: '' };
  if (field === 'branchId') return { ...current, branchId: value, serviceId: '' };
  return { ...current, [field]: value };
}

export function searchParameters(selection: SearchSelection, now = new Date()): URLSearchParams {
  const days = ['7', '14', '30'].includes(selection.days) ? Number(selection.days) : 7;
  return new URLSearchParams({
    institutionId: selection.institutionId,
    branchId: selection.branchId,
    serviceId: selection.serviceId,
    from: now.toISOString(),
    to: new Date(now.getTime() + days * 86_400_000).toISOString(),
  });
}
