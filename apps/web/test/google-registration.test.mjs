import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import react from '@vitejs/plugin-react';
import { createServer } from 'vite';
import { ApiError, createAuthSession } from '@citajusta/client-core';

// Render actual pages and capture their GIS callback; no browser or Google network calls.
async function pages(clientId) {
  const fixture = { status: 'anonymous', calls: [], navigation: [] };
  globalThis.__googleRegistrationFixture = fixture;
  const vite = await createServer({
    root: fileURLToPath(new URL('..', import.meta.url)), configFile: false, envDir: false,
    define: { 'import.meta.env.VITE_GOOGLE_CLIENT_ID': JSON.stringify(clientId) },
    optimizeDeps: { noDiscovery: true, include: [] },
    server: { middlewareMode: true, hmr: false }, appType: 'custom',
    plugins: [react(), {
      name: 'google-registration-fixtures', enforce: 'pre',
      transform(source, id) {
        if (id.match(/\/(register|login)-page\.tsx$/)) return source.replace("from 'react-router'", "from 'fixture:react-router'");
      },
      resolveId(source, importer) {
        if (!importer?.match(/\/(register|login)-page\.tsx$/)) return;
        if (['./auth-provider', './google-button'].includes(source)) return `\0fixture:${source}`;
        if (source === 'fixture:react-router') return '\0fixture:react-router';
      },
      load(id) {
        const fixture = 'globalThis.__googleRegistrationFixture';
        if (id === '\0fixture:./auth-provider') return `export function useAuth() { return ${fixture}.auth; }`;
        if (id === '\0fixture:react-router') return `export { Link, Navigate } from 'react-router';
          export function useLocation() { return { state: { returnTo: '/mis-citas' } }; }
          export function useNavigate() { return (...args) => ${fixture}.navigation.push(args); }`;
        if (id === '\0fixture:./google-button') return `import { createElement } from 'react';
          import { GoogleButton as Real } from '/src/features/auth/google-button.tsx';
          export function GoogleButton(props) { ${fixture}.button = props; return createElement(Real, props); }`;
      },
    }],
  });
  fixture.auth = { status: 'anonymous', register: async (input) => fixture.calls.push(input), loginGoogle() {}, login() {} };
  fixture.render = async (name) => {
    fixture.button = undefined;
    const module = await vite.ssrLoadModule(`/src/features/auth/${name}-page.tsx`);
    return renderToStaticMarkup(createElement(MemoryRouter, null, createElement(module[name === 'register' ? 'RegisterPage' : 'LoginPage'])));
  };
  fixture.close = async () => { await vite.close(); delete globalThis.__googleRegistrationFixture; };
  return fixture;
}

test('registration preserves local fields and explains Google only when configured; login keeps its button', async () => {
  for (const clientId of ['', 'test-web.apps.googleusercontent.com']) {
    const f = await pages(clientId);
    try {
      const html = await f.render('register');
      for (const field of ['firstName', 'lastName', 'email', 'password']) assert.ok(html.includes(`name="${field}"`));
      assert.match(html, /Crear cuenta/); assert.match(html, /href="\/login"/);
      if (clientId) {
        assert.match(html, /auth-divider/); assert.match(html, /También puedes crear o acceder a tu cuenta con Google/);
        assert.match(html, /Continuar con Google/); assert.equal(f.button.disabled, false);
      } else {
        assert.doesNotMatch(html, /Google|auth-divider/); assert.equal(f.button, undefined);
      }
      const login = await f.render('login');
      assert.match(login, /name="email"/); assert.match(login, /name="password"/);
      assert.equal(login.includes('Continuar con Google'), Boolean(clientId));
    } finally { await f.close(); }
  }
});

test('registration and existing login wire GIS to the same session, navigate safely and never auto-link', async () => {
  const f = await pages('test-web.apps.googleusercontent.com');
  try {
    for (const name of ['register', 'login']) {
      for (const conflict of [false, true]) {
        const calls = [], saved = [];
        const session = createAuthSession({
          publicApi: { request: async (path, options) => {
            calls.push({ path, options });
            if (conflict) throw new ApiError(409, 'GOOGLE_ACCOUNT_LINK_REQUIRED');
            return { accessToken: 'internal-access', refreshToken: 'internal-refresh', tokenType: 'Bearer' };
          } },
          authenticatedApi: () => ({ request: async () => ({ data: {
            id: 'test-user', email: 'test@example.test', firstName: 'Ana', lastName: 'Pérez',
            status: 'ACTIVE', roles: [], permissions: [], context: {},
          } }) }),
          storage: { read() {}, write: (value) => saved.push(value), clear() {} },
        });
        await session.restore();
        f.auth = { ...session.getSnapshot(), loginGoogle: session.loginGoogle };
        f.navigation = [];
        await f.render(name);
        f.button.onCredential('transient-google-credential');
        await new Promise((resolve) => setImmediate(resolve));
        assert.deepEqual(calls.map((call) => call.path), ['auth/google']);
        assert.deepEqual(calls[0].options.body, { credential: 'transient-google-credential' });
        assert.equal(session.getSnapshot().status, conflict ? 'anonymous' : 'authenticated');
        assert.deepEqual(saved, conflict ? [] : ['internal-refresh']);
        assert.deepEqual(f.navigation, conflict ? [] : [[name === 'register' ? '/' : '/mis-citas', { replace: true }]]);
      }
    }
  } finally { await f.close(); }
});
