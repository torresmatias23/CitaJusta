export interface SearchSelection {
  institutionId: string;
  branchId: string;
  serviceId: string;
  mode: 'flexible' | 'specific';
  days: string;
  date: string;
}
export const initialSelection: SearchSelection = {
  institutionId: '', branchId: '', serviceId: '', mode: 'flexible', days: '7', date: '',
};

export function changeSelection(current: SearchSelection, field: keyof SearchSelection, value: string): SearchSelection {
  if (field === 'institutionId') return { ...current, institutionId: value, branchId: '', serviceId: '' };
  if (field === 'branchId') return { ...current, branchId: value, serviceId: '' };
  if (field === 'mode') {
    if (value !== 'flexible' && value !== 'specific') return current;
    return { ...current, mode: value, date: value === current.mode ? current.date : '' };
  }
  return { ...current, [field]: value };
}

export function localDateValue(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function searchParameters(selection: SearchSelection, now = new Date()): URLSearchParams | null {
  if (!Number.isFinite(now.getTime())) return null;
  let from = now;
  let to: Date;

  if (selection.mode === 'specific') {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(selection.date);
    if (!match) return null;
    const year = Number(match[1]);
    const month = Number(match[2]) - 1;
    const day = Number(match[3]);
    const start = new Date(year, month, day);
    if (start.getFullYear() !== year || start.getMonth() !== month || start.getDate() !== day) return null;
    const today = localDateValue(now);
    if (selection.date < today) return null;
    from = selection.date === today ? now : start;
    // Calendar arithmetic preserves local midnight across DST and month/year boundaries.
    to = new Date(year, month, day + 1);
  } else if (selection.mode === 'flexible') {
    if (!['7', '14', '30'].includes(selection.days)) return null;
    to = new Date(now.getTime() + Number(selection.days) * 86_400_000);
  } else {
    return null;
  }
  if (!Number.isFinite(to.getTime()) || to <= from) return null;
  return new URLSearchParams({
    institutionId: selection.institutionId,
    branchId: selection.branchId,
    serviceId: selection.serviceId,
    from: from.toISOString(),
    to: to.toISOString(),
  });
}
