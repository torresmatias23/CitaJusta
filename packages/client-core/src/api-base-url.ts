export function normalizeApiBaseUrl(value: unknown): string {
  const base = value;
  const invalid = () => new Error('La URL de API debe apuntar a /api/v1 mediante una ruta local o URL HTTP(S) sin credenciales.');
  if (typeof base !== 'string' || !base || base.trim() !== base) throw invalid();
  if (base === '/api/v1' || base === '/api/v1/') return '/api/v1';

  let url: URL;
  try { url = new URL(base); } catch { throw invalid(); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || !/^\/api\/v1\/?$/.test(url.pathname)) {
    throw invalid();
  }
  return `${url.origin}/api/v1`;
}
