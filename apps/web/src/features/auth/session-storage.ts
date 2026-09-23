import type { RefreshTokenStorage } from '@citajusta/client-core';
export type { RefreshTokenStorage } from '@citajusta/client-core';

const storageKey = 'citajusta.session.v1';

// Adaptador temporal al contrato JSON del backend. Nunca guarda access tokens.
// sessionStorage limita la persistencia a esta pestaña; no sustituye protección XSS.
export function createSessionStorage(getStorage: () => Storage): RefreshTokenStorage {
  return {
    read() {
      try {
        const raw = getStorage().getItem(storageKey);
        if (!raw) return undefined;
        const value: unknown = JSON.parse(raw);
        if (typeof value === 'object' && value !== null && 'refreshToken' in value
          && typeof value.refreshToken === 'string' && value.refreshToken.length > 0 && value.refreshToken.length <= 4096) {
          return value.refreshToken;
        }
        getStorage().removeItem(storageKey);
      } catch { /* Almacenamiento bloqueado o contenido inválido: sesión sólo en memoria. */ }
      return undefined;
    },
    write(token) {
      try { getStorage().setItem(storageKey, JSON.stringify({ refreshToken: token })); }
      catch { /* El token sigue en memoria si el navegador no permite persistencia. */ }
    },
    clear() {
      try { getStorage().removeItem(storageKey); }
      catch { /* El cierre local en memoria no depende de sessionStorage. */ }
    },
  };
}
