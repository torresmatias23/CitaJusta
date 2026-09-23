import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { createHttpClient } from '@citajusta/client-core';

// El transporte nativo no depende de CORS. No seguir redirecciones con tokens.
export const desktopFetch: typeof fetch = (input, init) =>
  tauriFetch(input, { ...init, maxRedirections: 0 });

export function createDesktopHttpClient(baseUrl: string, getAccessToken?: () => string | undefined) {
  return createHttpClient({ baseUrl, getAccessToken, fetcher: desktopFetch });
}
