import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { test } from 'node:test';

// Opt-in HTTP test of the real Nginx config, with an in-container fake upstream.
// No Compose, external network calls, PostgreSQL, real API or existing container changes.
test('Nginx runtime framing, caching and header ownership with a simulated upstream', {
  skip: process.env.CITAJUSTA_NGINX_TEST !== '1' ? 'Opt in with CITAJUSTA_NGINX_TEST=1 and a cached Nginx image' : false,
  timeout: 45_000,
}, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'citajusta-nginx-'));
  let container;
  const docker = args => {
    const result = spawnSync('docker', args, { encoding: 'utf8', windowsHide: true, timeout: 15_000 });
    assert.equal(result.status, 0, `Docker test command failed (${args[0]}); verify the daemon/cached Nginx image.`);
    return result.stdout.trim();
  };
  t.after(async () => {
    try { if (container) docker(['rm', '--force', container]); }
    finally {
      const absolute = resolve(directory);
      assert.equal(dirname(absolute), resolve(tmpdir())); assert.match(basename(absolute), /^citajusta-nginx-/);
      await rm(absolute, { recursive: true, force: true });
    }
  });
  const configuration = await readFile(new URL('../web/nginx.conf', import.meta.url), 'utf8');
  const mock = `server {
    listen 3000;
    default_type application/json;
    add_header X-Powered-By "mock-framework" always;
    add_header X-Content-Type-Options "mock-nosniff" always;
    add_header Referrer-Policy "mock-referrer" always;
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header Content-Security-Policy "default-src 'self'" always;
    add_header Cache-Control "public" always;
    add_header Access-Control-Allow-Origin $http_origin always;
    add_header Vary "Origin" always;
    add_header Retry-After "60" always;
    location = /health { return 200 '{"status":"ok"}'; }
    ${[200, 400, 401, 404, 429, 500].map(status => `location = /api/v1/status/${status} { return ${status} '{"statusCode":${status}}'; }`).join('\n')}
  }
  `;
  assert.equal(configuration.split('  upstream citajusta_api {').length, 2);
  await writeFile(join(directory, 'nginx.conf'), configuration.replace('  upstream citajusta_api {', `${mock}  upstream citajusta_api {`));
  const html = join(directory, 'html'); await mkdir(join(html, 'assets'), { recursive: true });
  await writeFile(join(html, 'index.html'), '<!doctype html><title>CitaJusta test fixture</title>');
  await writeFile(join(html, 'assets', 'test.js'), '/* public fixture */');
  const id = docker(['create', '--pull=never', '--name', `citajusta-http-security-${randomUUID()}`,
    '--user', 'nginx', '--read-only', '--tmpfs', '/tmp', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges:true',
    '--add-host', 'api:127.0.0.1', '--publish', '127.0.0.1::8080',
    '--mount', `type=bind,source=${join(directory, 'nginx.conf')},target=/etc/nginx/nginx.conf,readonly`,
    '--mount', `type=bind,source=${html},target=/usr/share/nginx/html,readonly`, '--entrypoint', 'nginx',
    process.env.CITAJUSTA_NGINX_TEST_IMAGE || 'nginx:stable-alpine', '-g', 'daemon off;']);
  assert.match(id, /^[a-f0-9]{64}$/); container = id;
  docker(['start', container]); docker(['exec', container, 'nginx', '-t']);
  const binding = docker(['port', container, '8080/tcp']); assert.match(binding, /^127\.0\.0\.1:\d+$/);
  const origin = `http://${binding}`;
  let ready = false;
  for (let i = 0; i < 40; i++) {
    try { const response = await fetch(`${origin}/index.html`, { signal: AbortSignal.timeout(1000) }); await response.text(); if (response.ok) { ready = true; break; } }
    catch { /* Wait only for our newly created container. */ }
    await delay(100);
  }
  assert.equal(ready, true, 'Isolated Nginx fixture did not start');
  function security(response) {
    assert.equal(response.headers.get('x-powered-by'), null);
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(response.headers.get('referrer-policy'), 'strict-origin-when-cross-origin');
    assert.equal(response.headers.get('x-frame-options'), 'DENY');
    assert.equal(response.headers.get('content-security-policy'), "frame-ancestors 'none'");
    assert.equal(response.headers.get('strict-transport-security'), null);
  }
  await t.test('proxied 200/400/401/404/429/500 get exactly one edge-owned security header and retain upstream CORS', async () => {
    for (const status of [200, 400, 401, 404, 429, 500]) {
      const response = await fetch(`${origin}/api/v1/status/${status}`, { headers: { Origin: 'https://web.example.test' } });
      assert.equal(response.status, status); security(response);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.equal(response.headers.get('access-control-allow-origin'), 'https://web.example.test');
      assert.equal(response.headers.get('vary'), 'Origin');
      if (status === 429) assert.equal(response.headers.get('retry-after'), '60');
      await response.text();
    }
  });
  await t.test('SPA, index, public assets, missing asset and health retain headers and their own caching policy', async () => {
    for (const [path, status, cache] of [['/', 200, 'no-cache'], ['/mis-citas', 200, 'no-cache'],
      ['/index.html', 200, 'no-cache'], ['/assets/test.js', 200, null], ['/assets/missing.js', 404, null], ['/health', 200, null]]) {
      const response = await fetch(`${origin}${path}`); assert.equal(response.status, status); security(response);
      assert.equal(response.headers.get('cache-control'), cache); await response.text();
    }
  });
  await t.test('Nginx-generated API body-limit errors preserve edge headers and no-store', async () => {
    const response = await fetch(`${origin}/api/v1/status/200`, { method: 'POST', body: 'x'.repeat(1024 * 1024 + 1) });
    assert.equal(response.status, 413); security(response); assert.equal(response.headers.get('cache-control'), 'no-store'); await response.text();
  });
});
