import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useSyncExternalStore, type ReactNode } from 'react';
import { useLocation } from 'react-router';
import { useAuth } from '../auth/auth-provider';
import { createNotificationsApi } from './notifications-api';
import { createNotificationsStore } from './notifications-store';

type Store = ReturnType<typeof createNotificationsStore>;
const Context = createContext<Store | null>(null);
export function NotificationsProvider({ children }: { children: ReactNode }) {
  const { status, user } = useAuth();
  const identity = status === 'authenticated' ? user?.id : undefined;
  return <SessionNotifications key={identity ?? 'anonymous'} enabled={!!identity}>{children}</SessionNotifications>;
}
function SessionNotifications({ children, enabled }: { children: ReactNode; enabled: boolean }) {
  const { api } = useAuth();
  const { pathname } = useLocation();
  const store = useMemo(() => createNotificationsStore(createNotificationsApi(api)), [api]);
  useLayoutEffect(() => { store.activate(); return () => store.dispose(); }, [store]);
  useEffect(() => {
    if (enabled) void store.refreshCount();
    const focus = () => { if (enabled) void store.focus(); };
    window.addEventListener('focus', focus);
    return () => { window.removeEventListener('focus', focus); };
  }, [enabled, pathname, store]);
  return <Context.Provider value={store}>{children}</Context.Provider>;
}
export function useNotifications() {
  const store = useContext(Context);
  if (!store) throw new Error('NotificationsProvider requerido');
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  return { ...snapshot, load: store.load, read: store.read, refreshCount: store.refreshCount };
}
