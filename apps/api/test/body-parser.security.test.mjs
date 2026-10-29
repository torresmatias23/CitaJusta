import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { request } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { deflateSync, gzipSync } from 'node:zlib';
import { test } from 'node:test';

const probePath = '/api/v1/parser-probe';
const fixtureUrl = new URL('./fixtures/body-parser-server.mjs', import.meta.url);
const sample = { message: 'CitaJusta: información', nested: { enabled: true }, ids: [1, 2] };

async function startFixture(t) {
  const child = fork(fixtureUrl, [], {
    silent: true,
    windowsHide: true,
    execArgv: [],
    env: { NODE_ENV: 'test', ...(process.platform === 'win32' ? { SystemRoot: process.env.SystemRoot } : {}) },
  });
  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  child.stdout.resume();

  t.after(async () => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    const exited = once(child, 'exit');
    const timer = setTimeout(() => child.kill(), 5000);
    try {
      if (child.connected) child.send('shutdown');
      else child.kill();
      const [code, signal] = await exited;
      assert.equal(code, 0, stderr);
      assert.equal(signal, null, stderr);
    } finally { clearTimeout(timer); }
  });

  const [ready] = await once(child, 'message', { signal: AbortSignal.timeout(10_000) });
  assert.ok(Number.isInteger(ready.port) && ready.port > 0);
  return {
    port: ready.port,
    async assertHealthy() {
      // Decoder errors can arrive after the first response; do not hide uncaught errors.
      await delay(250);
      assert.equal(child.exitCode, null, stderr);
      assert.equal(child.signalCode, null, stderr);
      const response = await send(ready.port, { path: `${probePath}/health` });
      assert.equal(response.status, 200, stderr);
      assert.deepEqual(JSON.parse(response.body), { status: 'ok' });
    },
  };
}

function send(port, { path = probePath, body, contentType = 'application/json', encoding } = {}) {
  return new Promise((resolve, reject) => {
    // The caller can select only a port belonging to this test's loopback fixture.
    const req = request({
      hostname: '127.0.0.1', port, path, method: body === undefined ? 'GET' : 'POST', agent: false,
      headers: body === undefined ? {} : {
        'Content-Type': contentType,
        'Content-Length': body.length,
        ...(encoding ? { 'Content-Encoding': encoding } : {}),
      },
    }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('error', reject);
      response.on('end', () => resolve({ status: response.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.setTimeout(5000, () => req.destroy(new Error('Local parser fixture request timed out')));
    req.end(body);
  });
}

test('Nest Express preserves ordinary JSON parsing', { timeout: 15_000 }, async (t) => {
  const fixture = await startFixture(t);
  const response = await send(fixture.port, { body: Buffer.from(JSON.stringify(sample)) });
  assert.equal(response.status, 200);
  assert.deepEqual(JSON.parse(response.body), sample);
  await fixture.assertHealthy();
});

for (const [encoding, compress] of [['gzip', gzipSync], ['deflate', deflateSync]]) {
  test(`Nest Express preserves valid ${encoding} JSON parsing`, { timeout: 15_000 }, async (t) => {
    const fixture = await startFixture(t);
    const response = await send(fixture.port, { body: compress(Buffer.from(JSON.stringify(sample))), encoding });
    assert.equal(response.status, 200);
    assert.deepEqual(JSON.parse(response.body), sample);
    await fixture.assertHealthy();
  });
}

test('Nest Express preserves URL-encoded form parsing', { timeout: 15_000 }, async (t) => {
  const fixture = await startFixture(t);
  const response = await send(fixture.port, {
    body: Buffer.from('name=CitaJusta&options%5Benabled%5D=true'),
    contentType: 'application/x-www-form-urlencoded',
  });
  assert.equal(response.status, 200);
  assert.deepEqual(JSON.parse(response.body), { name: 'CitaJusta', options: { enabled: 'true' } });
  await fixture.assertHealthy();
});

test('invalid gzip returns 400 and the isolated Nest process stays alive', { timeout: 15_000 }, async (t) => {
  const fixture = await startFixture(t);
  const response = await send(fixture.port, { body: Buffer.from('invalid gzip data'), encoding: 'gzip' });
  assert.equal(response.status, 400);
  await fixture.assertHealthy();
});

test('GHSA-27r3-jxmh-p828: trailing bytes after gzip cannot crash isolated Nest', { timeout: 15_000 }, async (t) => {
  const fixture = await startFixture(t);
  // The zero ends the gzip member; the remaining bytes reach the finished decoder.
  // Keep this regression in a child process, bound only to an ephemeral loopback port.
  const body = Buffer.concat([
    gzipSync(Buffer.from(JSON.stringify(sample))), Buffer.from([0]), Buffer.alloc(128 * 1024, 0x58),
  ]);
  const response = await send(fixture.port, { body, encoding: 'gzip' });
  assert.equal(response.status, 200);
  assert.deepEqual(JSON.parse(response.body), sample);
  await fixture.assertHealthy();
});
