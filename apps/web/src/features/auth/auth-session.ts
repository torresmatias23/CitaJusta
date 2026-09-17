import { ApiError } from '../../lib/http-client.ts';
import type { ApiClient, RequestOptions } from '../../lib/http-client.ts';
import type { RefreshTokenStorage } from './session-storage.ts';

export type LoginInput = { email: string; password: string };
export type RegisterInput = LoginInput & { firstName: string; lastName: string };
export type UserProfile = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  status: string;
  context: { institutionId?: string; branchId?: string };
  roles: string[];
  permissions: string[];
};
type TokenPair = { accessToken: string; refreshToken: string };
export type AuthSnapshot = {
  status: 'loading' | 'authenticated' | 'anonymous' | 'error';
  user: UserProfile | null;
  error: string | null;
};

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseTokenPair(value: unknown): TokenPair {
  if (!object(value) || typeof value.accessToken !== 'string' || !value.accessToken
    || typeof value.refreshToken !== 'string' || !value.refreshToken || value.tokenType !== 'Bearer') {
    throw new Error('Respuesta de sesión inválida.');
  }
  return { accessToken: value.accessToken, refreshToken: value.refreshToken };
}

function parseUser(value: unknown): UserProfile {
  if (!object(value) || !object(value.data)) throw new Error('Respuesta de perfil inválida.');
  const data = value.data;
  if (typeof data.id !== 'string' || typeof data.email !== 'string' || typeof data.firstName !== 'string'
    || typeof data.lastName !== 'string' || !object(data.context)
    || !Array.isArray(data.roles) || !data.roles.every((role): role is string => typeof role === 'string')
    || !Array.isArray(data.permissions) || !data.permissions.every((permission): permission is string => typeof permission === 'string')) {
    throw new Error('Respuesta de perfil inválida.');
  }
  if (data.status !== 'ACTIVE') throw new ApiError(401);
  return {
    id: data.id, email: data.email, firstName: data.firstName, lastName: data.lastName, status: data.status,
    context: {
      ...(typeof data.context.institutionId === 'string' ? { institutionId: data.context.institutionId } : {}),
      ...(typeof data.context.branchId === 'string' ? { branchId: data.context.branchId } : {}),
    },
    roles: data.roles, permissions: data.permissions,
  };
}

export function authErrorMessage(error: unknown, action: 'login' | 'register' | 'session'): string {
  if (error instanceof ApiError) {
    if (error.status === 401) return action === 'login' ? 'Correo o contraseña incorrectos, o cuenta no habilitada.' : 'Tu sesión terminó. Inicia sesión nuevamente.';
    if (error.status === 409 && action === 'register') return 'Ya existe una cuenta con ese correo.';
    if (error.status === 400) return 'Revisa los datos ingresados e inténtalo nuevamente.';
    if (error.status === 429) return 'Se alcanzó el límite de intentos. Espera antes de volver a intentar.';
  }
  return action === 'session' ? 'No pudimos verificar tu sesión. Revisa tu conexión y vuelve a intentar.' : 'No se pudo completar la solicitud. Revisa tu conexión e inténtalo nuevamente.';
}

export function safeReturnTo(value: unknown): string {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || /[\\\u0000-\u001f]/.test(value)) return '/';
  const url = new URL(value, 'https://citajusta.invalid');
  if (url.origin !== 'https://citajusta.invalid' || ['/login', '/registro'].includes(url.pathname)) return '/';
  return `${url.pathname}${url.search}${url.hash}`;
}

