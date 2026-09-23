import { createContext, useContext, useEffect, useState, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import { createAuthSession } from '@citajusta/client-core';
import type { AuthSession, AuthSnapshot } from '@citajusta/client-core';
import { createMemorySessionStorage } from './memory-session-storage';
import { createDesktopHttpClient } from '../lib/desktop-http';
import { readDesktopApiBaseUrl } from '../lib/env';

type AuthValue = AuthSnapshot & Pick<AuthSession, 'api' | 'login' | 'logout' | 'retrySession'>;
const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [setup] = useState(() => {
    try {
      const baseUrl = readDesktopApiBaseUrl(import.meta.env.VITE_API_BASE_URL);
      return { session: createAuthSession({
        publicApi: createDesktopHttpClient(baseUrl),
        authenticatedApi: (getAccessToken) => createDesktopHttpClient(baseUrl, getAccessToken),
        storage: createMemorySessionStorage(),
      }), error: null };
    } catch {
      return { session: null, error: 'Configuración de API inválida. Revisa VITE_API_BASE_URL en apps/desktop/.env y reinicia Desktop.' };
    }
  });
  if (!setup.session) return <main><h1>CitaJusta</h1><p role="alert">{setup.error}</p></main>;
  return <SessionProvider session={setup.session}>{children}</SessionProvider>;
}

export function SessionProvider({ session, children }: { session: AuthSession; children: ReactNode }) {
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);
  useEffect(() => { void session.restore(); }, [session]);
  return <AuthContext.Provider value={{ ...snapshot, api: session.api, login: session.login, logout: session.logout, retrySession: session.retrySession }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth requiere AuthProvider.');
  return value;
}
