import { createContext, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { createHttpClient } from '../../lib/http-client';
import { readApiBaseUrl } from '../../lib/env';
import { useAuth } from '../auth/auth-provider';
import { createPrivacyApi } from './privacy-api';
import { createPrivacyModel } from './privacy-model';

type Model = ReturnType<typeof createPrivacyModel>;
const Context = createContext<{ model: Model; authenticated: boolean } | null>(null);
export function PrivacyProvider({ children }: { children: ReactNode }) {
  const { user, status } = useAuth();
  const identity = status === 'authenticated' ? user?.id : undefined;
  return <SessionPrivacy key={identity ?? 'anonymous'} authenticated={!!identity}>{children}</SessionPrivacy>;
}
function SessionPrivacy({ children, authenticated }: { children: ReactNode; authenticated: boolean }) {
  const { api } = useAuth();
  const [model] = useState(() => createPrivacyModel(createPrivacyApi(
    createHttpClient({ baseUrl: readApiBaseUrl(import.meta.env.VITE_API_BASE_URL) }), api), authenticated));
  useEffect(() => { void model.load(); return () => model.dispose(); }, [model]);
  return <Context.Provider value={{ model, authenticated }}>{children}</Context.Provider>;
}
export function usePrivacy() {
  const value = useContext(Context);
  if (!value) throw new Error('PrivacyProvider requerido');
  const state = useSyncExternalStore(value.model.subscribe, value.model.getSnapshot, value.model.getSnapshot);
  return { ...value, state };
}
