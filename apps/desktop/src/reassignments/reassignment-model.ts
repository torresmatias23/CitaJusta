import type { ApiClient, UserProfile } from '@citajusta/client-core';
import { canReadReassignments, createReassignmentApi, reassignmentError } from './reassignment-api.ts';
import type { Reassignment } from './reassignment-api.ts';

export type ReassignmentState = { status: 'idle' | 'loading' | 'ready' | 'error' | 'denied'; id: string; data: Reassignment | null; error: string };
export function createReassignmentModel(api: ApiClient, user: UserProfile) {
  const allowed = canReadReassignments(user), client = createReassignmentApi(api, user);
  const initial = (): ReassignmentState => ({ status: allowed ? 'idle' : 'denied', id: '', data: null, error: '' });
  let state = initial(), active = true, revision = 0;
  let request = new AbortController();
  const listeners = new Set<() => void>();
  const update = (patch: Partial<ReassignmentState>) => { if (active) { state = { ...state, ...patch }; listeners.forEach(fn => fn()); } };
  const invalidate = () => { revision++; request.abort(); };
  return {
    subscribe(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; },
    getSnapshot: () => state,
    activate() { active = true; },
    dispose() { active = false; invalidate(); state = initial(); },
    setId(id: string) { if (active && allowed) { invalidate(); update({ id, status: 'idle', data: null, error: '' }); } },
    async consult() {
      if (!active || !allowed || state.status === 'loading') return;
      invalidate(); request = new AbortController(); const current = revision;
      update({ status: 'loading', data: null, error: '' });
      try {
        const data = await client.find(state.id.trim(), request.signal);
        if (active && current === revision) update({ status: 'ready', data });
      } catch (error) { if (active && current === revision) update({ status: 'error', error: reassignmentError(error), data: null }); }
    },
  };
}
