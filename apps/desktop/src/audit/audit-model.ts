import type { ApiClient, UserProfile } from '@citajusta/client-core';
import { createAgendaCatalogApi } from '../agenda/agenda-catalog-api.ts';
import type { Named } from '../agenda/agenda-api.ts';
import { canReadAudit, createAuditApi, auditError } from './audit-api.ts';
import type { AuditEvent, AuditFilters } from './audit-api.ts';

export type AuditState = {
  status: 'idle' | 'loading' | 'ready' | 'error' | 'denied'; filters: AuditFilters; data: AuditEvent[]; nextCursor: string | null;
  error: string; loadingMore: boolean; moreError: string; branchContext: string | null;
  branches: Named[]; catalogStatus: 'idle' | 'loading' | 'ready' | 'error';
};
export function createAuditModel(api: ApiClient, user: UserProfile) {
  const allowed = canReadAudit(user), client = createAuditApi(api, user);
  const initial = (): AuditState => ({ status: allowed ? 'idle' : 'denied', filters: {}, data: [], nextCursor: null,
    error: '', loadingMore: false, moreError: '', branchContext: user.context.branchId ?? null, branches: [], catalogStatus: 'idle' });
  let state = initial(), active = true, revision = 0, catalogRevision = 0;
  let request = new AbortController(), catalogRequest = new AbortController();
  const listeners = new Set<() => void>();
  const update = (patch: Partial<AuditState>) => { if (active) { state = { ...state, ...patch }; listeners.forEach(fn => fn()); } };
  const invalidate = () => { revision++; request.abort(); };
  return {
    subscribe(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; },
    getSnapshot: () => state,
    async activate() {
      active = true;
      if (!allowed || state.branchContext || state.catalogStatus !== 'idle') return;
      const current = ++catalogRevision; catalogRequest = new AbortController(); update({ catalogStatus: 'loading' });
      try {
        const branches = await createAgendaCatalogApi(api, user).branches(catalogRequest.signal);
        if (active && current === catalogRevision) update({ branches, catalogStatus: 'ready' });
      } catch { if (active && current === catalogRevision) update({ catalogStatus: 'error' }); }
    },
    dispose() { active = false; invalidate(); catalogRevision++; catalogRequest.abort(); state = initial(); },
    setFilter(key: keyof AuditFilters, value: string) {
      if (!active || !allowed || (key === 'branchId' && state.branchContext)) return;
      invalidate(); update({ filters: { ...state.filters, [key]: value }, status: 'idle', data: [], nextCursor: null, error: '', loadingMore: false, moreError: '' });
    },
    async consult() {
      if (!active || !allowed || state.status === 'loading' || state.loadingMore) return;
      invalidate(); request = new AbortController(); const current = revision, filters = { ...state.filters };
      update({ status: 'loading', data: [], nextCursor: null, error: '', moreError: '' });
      try {
        const page = await client.find(filters, request.signal);
        if (active && current === revision) update({ status: 'ready', data: [...new Map(page.data.map(row => [row.id, row])).values()], nextCursor: page.nextCursor });
      } catch (error) { if (active && current === revision) update({ status: 'error', error: auditError(error) }); }
    },
    async loadMore() {
      if (!active || !allowed || state.status !== 'ready' || state.loadingMore || !state.nextCursor) return;
      invalidate(); request = new AbortController(); const current = revision, cursor = state.nextCursor, filters = { ...state.filters };
      update({ loadingMore: true, moreError: '' });
      try {
        const page = await client.find(filters, request.signal, cursor);
        if (page.nextCursor === cursor) throw new Error('Cursor sin avance.');
        if (active && current === revision) {
          const known = new Set(state.data.map(row => row.id));
          const additions = page.data.filter(row => { if (known.has(row.id)) return false; known.add(row.id); return true; });
          update({ data: [...state.data, ...additions], nextCursor: page.nextCursor, loadingMore: false });
        }
      } catch (error) { if (active && current === revision) update({ loadingMore: false, moreError: auditError(error) }); }
    },
  };
}
