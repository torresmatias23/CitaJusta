import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { createServer } from 'vite';

const oldProxy = process.env.API_PROXY_TARGET;
process.env.API_PROXY_TARGET = 'http://localhost:3000';
const vite = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom' });
if (oldProxy === undefined) delete process.env.API_PROXY_TARGET; else process.env.API_PROXY_TARGET = oldProxy;
after(() => vite.close());
const { recoveryApi, recoveryError, readRecoveryToken, removeRecoveryFragment, recoveryConfirmation } = await vite.ssrLoadModule('/src/features/auth/account-recovery-api.ts');
const { ForgotPasswordPage, ResetPasswordPage } = await vite.ssrLoadModule('/src/features/auth/account-recovery-pages.tsx');
const { ApiError } = await vite.ssrLoadModule('/src/lib/http-client.ts');
const { AppRoutes } = await vite.ssrLoadModule('/src/routes/app-routes.tsx');
const { AuthProvider } = await vite.ssrLoadModule('/src/features/auth/auth-provider.tsx');
const token = 'a'.repeat(43);

test('recovery client uses only public auth endpoints and exact controlled bodies', async () => {
  const calls = [], api = recoveryApi({ request: async (...args) => { calls.push(args); return { message: recoveryConfirmation }; } });
  await api.request(' PERSON@EXAMPLE.TEST '); await api.reset(token, 'A-new-test-password');
  assert.deepEqual(calls, [['auth/forgot-password', { method: 'POST', body: { email: 'person@example.test' } }],
    ['auth/reset-password', { method: 'POST', body: { token, password: 'A-new-test-password' } }]]);
});
test('token accepts only a single valid fragment value, never query/path content', () => {
  assert.equal(readRecoveryToken(`#token=${token}`), token);
  for (const value of ['', '#token=short', `?token=${token}`, `#token=${token}&token=${token}`, `#token=${token}&userId=1`, '#token=%3Cscript%3E']) assert.equal(readRecoveryToken(value), '');
});
test('fragment removal uses replaceState without storing token in state or changing the current path', () => {
  const calls = [], state = { retained: true };
  removeRecoveryFragment({ pathname: '/restablecer-contrasena', search: '' }, { state, replaceState: (...args) => calls.push(args) });
  assert.deepEqual(calls, [[state, '', '/restablecer-contrasena']]); assert.ok(!JSON.stringify(calls).includes(token));
});
test('errors are sanitized and distinguish unusable link/policy from temporary service failure', () => {
  assert.match(recoveryError(new ApiError(400)), /venció.*utilizado/);
  for (const error of [new ApiError(503), new Error(`private ${token}`)]) {
    assert.match(recoveryError(error), /más tarde/); assert.ok(!recoveryError(error).includes(token));
  }
});
test('request page is accessible, public, and never promises delivery to a known account', () => {
  const html = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(ForgotPasswordPage)));
  assert.match(html, /<h1[^>]*>Recupera tu cuenta/); assert.match(html, /for="recovery-email"/);
  assert.match(html, /type="email"/); assert.match(html, /Solicitar recuperación/); assert.doesNotMatch(html, /Google|token=|localStorage|sessionStorage/);
});
test('missing token renders controlled error and request-new-link, not password fields', () => {
  const html = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(ResetPasswordPage)));
  assert.match(html, /role="alert"/); assert.match(html, /Solicitar otro enlace/); assert.doesNotMatch(html, /type="password"|token=/);
});

test('valid token stays in component memory and never appears in markup, form action or links', () => {
  const previous = globalThis.window;
  globalThis.window = { location: { hash: `#token=${token}` } };
  try {
    const html = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(ResetPasswordPage)));
    assert.match(html, /for="reset-password"/); assert.match(html, /for="reset-confirmation"/);
    assert.match(html, /minLength="12"/); assert.match(html, /maxLength="128"/);
    assert.ok(!html.includes(token)); assert.doesNotMatch(html, /type="hidden"/);
  } finally { if (previous === undefined) delete globalThis.window; else globalThis.window = previous; }
});
test('recovery pages are reachable without ProtectedRoute, and login exposes recovery link', () => {
  const render = path => renderToStaticMarkup(createElement(MemoryRouter, { initialEntries: [path] }, createElement(AuthProvider, null, createElement(AppRoutes))));
  assert.match(render('/recuperar-cuenta'), /Solicitar recuperación/);
  assert.match(render('/restablecer-contrasena'), /Solicitar otro enlace/);
});
