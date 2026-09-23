import type { ApiClient, UserProfile } from '@citajusta/client-core';
import { catalogError, catalogPermissions, createCatalogApi } from './catalog-api.ts';
import type { Branch, BranchInput, Category, Service, ServiceInput } from './catalog-api.ts';

export type Resource<T> = { status: 'loading' | 'ready' | 'error' | 'denied'; items: T[]; error?: string };
export type CatalogState = { branches: Resource<Branch>; services: Resource<Service>; categories: Category[];
  busy: boolean; feedback: string; failed: boolean };
export function createCatalogModel(api: ApiClient, user: UserProfile) {
  const permissions = catalogPermissions(user);
  const client = createCatalogApi(api, user);
  const initial = (): CatalogState => ({ branches: { status: permissions.branches ? 'loading' : 'denied', items: [] },
    services: { status: permissions.services ? 'loading' : 'denied', items: [] }, categories: [], busy: false, feedback: '', failed: false });
  let state = initial();
  let active = true;
  let controller = new AbortController();
  let loadVersion = 0;
  const listeners = new Set<() => void>();
  const update = (next: Partial<CatalogState>) => { if (active) { state = { ...state, ...next }; listeners.forEach((fn) => fn()); } };
  async function load() {
    if (!active) return;
    const version = ++loadVersion;
    const current = () => active && version === loadVersion;
    await Promise.all([
      (async () => {
        if (!permissions.branches) return;
        update({ branches: { status: 'loading', items: [] } });
        try {
          const items = await client.branches(controller.signal);
          if (current()) update({ branches: { status: 'ready', items } });
        } catch (error) { if (current()) update({ branches: { status: 'error', items: [], error: catalogError(error) } }); }
      })(),
      (async () => {
        if (!permissions.services) return;
        update({ services: { status: 'loading', items: [] }, categories: [] });
        try {
          const [items, categories] = await Promise.all([client.services(controller.signal), client.categories(controller.signal)]);
          if (current()) update({ services: { status: 'ready', items }, categories });
        } catch (error) { if (current()) update({ services: { status: 'error', items: [], error: catalogError(error) } }); }
      })(),
    ]);
  }
  async function save(allowed: boolean, write: () => Promise<unknown>) {
    if (!active || state.busy || !allowed) return false;
    const signal = controller.signal;
    update({ busy: true, feedback: '', failed: false });
    try {
      await write();
      if (signal.aborted || !active) return false;
      update({ feedback: 'Cambios guardados.' });
      await load();
      return true;
    } catch (error) {
      if (!signal.aborted) update({ feedback: catalogError(error), failed: true });
      return false;
    } finally { if (!signal.aborted) update({ busy: false }); }
  }
  return {
    permissions,
    subscribe(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; },
    getSnapshot: () => state,
    activate() { active = true; controller = new AbortController(); return load(); },
    reload: load,
    dispose() { active = false; loadVersion++; controller.abort(); state = initial(); },
    saveBranch: (id: string | undefined, data: Partial<BranchInput>) => save(id ? permissions.updateBranch : permissions.createBranch,
      () => client.saveBranch(id, data, controller.signal)),
    saveService: (id: string | undefined, data: Partial<ServiceInput>) => save(id ? permissions.updateService : permissions.createService,
      () => client.saveService(id, data, controller.signal)),
  };
}
