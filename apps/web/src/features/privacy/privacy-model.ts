import { ApiError } from '../../lib/http-client';
import { privacyError, type createPrivacyApi, type PrivacyNotice } from './privacy-api';

export type PrivacyState = { status: 'loading' | 'ready' | 'error'; notice: PrivacyNotice | null;
  acknowledgedAt: string | null; pending: boolean; error: string };
export function createPrivacyModel(api: ReturnType<typeof createPrivacyApi>, authenticated: boolean) {
  let state: PrivacyState = { status: 'loading', notice: null, acknowledgedAt: null, pending: false, error: '' };
  let disposed = false, sequence = 0;
  const requests = new Set<AbortController>(), listeners = new Set<() => void>();
  const update = (patch: Partial<PrivacyState>) => {
    if (!disposed) { state = { ...state, ...patch }; listeners.forEach(listener => listener()); }
  };
  const model = {
    getSnapshot: () => state,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    async load() {
      disposed = false;
      const attempt = ++sequence, request = new AbortController(); requests.add(request);
      update({ status: 'loading', notice: null, acknowledgedAt: null, pending: false, error: '' });
      try {
        const data = authenticated ? await api.mine(request.signal) : { notice: await api.publicNotice(request.signal), acknowledgedAt: null };
        if (!disposed && attempt === sequence) update({ ...data, status: 'ready' });
      } catch (error) {
        // Information remains available even when account persistence is unavailable.
        let notice: PrivacyNotice | null = null;
        if (authenticated && !request.signal.aborted) {
          try { notice = await api.publicNotice(request.signal); } catch { /* Keep the retry action. */ }
        }
        if (!disposed && attempt === sequence) update({ notice, status: 'error', error: privacyError(error) });
      } finally { requests.delete(request); }
    },
    async acknowledge() {
      if (disposed || !authenticated || state.status !== 'ready' || !state.notice || state.acknowledgedAt || state.pending) return;
      const versionId = state.notice.id, attempt = sequence, request = new AbortController(); requests.add(request);
      update({ pending: true, error: '' });
      try {
        const acknowledgedAt = await api.acknowledge(versionId, request.signal);
        if (!disposed && attempt === sequence) update({ acknowledgedAt });
      } catch (error) {
        if (!disposed && attempt === sequence) update({ error: privacyError(error),
          ...(error instanceof ApiError && error.status === 409 ? { status: 'error' as const } : {}) });
      } finally { requests.delete(request); if (!disposed && attempt === sequence) update({ pending: false }); }
    },
    dispose() { disposed = true; sequence++; requests.forEach(request => request.abort()); requests.clear(); },
  };
  return model;
}
