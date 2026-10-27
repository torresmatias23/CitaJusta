import type { ApiClient, UserProfile } from '@citajusta/client-core';
import { canReadReassignments, createReassignmentApi, reassignmentError, reassignmentListingError, reassignmentStatuses } from './reassignment-api.ts';
import type { Reassignment, ReassignmentListing, ReassignmentStatus } from './reassignment-api.ts';

export type ReassignmentState = {
  status: 'idle' | 'loading' | 'ready' | 'error' | 'denied'; filter: ReassignmentStatus | undefined;
  data: ReassignmentListing[]; nextCursor: string | null; error: string; loadingMore: boolean; moreError: string;
  detailStatus: 'idle' | 'loading' | 'ready' | 'error'; detail: Reassignment | null; detailError: string;
};
export function createReassignmentModel(api: ApiClient, user: UserProfile) {
  const allowed = canReadReassignments(user), client = createReassignmentApi(api, user);
  const initial = (): ReassignmentState => ({
    status: allowed ? 'idle' : 'denied', filter: undefined, data: [], nextCursor: null, error: '', loadingMore: false, moreError: '',
    detailStatus: 'idle', detail: null, detailError: '',
  });
  let state = initial(), active = true, readRevision = 0, detailRevision = 0;
  let readRequest = new AbortController(), detailRequest = new AbortController();
  const listeners = new Set<() => void>();
  const update = (patch: Partial<ReassignmentState>) => { if (active) { state = { ...state, ...patch }; listeners.forEach(fn => fn()); } };
  const invalidateRead = () => { readRevision++; readRequest.abort(); };
  const invalidateDetail = () => { detailRevision++; detailRequest.abort(); };
  const clearDetail = () => { invalidateDetail(); update({ detailStatus: 'idle', detail: null, detailError: '' }); };
  const consult = async () => {
    if (!active || !allowed || state.status === 'loading' || state.loadingMore) return;
    invalidateRead(); readRequest = new AbortController(); const current = readRevision, filter = state.filter;
    update({ status: 'loading', data: [], nextCursor: null, error: '', loadingMore: false, moreError: '' });
    try {
      const page = await client.list(filter, readRequest.signal);
      if (active && current === readRevision) update({ status: 'ready', data: [...new Map(page.data.map(row => [row.id, row])).values()], nextCursor: page.nextCursor });
    } catch (error) { if (active && current === readRevision) update({ status: 'error', error: reassignmentListingError(error), data: [], nextCursor: null }); }
  };
  const loadMore = async () => {
    if (!active || !allowed || state.status !== 'ready' || state.loadingMore || !state.nextCursor) return;
    invalidateRead(); readRequest = new AbortController(); const current = readRevision, cursor = state.nextCursor, filter = state.filter, existing = state.data;
    update({ loadingMore: true, moreError: '' });
    try {
      const page = await client.list(filter, readRequest.signal, cursor);
      if (page.nextCursor === cursor) throw new Error('Cursor without progress.');
      if (active && current === readRevision) {
        const known = new Set(existing.map(row => row.id));
        const additions = page.data.filter(row => { if (known.has(row.id)) return false; known.add(row.id); return true; });
        update({ data: [...existing, ...additions], nextCursor: page.nextCursor, loadingMore: false });
      }
    } catch (error) { if (active && current === readRevision) update({ loadingMore: false, moreError: reassignmentListingError(error) }); }
  };
  const openDetail = async (id: string) => {
    if (!active || !allowed || state.detailStatus === 'loading' || !state.data.some(row => row.id === id)) return;
    invalidateDetail(); detailRequest = new AbortController(); const current = detailRevision;
    update({ detailStatus: 'loading', detail: null, detailError: '' });
    try {
      const detail = await client.find(id, detailRequest.signal);
      if (active && current === detailRevision) update({ detailStatus: 'ready', detail });
    } catch (error) { if (active && current === detailRevision) update({ detailStatus: 'error', detail: null, detailError: reassignmentError(error) }); }
  };
  return {
    subscribe(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; },
    getSnapshot: () => state,
    activate() { active = true; if (allowed && state.status === 'idle') void consult(); },
    dispose() { active = false; invalidateRead(); invalidateDetail(); state = initial(); },
    setFilter(filter: string) {
      if (!active || !allowed) return;
      const selected = filter === '' ? undefined : reassignmentStatuses.find(status => status === filter);
      if (filter !== '' && !selected) return;
      invalidateRead(); clearDetail(); update({ filter: selected, status: 'idle', data: [], nextCursor: null, error: '', loadingMore: false, moreError: '' });
      void consult();
    },
    consult, loadMore, openDetail,
    closeDetail() { if (!active) return; clearDetail(); },
  };
}
