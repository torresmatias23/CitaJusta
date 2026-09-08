import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'API_PROXY_');
  const target = env['API_PROXY_TARGET'];

  if (target) {
    let url: URL;
    try { url = new URL(target); } catch {
      throw new Error('API_PROXY_TARGET debe ser una URL HTTP(S) sin credenciales.');
    }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
      throw new Error('API_PROXY_TARGET debe ser una URL HTTP(S) sin credenciales.');
    }
  }

  return {
    plugins: [react(), tailwindcss()],
    server: {
      port: 5173,
      strictPort: true,
      ...(target ? { proxy: { '/api/v1': { target, changeOrigin: true } } } : {}),
    },
  };
});
