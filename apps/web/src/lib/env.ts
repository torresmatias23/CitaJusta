export function readApiBaseUrl(value: unknown): string {
  const base = value === undefined ? '/api/v1' : value;
  const invalid = () => new Error('VITE_API_BASE_URL debe apuntar a /api/v1 mediante una ruta local o URL HTTP(S) sin credenciales.');
  if (typeof base !== 'string' || !base || base.trim() !== base) throw invalid();
  if (base === '/api/v1' || base === '/api/v1/') return '/api/v1';

  let url: URL;
  try { url = new URL(base); } catch { throw invalid(); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || !/^\/api\/v1\/?$/.test(url.pathname)) {
    throw invalid();
  }
  return `${url.origin}/api/v1`;
}
