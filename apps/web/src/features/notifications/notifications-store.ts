import type { createNotificationsApi, Notification } from './notifications-api.ts';
import { notificationError } from './notifications-api.ts';

export type NotificationsSnapshot = { items: Notification[]; status: 'idle' | 'loading' | 'ready' | 'error';
  error: string | null; nextCursor: string | null; unreadCount: number | null; countError: boolean;
  loadingMore: boolean; reading: string[] };
const initial = (): NotificationsSnapshot => ({ items: [], status: 'idle', error: null, nextCursor: null,
  unreadCount: null, countError: false, loadingMore: false, reading: [] });

// One instance per authenticated identity; disposal invalidates every pending response.
export function createNotificationsStore(api: ReturnType<typeof createNotificationsApi>) {
  let snapshot = initial(), disposed = false, listVersion = 0, countVersion = 0;
  let listController: AbortController | undefined, countController: AbortController | undefined;
  const writes = new Set<AbortController>(), listeners = new Set<() => void>();
  const emit = (patch: Partial<NotificationsSnapshot>) => {
    if (disposed) return;
    snapshot = { ...snapshot, ...patch }; for (const listener of listeners) listener();
  };
  async function refreshCount() {
    if (disposed) return;
    countController?.abort(); const controller = new AbortController(); countController = controller;
    const version = ++countVersion;
    try { const unreadCount = await api.unreadCount(controller.signal);
      if (!disposed && version === countVersion) emit({ unreadCount, countError: false });
    } catch { if (!disposed && version === countVersion) emit({ unreadCount: null, countError: true }); }
  }
  async function load(more = false) {
    if (disposed || snapshot.reading.length || (more && (!snapshot.nextCursor || snapshot.loadingMore))) return;
    const cursor = more ? snapshot.nextCursor ?? undefined : undefined;
    listController?.abort(); const controller = new AbortController(); listController = controller;
    const version = ++listVersion; const countAtStart = ++countVersion; countController?.abort();
    emit({ error: null, loadingMore: more, ...(more ? {} : { status: 'loading' }) });
    try {
      const page = await api.list(cursor, controller.signal);
      if (disposed || version !== listVersion) return;
      if (cursor && cursor === page.page.nextCursor) throw new Error('Cursor did not advance');
      const items = more ? [...new Map([...snapshot.items, ...page.data].map((item) => [item.id, item])).values()] : page.data;
      emit({ items, nextCursor: page.page.nextCursor, status: 'ready', loadingMore: false,
        ...(countAtStart === countVersion ? { unreadCount: page.unreadCount, countError: false } : {}) });
    } catch (error) { if (!disposed && version === listVersion) emit({ status: more ? 'ready' : 'error', loadingMore: false, error: notificationError(error) }); }
  }
  async function read(id: string) {
    if (disposed || snapshot.reading.includes(id)) return;
    listController?.abort(); ++listVersion; countController?.abort(); ++countVersion;
    const controller = new AbortController(); writes.add(controller);
    emit({ reading: [...snapshot.reading, id], error: null, loadingMore: false, status: 'ready' });
    try {
      const result = await api.read(id, controller.signal);
      if (!disposed && !controller.signal.aborted) emit({ items: snapshot.items.map((item) => item.id === id ? { ...item, readAt: result.readAt } : item) });
    } catch (error) { if (!disposed && !controller.signal.aborted) emit({ error: notificationError(error) }); }
    finally { writes.delete(controller); if (!disposed && !controller.signal.aborted) {
      emit({ reading: snapshot.reading.filter((value) => value !== id) }); await refreshCount();
    } }
  }
  return { getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    load, read, refreshCount, activate: () => { disposed = false; },
    focus: async () => { if (snapshot.status === 'idle') await refreshCount(); else await load(); },
    dispose: () => {
      disposed = true; ++listVersion; ++countVersion; listController?.abort(); countController?.abort();
      for (const controller of writes) controller.abort(); writes.clear(); snapshot = initial();
      for (const listener of listeners) listener();
    },
  };
}
