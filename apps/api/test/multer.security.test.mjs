import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { request } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { test } from 'node:test';

const fixtureUrl = new URL('./fixtures/multer-server.mjs', import.meta.url);
const boundary = 'citajusta-isolated-multer-probe';
function multipart(parts, { truncated = false } = {}) {
  const chunks = parts.map(({ name, filename, value }) =>
    `--${boundary}\r\nContent-Disposition: form-data; name="${name}"${filename ? `; filename="${filename}"` : ''}\r\n` +
    `${filename ? 'Content-Type: text/plain\r\n' : ''}\r\n${value}\r\n`);
  return Buffer.from(chunks.join('') + (truncated ? `--${boundary}\r\nInvalid header` : `--${boundary}--\r\n`));
}

async function startFixture(t) {
  const child = fork(fixtureUrl, [], { silent: true, windowsHide: true, execArgv: [],
    env: { NODE_ENV: 'test', ...(process.platform === 'win32' ? { SystemRoot: process.env.SystemRoot } : {}) } });
  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', chunk => { stderr += chunk; });
  child.stdout.resume();
  t.after(async () => {
    if (child.exitCode !== null || child.signalCode !== null) {
      assert.equal(child.exitCode, 0, stderr);
      assert.equal(child.signalCode, null, stderr);
      return;
    }
    const exited = once(child, 'exit');
    const timer = setTimeout(() => child.kill(), 5000);
    try {
      if (child.connected) child.send('shutdown'); else child.kill();
      const [code, signal] = await exited;
      assert.equal(code, 0, stderr);
      assert.equal(signal, null, stderr);
    } finally { clearTimeout(timer); }
  });
  const [ready] = await once(child, 'message', { signal: AbortSignal.timeout(10_000) });
  assert.ok(Number.isInteger(ready.port) && ready.port > 0);
  async function send(path, body) {
    return new Promise((resolve, reject) => {
      const req = request({ hostname: '127.0.0.1', port: ready.port, path: `/api/v1/upload-probe/${path}`,
        method: body ? 'POST' : 'GET', agent: false,
        headers: body ? { 'Content-Type': `multipart/form-data; boundary=${boundary}`, 'Content-Length': body.length } : {},
      }, response => {
        const chunks = [];
        response.on('data', chunk => chunks.push(chunk));
        response.on('error', reject);
        response.on('end', () => resolve({ status: response.statusCode, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) }));
      });
      req.on('error', reject);
      req.setTimeout(5000, () => req.destroy(new Error('Local Multer fixture request timed out')));
      req.end(body);
    });
  }
  return { send, async health() {
    // Observe callbacks/errors arriving after the HTTP response; do not intercept uncaught errors.
    await delay(300);
    assert.equal(child.exitCode, null, stderr);
    assert.equal(child.signalCode, null, stderr);
    const response = await send('health');
    assert.equal(response.status, 200);
    assert.equal(response.body.status, 'ok');
    return response.body.filters;
  } };
}

test('Nest 12.0.4 FileInterceptor accepts an in-memory multipart file and text field with overridden Multer', { timeout: 15_000 }, async t => {
  const fixture = await startFixture(t);
  const response = await fixture.send('single', multipart([
    { name: 'label', value: 'CitaJusta' }, { name: 'file', filename: 'sample.txt', value: 'hello' },
  ]));
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { name: 'sample.txt', content: 'hello', label: 'CitaJusta' });
  await fixture.health();
});

test('Nest FileInterceptor still maps Multer file-size limits to HTTP 413', { timeout: 15_000 }, async t => {
  const fixture = await startFixture(t);
  const response = await fixture.send('single', multipart([{ name: 'file', filename: 'large.txt', value: 'x'.repeat(65) }]));
  assert.equal(response.status, 413);
  await fixture.health();
});

test('Nest FileInterceptor still rejects an unexpected file field with HTTP 400', { timeout: 15_000 }, async t => {
  const fixture = await startFixture(t);
  const response = await fixture.send('single', multipart([{ name: 'unexpected', filename: 'sample.txt', value: 'hello' }]));
  assert.equal(response.status, 400);
  await fixture.health();
});

test('GHSA-q7qp-rjg7-q26m: pending async filter after rejection and malformed multipart does not terminate the disposable process', { timeout: 15_000 }, async t => {
  const fixture = await startFixture(t);
  const response = await fixture.send('race', multipart([
    { name: 'files', filename: 'pending.txt', value: 'x'.repeat(20_000) },
    { name: 'files', filename: 'reject.txt', value: 'rejected' },
  ], { truncated: true }));
  assert.equal(response.status, 400);
  assert.equal(response.body.message, 'Rejected test upload');
  assert.deepEqual(await fixture.health(), { pending: 1, completed: 1, rejected: 1 });
});