export function createAuthSession({ publicApi, authenticatedApi, storage }: {
  publicApi: ApiClient;
  authenticatedApi: (getAccessToken: () => string | undefined) => ApiClient;
  storage: RefreshTokenStorage;
}) {
  let accessToken: string | undefined;
  let refreshToken: string | undefined;
  let generation = 0;
  let initialized = false;
  let snapshot: AuthSnapshot = { status: 'loading', user: null, error: null };
  let restoreFlight: Promise<void> | undefined;
  let refreshFlight: { generation: number; promise: Promise<void> } | undefined;
  const listeners = new Set<() => void>();
  const transport = authenticatedApi(() => accessToken);

  function update(next: AuthSnapshot) {
    snapshot = next;
    listeners.forEach((listener) => listener());
  }

  function clear(error: string | null = null) {
    generation++;
    accessToken = undefined;
    refreshToken = undefined;
    storage.clear();
    update({ status: 'anonymous', user: null, error });
  }

  function assertCurrent(expected: number, signal?: AbortSignal) {
    signal?.throwIfAborted();
    if (generation !== expected) throw new ApiError(401);
  }

  async function revoke(token: string) {
    await publicApi.request('auth/logout', { method: 'POST', body: { refreshToken: token } });
  }

  async function savePair(value: unknown, expected: number) {
    const pair = parseTokenPair(value);
    if (generation !== expected) {
      // Una respuesta de login/refresh posterior al logout no revive la sesión.
      void revoke(pair.refreshToken).catch(() => undefined);
      throw new ApiError(401);
    }
    accessToken = pair.accessToken;
    refreshToken = pair.refreshToken;
    storage.write(pair.refreshToken);
  }

  function rotate(expected: number): Promise<void> {
    assertCurrent(expected);
    if (refreshFlight?.generation === expected) return refreshFlight.promise;
    const token = refreshToken;
    if (!token) {
      clear('Tu sesión terminó. Inicia sesión nuevamente.');
      return Promise.reject(new ApiError(401));
    }
    const promise = (async () => {
      try {
        const value = await publicApi.request('auth/refresh', { method: 'POST', body: { refreshToken: token } });
        await savePair(value, expected);
      } catch (error) {
        if (generation === expected) {
          if (error instanceof ApiError && [401, 403].includes(error.status)) clear(authErrorMessage(error, 'session'));
          else {
            accessToken = undefined;
            update({ status: 'error', user: null, error: authErrorMessage(error, 'session') });
          }
        }
        throw error;
      } finally {
        if (refreshFlight?.generation === expected) refreshFlight = undefined;
      }
    })();
    refreshFlight = { generation: expected, promise };
    return promise;
  }

  const api: ApiClient = {
    async request(path: string, options: RequestOptions = {}) {
      const expected = generation;
      const sentToken = accessToken;
      assertCurrent(expected, options.signal);
      if (!sentToken) throw new ApiError(401);
      try {
        const result = await transport.request(path, options);
        assertCurrent(expected, options.signal);
        return result;
      } catch (error) {
        assertCurrent(expected, options.signal);
        if (!(error instanceof ApiError) || error.status !== 401) throw error;
      }
      // Un 401 tardío del token anterior reutiliza la rotación ya completada.
      if (accessToken === sentToken) await rotate(expected);
      assertCurrent(expected, options.signal);
      // Algunas escrituras requieren confirmación manual aun después de renovar la sesión.
      if (options.retryAfterRefresh === false) throw new ApiError(401);
      try {
        const result = await transport.request(path, options);
        assertCurrent(expected, options.signal);
        return result;
      } catch (error) {
        if (generation === expected && error instanceof ApiError && error.status === 401) clear(authErrorMessage(error, 'session'));
        throw error;
      }
    },
  };

  async function loadProfile(expected: number) {
    const user = parseUser(await api.request('users/me'));
    assertCurrent(expected);
    update({ status: 'authenticated', user, error: null });
  }

  function restore(force = false): Promise<void> {
    if (restoreFlight) return restoreFlight;
    if (initialized && !force) return Promise.resolve();
    initialized = true;
    refreshToken ??= storage.read();
    if (!refreshToken) {
      update({ status: 'anonymous', user: null, error: null });
      return Promise.resolve();
    }
    const expected = generation;
    update({ status: 'loading', user: null, error: null });
    const promise = (async () => {
      try {
        await rotate(expected);
        await loadProfile(expected);
      } catch (error) {
        if (generation === expected) {
          if (error instanceof ApiError && error.status === 401) clear(authErrorMessage(error, 'session'));
          else update({ status: 'error', user: null, error: authErrorMessage(error, 'session') });
        }
      } finally { restoreFlight = undefined; }
    })();
    restoreFlight = promise;
    return promise;
  }

  return {
    api,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    getSnapshot: () => snapshot,
    restore,
    retrySession: () => restore(true),
    async login(input: LoginInput) {
      initialized = true;
      clear();
      const expected = generation;
      update({ status: 'loading', user: null, error: null });
      let issued = false;
      try {
        const value = await publicApi.request('auth/login', { method: 'POST', body: { email: input.email, password: input.password } });
        await savePair(value, expected);
        issued = true;
        await loadProfile(expected);
      } catch (error) {
        if (generation === expected) {
          if (issued && !(error instanceof ApiError && error.status === 401)) update({ status: 'error', user: null, error: authErrorMessage(error, 'session') });
          else clear(authErrorMessage(error, 'login'));
        }
        throw error;
      }
    },
    async register(input: RegisterInput) {
      await publicApi.request('auth/register', {
        method: 'POST',
        body: { email: input.email, password: input.password, firstName: input.firstName, lastName: input.lastName },
      });
    },
    async logout() {
      initialized = true;
      const token = refreshToken;
      clear();
      const expected = generation;
      if (!token) return;
      try { await revoke(token); }
      catch {
        if (generation === expected) update({ status: 'anonymous', user: null, error: 'Sesión cerrada en este navegador. No pudimos confirmar la revocación en el servidor.' });
      }
    },
  };
}

export type AuthSession = ReturnType<typeof createAuthSession>;
