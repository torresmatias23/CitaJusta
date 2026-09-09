import { readApiBaseUrl } from './env.ts';

export class ApiError extends Error {
  readonly status: number;
  constructor(status: number) {
    super(status === 401 ? 'Necesitas iniciar sesión.' : status === 409 ? 'La operación no pudo completarse por un conflicto.' : 'No se pudo completar la solicitud.');
    this.name = 'ApiError';
    this.status = status;
  }
}

export type RequestOptions = {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
  query?: Readonly<Record<string, string>>;
};

export type ApiClient = {
  request(path: string, options?: RequestOptions): Promise<unknown>;
};

export function createHttpClient({ baseUrl, fetcher = fetch, getAccessToken }: {
  baseUrl: string;
  fetcher?: typeof fetch;
  getAccessToken?: () => string | undefined;
}): ApiClient {
  const base = readApiBaseUrl(baseUrl);
  return {
    async request(path: string, options: RequestOptions = {}): Promise<unknown> {
      // Rutas relativas controladas: nunca enviar un Bearer a otro origen o prefijo.
      if (!/^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*$/.test(path)) throw new Error('Ruta de API inválida.');
      const headers = new Headers({ Accept: 'application/json' });
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
      if (!response.ok) throw new ApiError(response.status);
      if (response.status === 204) return undefined;
      const data: unknown = await response.json();
      return data;
    },
  };
}
