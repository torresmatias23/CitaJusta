import { normalizeApiBaseUrl } from '@citajusta/client-core';

export function readDesktopApiBaseUrl(value: unknown): string {
  const invalid = () => new Error('Configura VITE_API_BASE_URL con una URL absoluta HTTP(S), sin credenciales, query ni hash y con ruta /api/v1.');
  if (typeof value !== 'string' || !/^https?:\/\//.test(value) || /[?#\\\u0000-\u0020]/.test(value)) throw invalid();
  try { return normalizeApiBaseUrl(value); } catch { throw invalid(); }
}
