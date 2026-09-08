import { readApiBaseUrl } from './env';
import { createHttpClient } from './http-client';

// Punto de integración futuro. No almacena tokens, no simula refresh ni inicia peticiones.
export function createApi(getAccessToken?: () => string | undefined) {
  return createHttpClient({
    baseUrl: readApiBaseUrl(import.meta.env['VITE_API_BASE_URL']),
    ...(getAccessToken ? { getAccessToken } : {}),
  });
}
