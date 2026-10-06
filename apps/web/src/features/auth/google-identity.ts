import { ApiError } from '@citajusta/client-core';
import { loadGoogleSdk } from './google-sdk.ts';

export function googleClientId(value: unknown): string | undefined {
  return typeof value === 'string' && /^[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/.test(value.trim()) ? value.trim() : undefined;
}

export function googleErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === 'GOOGLE_ACCOUNT_LINK_REQUIRED') return 'Ya existe una cuenta CitaJusta con ese correo. Inicia sesión con tu contraseña y vincula Google desde Mi cuenta.';
    if (error.code === 'GOOGLE_IDENTITY_CONFLICT') return 'No se pudo vincular esa cuenta Google. Usa la cuenta del mismo correo; sólo puedes vincular una cuenta Google.';
    if (error.code === 'GOOGLE_PROFILE_REQUIRED') return 'Tu perfil Google debe incluir nombre y apellido para crear una cuenta CitaJusta.';
    if (error.status === 401) return 'No pudimos validar tu cuenta Google o la cuenta no está habilitada. Vuelve a intentar.';
    if (error.status === 429) return 'Espera antes de volver a intentar.';
    if (error.status === 503) return 'El acceso con Google no está disponible en este momento. Puedes usar tu contraseña.';
  }
  return 'No pudimos completar la operación con Google. Revisa tu conexión y vuelve a intentar.';
}

// Shared by login and registration; only CitaJusta's session owns authentication.
export async function signInWithGoogle(credential: string, { busy, loginGoogle, onSuccess, setPending, setError }: {
  busy: { current: boolean };
  loginGoogle: (credential: string) => Promise<void>;
  onSuccess: () => void;
  setPending: (pending: boolean) => void;
  setError: (error: string | null) => void;
}): Promise<void> {
  if (busy.current) return;
  busy.current = true; setPending(true); setError(null);
  try { await loginGoogle(credential); onSuccess(); }
  catch (failure) { setError(googleErrorMessage(failure)); }
  finally { busy.current = false; setPending(false); }
}

export interface GoogleIdentityApi {
  initialize(options: { client_id: string; callback: (response: { credential?: string }) => void; auto_select: false; ux_mode: 'popup' }): void;
  renderButton(element: HTMLElement, options: { type: 'standard'; theme: 'outline'; size: 'large'; text: 'continue_with'; locale: 'es'; width: number }): void;
}
type GoogleWindow = Window & { google?: { accounts?: { id?: GoogleIdentityApi } } };
async function loadGoogleIdentity(): Promise<GoogleIdentityApi> {
  await loadGoogleSdk();
  const api = (window as GoogleWindow).google?.accounts?.id;
  if (!api) throw new Error('Google unavailable');
  return api;
}

// GIS initializes once per page. Only the currently mounted explicit button owns its callback.
export function createGoogleButtonRenderer(load: () => Promise<GoogleIdentityApi> = loadGoogleIdentity) {
  let initialized: string | undefined;
  let receive: ((credential: string) => void) | undefined;
  let revision = 0;
  return async (clientId: string, element: HTMLElement, callback: (credential: string) => void) => {
    const expected = ++revision;
    const api = await load();
    if (revision !== expected) return () => {};
    if (initialized !== clientId) {
      api.initialize({ client_id: clientId, auto_select: false, ux_mode: 'popup', callback: (response) => {
        if (typeof response.credential === 'string' && response.credential) receive?.(response.credential);
      } });
      initialized = clientId;
    }
    receive = callback;
    api.renderButton(element, { type: 'standard', theme: 'outline', size: 'large', text: 'continue_with', locale: 'es', width: Math.max(200, Math.min(280, element.clientWidth || 280)) });
    return () => {
      if (receive === callback) receive = undefined;
      if (revision === expected) element.replaceChildren();
    };
  };
}
export const renderGoogleButton = createGoogleButtonRenderer();
