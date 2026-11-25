import type { ApiClient, UserProfile } from '@citajusta/client-core';
import { createAgendaCatalogApi } from '../agenda/agenda-catalog-api.ts';
import type { AgendaCatalogs } from '../agenda/agenda-catalog-api.ts';
import { canReadReports, reportsError } from '../reports/reports-api.ts';
import type { ReportsFilters } from '../reports/reports-api.ts';
import { createDashboardApi } from './dashboard-api.ts';
import type { Dashboard } from './dashboard-api.ts';

export type DashboardPreset = '7' | '30' | '90' | 'month';
export const presets: { id: DashboardPreset; label: string }[] = [
  { id: '7', label: 'Últimos 7 días' }, { id: '30', label: 'Últimos 30 días' },
  { id: '90', label: 'Últimos 90 días' }, { id: 'month', label: 'Mes en curso' },
];
export type DashboardState = {
  status: 'idle' | 'loading' | 'ready' | 'error' | 'denied'; filters: ReportsFilters; preset: DashboardPreset | null;
  data: Dashboard | null; error: string; catalogs: AgendaCatalogs; catalogStatus: 'idle' | 'loading' | 'ready' | 'error'; branchContext: string | null;
};

const civil = (date: Date) => new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
// Inclusive civil range ending today on the workstation calendar; the API applies the institutional time zone.
export function presetRange(preset: DashboardPreset, today = new Date()): { from: string; to: string } {
  const to = civil(today);
  if (preset === 'month') return { from: `${to.slice(0, 8)}01`, to };
  const start = new Date(Date.parse(`${to}T00:00:00Z`) - (Number(preset) - 1) * 86_400_000);
  return { from: start.toISOString().slice(0, 10), to };
}

export function createDashboardModel(api: ApiClient, user: UserProfile, today: () => Date = () => new Date()) {
  const allowed = canReadReports(user), client = createDashboardApi(api, user);
  const initial = (): DashboardState => ({ status: allowed ? 'idle' : 'denied', filters: presetRange('30', today()), preset: '30', data: null, error: '',
    catalogs: { branches: [], services: [], professionals: [] }, catalogStatus: 'idle', branchContext: user.context.branchId ?? null });
  let state = initial(), active = true, revision = 0, catalogRevision = 0;
  let request = new AbortController(), catalogRequest = new AbortController();
  const listeners = new Set<() => void>();
  const update = (patch: Partial<DashboardState>) => { if (active) { state = { ...state, ...patch }; listeners.forEach(fn => fn()); } };
  const invalidate = () => { revision++; request.abort(); };
  const model = {
    subscribe(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; },
    getSnapshot: () => state,
    async activate() {
      active = true;
      if (!allowed || state.catalogStatus !== 'idle') return;
      // The panel opens with the default period already consulted.
      const first = model.consult();
      const current = ++catalogRevision; catalogRequest = new AbortController(); update({ catalogStatus: 'loading' });
      try {
        const catalogs = await createAgendaCatalogApi(api, user).options(catalogRequest.signal);
        if (active && current === catalogRevision) update({ catalogs, catalogStatus: 'ready' });
      } catch { if (active && current === catalogRevision) update({ catalogStatus: 'error' }); }
      await first;
    },
    dispose() { active = false; invalidate(); catalogRevision++; catalogRequest.abort(); state = initial(); },
    setFilter(key: keyof ReportsFilters, value: string) {
      if (!active || !allowed || (key === 'branchId' && state.branchContext)) return;
      invalidate(); update({ filters: { ...state.filters, [key]: value }, preset: key === 'from' || key === 'to' ? null : state.preset, status: 'idle', data: null, error: '' });
    },
    async applyPreset(preset: DashboardPreset) {
      if (!active || !allowed) return;
      invalidate(); update({ filters: { ...state.filters, ...presetRange(preset, today()) }, preset, status: 'idle', data: null, error: '' });
      await model.consult();
    },
    async consult() {
      if (!active || !allowed) return;
      invalidate(); request = new AbortController(); const current = revision;
      update({ status: 'loading', data: null, error: '' });
      try {
        const data = await client.find(state.filters, request.signal);
        if (active && current === revision) update({ status: 'ready', data });
      } catch (error) { if (active && current === revision) update({ status: 'error', error: reportsError(error), data: null }); }
    },
  };
  return model;
}
