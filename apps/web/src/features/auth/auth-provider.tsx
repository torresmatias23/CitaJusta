import { createContext, useContext, useEffect, useState, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import { createHttpClient } from '../../lib/http-client';
import { readApiBaseUrl } from '../../lib/env';
import { createAuthSession } from './auth-session';
import type { AuthSession, AuthSnapshot } from './auth-session';
import { createSessionStorage } from './session-storage';

export type { UserProfile } from './auth-session';
type AuthValue = AuthSnapshot & Pick<AuthSession, 'api' | 'login' | 'register' | 'logout' | 'retrySession'>;
const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session] = useState(() => {
    const baseUrl = readApiBaseUrl(import.meta.env.VITE_API_BASE_URL);
    return createAuthSession({
      publicApi: createHttpClient({ baseUrl }),
      authenticatedApi: (getAccessToken) => createHttpClient({ baseUrl, getAccessToken }),
      storage: createSessionStorage(() => window.sessionStorage),
    });
  });
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);
  useEffect(() => { void session.restore(); }, [session]);
  return <AuthContext.Provider value={{ ...snapshot, api: session.api, login: session.login, register: session.register, logout: session.logout, retrySession: session.retrySession }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const auth = useContext(AuthContext);
  if (!auth) throw new Error('useAuth requiere AuthProvider.');
  return auth;
}
