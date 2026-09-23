import type { ApiClient, UserProfile } from '@citajusta/client-core';
import { createCatalogApi } from '../catalog/catalog-api.ts';
import type { Branch, Service } from '../catalog/catalog-api.ts';
import { createProfessionalApi, professionalError, professionalPermissions } from './professional-api.ts';
import type { EligibleUser, Professional, ProfessionalInput } from './professional-api.ts';

export type ProfessionalState = { status: 'loading' | 'ready' | 'error' | 'denied'; items: Professional[];
  branches: Branch[]; services: Service[]; catalogStatus: 'loading' | 'ready' | 'error' | 'denied';
  eligible: EligibleUser | null; searching: boolean; searchError: string; busy: boolean; feedback: string; failed: boolean; error: string };
export function createProfessionalModel(api: ApiClient, user: UserProfile) {
  const permissions = professionalPermissions(user);
  const client = createProfessionalApi(api, user), catalogs = createCatalogApi(api, user);
  const initial = (): ProfessionalState => ({ status: permissions.read ? 'loading' : 'denied', items: [], branches: [], services: [],
    catalogStatus: permissions.catalogs ? 'loading' : 'denied', eligible: null, searching: false, searchError: '', busy: false, feedback: '', failed: false, error: '' });
  let state = initial(), active = true, version = 0, searchVersion = 0;
  let controller = new AbortController(), searchController = new AbortController();
  const listeners = new Set<() => void>();
  const update = (patch: Partial<ProfessionalState>) => { if (active) { state = { ...state, ...patch }; listeners.forEach(fn => fn()); } };
  function clearEligible() { searchVersion++; searchController.abort(); update({ eligible: null, searching: false, searchError: '' }); }
  async function load() {
    if (!active || !permissions.read) return;
    const revision = ++version;
    const current = () => active && revision === version;
    update({ status: 'loading', items: [], error: '' });
    await Promise.all([
      (async () => {
        try { const items = await client.list(controller.signal); if (current()) update({ items, status: 'ready' }); }
        catch (error) { if (current()) update({ status: 'error', error: professionalError(error) }); }
      })(),
      (async () => {
        if (!permissions.catalogs) return;
        update({ catalogStatus: 'loading', branches: [], services: [] });
        try {
          const [branches, services] = await Promise.all([catalogs.branches(controller.signal), catalogs.services(controller.signal)]);
          if (current()) update({ branches, services, catalogStatus: 'ready' });
        } catch { if (current()) update({ catalogStatus: 'error' }); }
      })(),
    ]);
  }
  return {
    permissions,
    subscribe(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; },
    getSnapshot: () => state,
    activate() { active = true; controller = new AbortController(); return load(); },
    reload: load,
    dispose() { active = false; version++; clearEligible(); controller.abort(); state = initial(); },
    clearEligible,
    async search(email: string) {
      if (!active || !permissions.create || state.busy) return;
      clearEligible();
      const revision = searchVersion;
      searchController = new AbortController();
      update({ searching: true });
      try {
        const eligible = await client.eligible(email, searchController.signal);
        if (active && revision === searchVersion) update({ eligible, searching: false });
      } catch (error) { if (active && revision === searchVersion) update({ searching: false, searchError: professionalError(error) }); }
    },
    async save(id: string | undefined, input: ProfessionalInput) {
      if (!active || state.busy || state.catalogStatus !== 'ready' || !(id ? permissions.update : permissions.create) || (!id && !state.eligible)) return false;
      const signal = controller.signal;
      const userId = id ? state.items.find(item => item.id === id)?.user.id : state.eligible?.id;
      if (!userId) return false;
      update({ busy: true, feedback: '', failed: false });
      try {
        await client.save(id, input, userId, signal);
        if (!active || signal.aborted) return false;
        clearEligible(); update({ feedback: 'Profesional guardado.' });
        await load(); return true;
      } catch (error) { if (!signal.aborted) update({ feedback: professionalError(error), failed: true }); return false; }
      finally { if (!signal.aborted) update({ busy: false }); }
    },
  };
}
