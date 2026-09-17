export function developmentProxy(command: 'build' | 'serve', isPreview: boolean, target: string | undefined) {
  if (command === 'build' || isPreview) return {};
  if (!target) throw new Error('Falta API_PROXY_TARGET para desarrollo. Copia apps/web/.env.example a apps/web/.env, configura la API local y reinicia Vite.');
  let url: URL;
  try { url = new URL(target); } catch { throw new Error('API_PROXY_TARGET debe ser una URL HTTP(S) sin credenciales.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('API_PROXY_TARGET debe ser una URL HTTP(S) sin credenciales, ruta, query ni fragmento.');
  }
  return { proxy: { '/api/v1': { target, changeOrigin: true } } };
}
