import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';
import { developmentProxy } from './config/development-proxy.ts';

export default defineConfig(({ mode, command, isPreview }) => {
  const env = loadEnv(mode, process.cwd(), 'API_PROXY_');
  const target = env['API_PROXY_TARGET'];

  const proxy = developmentProxy(command, isPreview === true, target);

  return {
    plugins: [react(), tailwindcss()],
    server: {
      port: 5173,
      strictPort: true,
      ...proxy,
    },
  };
});
