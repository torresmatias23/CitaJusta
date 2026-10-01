import type { ApiClient, UserProfile } from '@citajusta/client-core';
import { createAgendaCatalogApi } from '../agenda/agenda-catalog-api.ts';
import type { AgendaCatalogs } from '../agenda/agenda-catalog-api.ts';
import { canReadReports, createReportsApi, reportsError } from './reports-api.ts';
import type { Indicators, ReportsFilters } from './reports-api.ts';

export type ReportsState = {
  status: 'idle' | 'loading' | 'ready' | 'error' | 'denied'; filters: ReportsFilters; data: Indicators | null; error: string;
  catalogs: AgendaCatalogs; catalogStatus: 'idle' | 'loading' | 'ready' | 'error'; branchContext: string | null;
};
export function createReportsModel(api: ApiClient, user: UserProfile) {
  const allowed = canReadReports(user), client = createReportsApi(api, user);
  const initial = (): ReportsState => ({ status: allowed ? 'idle' : 'denied', filters: { from: '', to: '' }, data: null, error: '',
    catalogs: { branches: [], services: [], professionals: [] }, catalogStatus: 'idle', branchContext: user.context.branchId ?? null });
  let state = initial(), active = true, revision = 0, catalogRevision = 0;
  let request = new AbortController(), catalogRequest = new AbortController();
  const listeners = new Set<() => void>();
  const update = (patch: Partial<ReportsState>) => { if (active) { state = { ...state, ...patch }; listeners.forEach(fn => fn()); } };
  const invalidate = () => { revision++; request.abort(); };
  return {
    subscribe(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; },
    getSnapshot: () => state,
    async activate() {
      active = true;
      if (!allowed || state.catalogStatus !== 'idle') return;
      const current = ++catalogRevision; catalogRequest = new AbortController(); update({ catalogStatus: 'loading' });
      try {
        const catalogs = await createAgendaCatalogApi(api, user).options(catalogRequest.signal);
        if (active && current === catalogRevision) update({ catalogs, catalogStatus: 'ready' });
      } catch { if (active && current === catalogRevision) update({ catalogStatus: 'error' }); }
    },
    dispose() { active = false; invalidate(); catalogRevision++; catalogRequest.abort(); state = initial(); },
    setFilter(key: keyof ReportsFilters, value: string) {
      if (!active || !allowed || (key === 'branchId' && state.branchContext)) return;
      invalidate(); update({ filters: { ...state.filters, [key]: value }, status: 'idle', data: null, error: '' });
    },
    async consult() {
      if (!active || !allowed || state.status === 'loading') return;
      invalidate(); request = new AbortController(); const current = revision;
      update({ status: 'loading', data: null, error: '' });
      try {
        const data = await client.find(state.filters, request.signal);
        if (active && current === revision) update({ status: 'ready', data });
      } catch (error) { if (active && current === revision) update({ status: 'error', error: reportsError(error), data: null }); }
    },
  };
}
