import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import { createAuthSession } from '@citajusta/client-core';
import { createMemorySessionStorage } from '../src/auth/memory-session-storage.ts';

// Render de componentes reales; no sustituye la prueba interactiva de la ventana nativa.
const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom' });
after(() => vite.close());
const { default: App } = await vite.ssrLoadModule('/src/App.tsx');
const { SessionProvider } = await vite.ssrLoadModule('/src/auth/auth-provider.tsx');

test('login/shell/logout renderizan sólo el estado y perfil reales, sin tokens ni permisos inventados', async () => {
  const profile = { id: 'controlled', firstName: 'Ana', lastName: 'Prueba', email: 'controlled@example.invalid', status: 'ACTIVE', context: {}, roles: [], permissions: [] };
  const publicApi = { request: async path => path === 'auth/login'
    ? { accessToken: 'secret-access-test', refreshToken: 'secret-refresh-test', tokenType: 'Bearer' }
    : undefined };
  const session = createAuthSession({ publicApi, authenticatedApi: () => ({ request: async () => ({ data: profile }) }), storage: createMemorySessionStorage() });
  const render = () => renderToStaticMarkup(createElement(SessionProvider, { session }, createElement(App)));
  assert.match(render(), /Verificando sesión/);
  assert.doesNotMatch(render(), /Módulos institucionales/);
  await session.restore();
  const login = render();
  assert.match(login, /type="email"/);
  assert.match(login, /type="password"/);
  assert.match(login, /Iniciar sesión/);
  assert.doesNotMatch(login, /Módulos institucionales/);
  await session.login({ email: profile.email, password: 'test-only-password' });
  const shell = render();
  assert.match(shell, /Ana Prueba/);
  assert.match(shell, /controlled@example.invalid/);
  assert.match(shell, /Sin contexto institucional/);
  assert.match(shell, /Sin sede asignada/);
  assert.match(shell, /Sin roles asignados/);
  assert.match(shell, /Módulos institucionales/);
  assert.match(shell, /Cerrar sesión/);
  assert.doesNotMatch(shell, /secret-access-test|secret-refresh-test|test-only-password/);
  const logout = session.logout();
  assert.match(render(), /Iniciar sesión/);
  assert.doesNotMatch(render(), /controlled@example.invalid|Módulos institucionales/);
  await logout;
});
