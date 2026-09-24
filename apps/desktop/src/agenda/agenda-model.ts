import type { ApiClient, UserProfile } from '@citajusta/client-core';
import { agendaError, canReadAgenda, createAgendaApi } from './agenda-api.ts';
import type { AgendaAppointment, AgendaFilters } from './agenda-api.ts';
import { createAgendaCatalogApi, mergeOptions } from './agenda-catalog-api.ts';
import type { AgendaCatalogs } from './agenda-catalog-api.ts';

export type AgendaState = {
  status: 'idle' | 'loading' | 'ready' | 'error' | 'denied'; filters: AgendaFilters; items: AgendaAppointment[]; error: string;
  catalogs: AgendaCatalogs; catalogStatus: 'loading' | 'ready' | 'error'; timeZone: string | null; zoneStatus: 'loading' | 'ready' | 'error';
};
export function createAgendaModel(api: ApiClient, user: UserProfile) {
  const allowed = canReadAgenda(user), client = createAgendaApi(api, user);
  const initial = (): AgendaState => ({ status: allowed ? 'idle' : 'denied', filters: { date: '', ...(user.context.branchId ? { branchId: user.context.branchId } : {}) },
    items: [], error: '', catalogs: { branches: [], services: [], professionals: [] }, catalogStatus: 'loading', timeZone: null, zoneStatus: 'loading' });
  let state = initial(), active = true, version = 0, catalogVersion = 0;
  let request = new AbortController(), catalogRequest = new AbortController();
  const listeners = new Set<() => void>();
  const update = (patch: Partial<AgendaState>) => { if (active) { state = { ...state, ...patch }; listeners.forEach(fn => fn()); } };
  function invalidate() { version++; request.abort(); }
  function withHistory(catalogs: AgendaCatalogs, items: AgendaAppointment[]): AgendaCatalogs {
    return { branches: mergeOptions(catalogs.branches, items.map(item => item.branch)), services: mergeOptions(catalogs.services, items.map(item => item.service)),
      professionals: mergeOptions(catalogs.professionals, items.map(item => ({ id: item.professional.id, name: `${item.professional.firstNames} ${item.professional.lastNames}` }))) };
  }
  async function loadCatalogs() {
    if (!active || !allowed) return;
    const revision = ++catalogVersion; catalogRequest.abort(); catalogRequest = new AbortController();
    const signal = catalogRequest.signal, current = () => active && revision === catalogVersion;
    update({ catalogStatus: 'loading', zoneStatus: 'loading' });
    const catalogs = createAgendaCatalogApi(api, user);
    await Promise.all([
      (async () => {
        try { const timeZone = await catalogs.timeZone(signal); if (current()) update({ timeZone, zoneStatus: 'ready' }); }
        catch { if (current()) update({ timeZone: null, zoneStatus: 'error' }); }
      })(),
      (async () => {
        try {
          const options = await catalogs.options(signal);
          if (current()) update({ catalogs: withHistory({ branches: mergeOptions(state.catalogs.branches, options.branches),
            services: mergeOptions(state.catalogs.services, options.services), professionals: mergeOptions(state.catalogs.professionals, options.professionals) }, state.items), catalogStatus: 'ready' });
        }
        catch { if (current()) update({ catalogStatus: 'error' }); }
      })(),
    ]);
  }
  return {
    branchContext: user.context.branchId,
    subscribe(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; },
    getSnapshot: () => state,
    activate() { active = true; return loadCatalogs(); },
    reloadCatalogs: loadCatalogs,
    dispose() { active = false; invalidate(); catalogVersion++; catalogRequest.abort(); state = initial(); },
    setFilters(patch: Partial<AgendaFilters>) {
      if (!active || !allowed) return;
      invalidate();
      update({ filters: { ...state.filters, ...patch, ...(user.context.branchId ? { branchId: user.context.branchId } : {}) }, status: 'idle', items: [], error: '' });
    },
    async consult() {
      if (!active || !allowed) return;
      invalidate(); request = new AbortController();
      const revision = version, current = () => active && version === revision;
      const filters = { ...state.filters };
      update({ status: 'loading', items: [], error: '' });
      try {
        const items = await client.find(filters, request.signal);
        if (current()) update({ status: 'ready', items, catalogs: withHistory(state.catalogs, items) });
      } catch (error) { if (current()) update({ status: 'error', items: [], error: agendaError(error) }); }
    },
  };
}
