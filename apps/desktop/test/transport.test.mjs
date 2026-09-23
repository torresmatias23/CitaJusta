import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { mockIPC, clearMocks } from '@tauri-apps/api/mocks';
import { createDesktopHttpClient } from '../src/lib/desktop-http.ts';

test('cliente compartido usa IPC Tauri, sin fetch WebView; maxRedirections nativo es cero', async () => {
  const previous = globalThis.window;
  const originalFetch = globalThis.fetch;
  globalThis.window = {};
  const calls = [];
  globalThis.fetch = () => { throw new Error('No usar WebView fetch'); };
  try {
    mockIPC((command, payload) => { calls.push({ command, payload }); throw new Error('IPC test stop'); });
    const api = createDesktopHttpClient('http://localhost:3000/api/v1', () => 'test-access');
    await assert.rejects(api.request('users/me'), /IPC test stop/);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].command, 'plugin:http|fetch');
    const config = calls[0].payload.clientConfig;
    assert.equal(config.url, 'http://localhost:3000/api/v1/users/me');
    assert.equal(config.maxRedirections, 0);
    assert.equal(new Headers(config.headers).get('Authorization'), 'Bearer test-access');
    await assert.rejects(api.request('../escape'));
    assert.equal(calls.length, 1);
  } finally {
    clearMocks();
    if (previous === undefined) delete globalThis.window; else globalThis.window = previous;
    globalThis.fetch = originalFetch;
  }
});

test('capability HTTP local y configuración de redirects no conceden permisos globales ni storage', async () => {
  const capability = JSON.parse(await readFile(new URL('../src-tauri/capabilities/default.json', import.meta.url), 'utf8'));
  assert.deepEqual(capability.permissions, ['core:default', { identifier: 'http:default', allow: [{ url: 'http://localhost:3000/api/v1/**' }] }]);
  const config = JSON.parse(await readFile(new URL('../src-tauri/tauri.conf.json', import.meta.url), 'utf8'));
  assert.equal(config.plugins.http.scopeRedirects, true);
});
