import { ApiError, createHttpClient } from '../../lib/http-client';
import type { ApiClient } from '../../lib/http-client';
import { readApiBaseUrl } from '../../lib/env';

export function recoveryApi(api: ApiClient) {
  return {
    request: (email: string) => api.request('auth/forgot-password', { method: 'POST', body: { email: email.trim().toLowerCase() } }),
    reset: (token: string, password: string) => api.request('auth/reset-password', { method: 'POST', body: { token, password } }),
  };
}
export function publicRecoveryApi() {
  return recoveryApi(createHttpClient({ baseUrl: readApiBaseUrl(import.meta.env.VITE_API_BASE_URL) }));
}
export function recoveryError(error: unknown): string {
  if (error instanceof ApiError && error.status === 400) return 'El enlace no es válido, venció o ya fue utilizado. Revisa también que tu contraseña tenga entre 12 y 128 caracteres.';
  return 'No pudimos completar la solicitud. Intenta nuevamente más tarde.';
}
export const recoveryConfirmation = 'Si la cuenta permite recuperación, recibirás instrucciones por correo.';

// The fragment is never sent in HTTP requests. Read once into component memory, then remove it.
export function readRecoveryToken(fragment: string): string {
  if (!fragment.startsWith('#')) return '';
  const values = new URLSearchParams(fragment.replace(/^#/, ''));
  const token = values.get('token');
  return values.size === 1 && token !== null && /^[A-Za-z0-9_-]{43}$/.test(token) ? token : '';
}
export function removeRecoveryFragment(location: Pick<Location, 'pathname' | 'search'>, history: Pick<History, 'replaceState' | 'state'>): void {
  history.replaceState(history.state, '', `${location.pathname}${location.search}`);
}
