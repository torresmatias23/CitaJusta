import type { ApiClient, UserProfile } from '@citajusta/client-core';
import { createAgendaCatalogApi } from '../agenda/agenda-catalog-api.ts';
import type { AgendaCatalogs } from '../agenda/agenda-catalog-api.ts';
import { list, named, record, text, uuid } from '../agenda/agenda-api.ts';
import type { Named } from '../agenda/agenda-api.ts';
import { availabilityError, availabilityPermissions, createAvailabilityAdministrationApi } from './availability-api.ts';
import type { Availability, Block, Filters, CreateInput, BlockInput, IntervalInput } from './availability-api.ts';

export type AvailabilityState = { filters: Filters; status: 'idle' | 'loading' | 'ready' | 'error' | 'denied'; items: Availability[]; blocks: Block[];
  catalogs: AgendaCatalogs; catalogStatus: 'loading' | 'ready' | 'error'; timeZone: string | null; error: string;
  choices: { services: Named[]; professionals: Named[]; branchProfessionals: Named[] }; choicesStatus: 'idle' | 'loading' | 'ready' | 'error';
  busy: boolean; feedback: string; failed: boolean };
export function createAvailabilityModel(api: ApiClient, user: UserProfile) {
  const client = createAvailabilityAdministrationApi(api, user), catalogs = createAgendaCatalogApi(api, user), permissions = availabilityPermissions(user);
  const initial = (): AvailabilityState => ({ filters: { date: '', branchId: user.context.branchId ?? '' }, status: permissions.read ? 'idle' : 'denied', items: [], blocks: [],
    catalogs: { branches: [], services: [], professionals: [] }, catalogStatus: 'loading', timeZone: null, error: '',
    choices: { services: [], professionals: [], branchProfessionals: [] }, choicesStatus: 'idle', busy: false, feedback: '', failed: false });
  let state = initial(), active = true, revision = 0, catalogRevision = 0, choiceRevision = 0;
  let readController = new AbortController(), lifeController = new AbortController(), choiceController = new AbortController();
  const listeners = new Set<() => void>();
  const update = (patch: Partial<AvailabilityState>) => { if (active) { state = { ...state, ...patch }; listeners.forEach(fn => fn()); } };
  function invalidateRead() { revision++; readController.abort(); readController = new AbortController(); }
  async function consult() {
    if (!active || !permissions.read) return;
    invalidateRead(); const currentRevision = revision, signal = readController.signal;
    update({ status: 'loading', items: [], blocks: [], error: '' });
    try {
      const [items, blocks] = await Promise.all([client.find(state.filters, signal), client.blocks(state.filters, signal)]);
      if (active && revision === currentRevision) update({ status: 'ready', items, blocks });
    } catch (error) { if (active && revision === currentRevision) update({ status: 'error', error: availabilityError(error) }); }
  }
  async function loadCatalogs() {
    const version = ++catalogRevision, signal = lifeController.signal;
    update({ catalogStatus: 'loading', timeZone: null });
    try {
      const [options, timeZone] = await Promise.all([catalogs.options(signal), catalogs.timeZone(signal)]);
      if (active && version === catalogRevision) update({ catalogs: options, timeZone, catalogStatus: 'ready' });
    } catch { if (active && version === catalogRevision) update({ catalogStatus: 'error' }); }
  }
  async function write(action: (signal: AbortSignal) => Promise<unknown>) {
    if (!active || state.busy) return false;
    const signal = lifeController.signal;
    update({ busy: true, feedback: '', failed: false });
    try {
      const result = await action(signal);
      if (!active || signal.aborted) return false;
      if (result === false) { update({ feedback: 'No hay cambios para guardar.' }); return false; }
      update({ feedback: 'Operación guardada.' });
      if (permissions.read && state.filters.date) await consult();
      return true;
    } catch (error) { if (active && !signal.aborted) update({ feedback: availabilityError(error), failed: true }); return false; }
    finally { if (active && !signal.aborted) update({ busy: false }); }
  }
  return {
    permissions, branchContext: user.context.branchId,
    subscribe(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; }, getSnapshot: () => state,
    activate() { active = true; lifeController = new AbortController(); return loadCatalogs(); },
    dispose() { active = false; invalidateRead(); catalogRevision++; choiceRevision++; lifeController.abort(); choiceController.abort(); state = initial(); },
    loadCatalogs, consult,
    setFilters(patch: Partial<Filters>) { invalidateRead(); update({ filters: { ...state.filters, ...patch, ...(user.context.branchId ? { branchId: user.context.branchId } : {}) }, items: [], blocks: [], status: permissions.read ? 'idle' : 'denied', error: '' }); },
    async choose(branchId: string, serviceId?: string) {
      const version = ++choiceRevision; choiceController.abort(); choiceController = new AbortController();
      const signal = choiceController.signal;
      update({ choicesStatus: branchId ? 'loading' : 'idle', choices: { services: [], professionals: [], branchProfessionals: [] } });
      if (!branchId) return;
      try {
        uuid(branchId); if (user.context.branchId && branchId !== user.context.branchId) throw new Error('Contexto inválido');
        if (serviceId) uuid(serviceId);
        const own = (value: unknown) => { const row = record(value); if (uuid(record(row.institution).id) !== user.context.institutionId) throw new Error('Contexto inválido'); return row; };
        const decodeProfessional = (value: unknown) => { const row = own(value); return { id: uuid(row.id), name: `${text(row.firstNames)} ${text(row.lastNames)}` }; };
        const [services, branchProfessionals, professionals] = await Promise.all([
          api.request(`branches/${branchId}/services`, { signal }).then(value => list(value, v => named(own(v)))),
          api.request(`branches/${branchId}/professionals`, { signal }).then(value => list(value, decodeProfessional)),
          serviceId ? api.request(`branches/${branchId}/services/${serviceId}/professionals`, { signal }).then(value => list(value, decodeProfessional)) : Promise.resolve([]),
        ]);
        if (active && version === choiceRevision) update({ choicesStatus: 'ready', choices: { services, branchProfessionals, professionals } });
      } catch { if (active && version === choiceRevision) update({ choicesStatus: 'error' }); }
    },
    create(input: CreateInput) { const zone = state.timeZone; return zone && state.catalogStatus === 'ready' ? write(signal => client.create(input, zone, signal)) : Promise.resolve(false); },
    update(original: Availability, input: IntervalInput, reactivate: boolean) { const zone = state.timeZone; return zone ? write(signal => client.update(original, input, zone, signal, reactivate)) : Promise.resolve(false); },
    deactivate(original: Availability) { return write(signal => client.deactivate(original, signal)); },
    block(input: BlockInput) { const zone = state.timeZone; return zone && state.catalogStatus === 'ready' ? write(signal => client.block(input, zone, signal)) : Promise.resolve(false); },
  };
}
