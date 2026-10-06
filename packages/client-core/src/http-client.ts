import { normalizeApiBaseUrl } from './api-base-url.ts';

export class ApiError extends Error {
  readonly status: number;
  readonly code: 'GOOGLE_ACCOUNT_LINK_REQUIRED' | 'GOOGLE_IDENTITY_CONFLICT' | 'GOOGLE_PROFILE_REQUIRED' | undefined;
  constructor(status: number, code?: ApiError['code']) {
    super(status === 401 ? 'Necesitas iniciar sesión.' : status === 409 ? 'La operación no pudo completarse por un conflicto.' : 'No se pudo completar la solicitud.');
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

export type RequestOptions = {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
  query?: Readonly<Record<string, string>>;
  retryAfterRefresh?: boolean;
  institutionContext?: { institutionId: string; branchId?: string };
};

export type ApiClient = {
  request(path: string, options?: RequestOptions): Promise<unknown>;
};

export function createHttpClient({ baseUrl, fetcher = fetch, getAccessToken }: {
  baseUrl: string;
  fetcher?: typeof fetch;
  getAccessToken?: () => string | undefined;
}): ApiClient {
  const base = normalizeApiBaseUrl(baseUrl);
  return {
    async request(path: string, options: RequestOptions = {}): Promise<unknown> {
      // Rutas relativas controladas: nunca enviar un Bearer a otro origen o prefijo.
      if (!/^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*$/.test(path)) throw new Error('Ruta de API inválida.');
      const headers = new Headers({ Accept: 'application/json' });
      if (options.institutionContext) {
        const { institutionId, branchId } = options.institutionContext;
        const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        if (!uuid.test(institutionId) || (branchId !== undefined && !uuid.test(branchId))) throw new Error('Contexto institucional inválido.');
        headers.set('x-institution-id', institutionId);
        if (branchId) headers.set('x-branch-id', branchId);
      }
      const token = getAccessToken?.();
      if (token) headers.set('Authorization', `Bearer ${token}`);
      if (options.body !== undefined) headers.set('Content-Type', 'application/json');
      const method = options.method ?? 'GET';
      if (method === 'GET' && options.body !== undefined) throw new Error('GET no admite body.');
      const query = new URLSearchParams(options.query);
      const suffix = query.size ? `?${query.toString()}` : '';
      const response = await fetcher(`${base}/${path}${suffix}`, {
        method,
        headers,
        credentials: 'omit',
        redirect: 'error',
        cache: 'no-store',
        ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
        ...(options.signal ? { signal: options.signal } : {}),
      });
      // No propagar mensajes, stacks ni cuerpos de error del servidor a la interfaz.
      if (!response.ok) {
        let code: ApiError['code'];
        if ([400, 409].includes(response.status)) {
          try {
            const error: unknown = await response.json();
            if (typeof error === 'object' && error !== null && 'code' in error) {
              if (response.status === 409 && (error.code === 'GOOGLE_ACCOUNT_LINK_REQUIRED' || error.code === 'GOOGLE_IDENTITY_CONFLICT')) code = error.code;
              if (response.status === 400 && error.code === 'GOOGLE_PROFILE_REQUIRED') code = error.code;
            }
          } catch { /* Only allowlisted functional codes can leave the transport. */ }
        }
        throw new ApiError(response.status, code);
      }
      if (response.status === 204) return undefined;
      const data: unknown = await response.json();
      return data;
    },
  };
}
