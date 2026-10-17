import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { assertE2ETarget, assertE2EIdentity, createE2EEnvironment, connectE2E,
  initializeE2EProcess, assertVerifiedE2EProcess, assertE2EFixtureDatabase,
  loopbackFetch, identitySql } from '../scripts/e2e-docker-environment.mjs';
import { loadApiEnvironment, assertSafeLocalDatabaseUrl } from './e2e/local-environment.mjs';
import { cleanupCheckpointFixtures, createCheckpointFixtures } from './e2e/fixture.mjs';

const password = 'a'.repeat(64); // Synthetic test value, never a local credential.
const environment = () => createE2EEnvironment({ E2E_DB_PASSWORD: password }, {});
const identity = () => ({ database: 'citajusta_e2e', username: 'citajusta_e2e', version: 180000,
  port: 5432, marker: 'citajusta-e2e-docker-v1' });
function mockClient(row = identity()) {
  const calls = [];
  return { calls, async connect() { calls.push('connect'); }, async end() { calls.push('end'); },
    async query(sql) { calls.push(sql); return { rows: sql === identitySql ? [row] : [] }; } };
}

test('E2E environment never inherits database, preload hooks or real provider credentials', () => {
  const env = createE2EEnvironment({ E2E_DB_PASSWORD: password }, { DATABASE_URL: 'do-not-inherit',
    NODE_OPTIONS: '--import=unsafe', PGHOST: 'remote', RESEND_API_KEY: 'private', GOOGLE_CLIENT_ID: 'private', Path: 'bin' });
  assert.equal(env.Path, 'bin'); assert.equal(env.NODE_ENV, 'test');
  assert.notEqual(env.DATABASE_URL, 'do-not-inherit');
  for (const key of ['NODE_OPTIONS', 'PGHOST', 'RESEND_API_KEY', 'GOOGLE_CLIENT_ID']) assert.equal(env[key], undefined);
  for (const key of ['EMAIL_DELIVERY_ENABLED', 'GOOGLE_AUTH_ENABLED', 'GOOGLE_CALENDAR_ENABLED', 'OFFER_EXPIRATION_ENABLED']) assert.equal(env[key], 'false');
  assert.notEqual(env.JWT_ACCESS_SECRET, env.JWT_REFRESH_SECRET);
  assert.ok(assertE2ETarget(env));
});

test('configuration rejects production, missing/weak password and unexpected env keys without leaking values', () => {
  for (const settings of [{}, { E2E_DB_PASSWORD: 'short' }, { E2E_DB_PASSWORD: password, DATABASE_URL: 'secret-url' }]) {
    assert.throws(() => createE2EEnvironment(settings, {}), (error) => !error.message.includes('secret-url') && !error.message.includes(password));
  }
  assert.throws(() => createE2EEnvironment({ E2E_DB_PASSWORD: password }, { NODE_ENV: 'production' }));
});

for (const database of ['citajusta_dev', 'citajusta_docker', 'citajusta_test', 'citajusta_e2e_other']) {
  test(`target rejects ${database} before creating a connection`, async () => {
    const env = environment(); env.DATABASE_URL = env.DATABASE_URL.replace('/citajusta_e2e?', `/${database}?`);
    let created = false;
    await assert.rejects(connectE2E(env, () => { created = true; }), /Only Docker E2E/);
    assert.equal(created, false);
  });
}

for (const [field, value] of [['hostname', 'localhost'], ['hostname', 'remote.example.test'], ['port', '5432'],
  ['port', '15433'], ['username', 'postgres'], ['search', '?schema=public&sslmode=disable'], ['hash', '#unsafe'], ['password', 'short']]) {
  test(`target rejects altered ${field} (${value})`, () => {
    const env = environment(), url = new URL(env.DATABASE_URL); url[field] = value; env.DATABASE_URL = url.href;
    assert.throws(() => assertE2ETarget(env), /Only Docker E2E/);
  });
}

test('target rejects absent URL and non-test mode', () => {
  assert.throws(() => assertE2ETarget({}), /Invalid Docker E2E/);
  assert.throws(() => assertE2ETarget({ ...environment(), NODE_ENV: 'development' }));
});

for (const overrides of [{ database: 'citajusta_dev' }, { database: 'citajusta_docker' }, { username: 'postgres' },
  { version: 170000 }, { version: 190000 }, { version: undefined }, { port: 15432 }, { marker: 'citajusta-capstone-docker-v1' }, { marker: null }]) {
  test(`real identity mismatch is rejected (${Object.keys(overrides)[0]}=${Object.values(overrides)[0]})`, () => {
    assert.throws(() => assertE2EIdentity({ ...identity(), ...overrides }), /identity\/marker mismatch/);
  });
}

test('identity preflight uses only read-only queries and always ends its transaction', async () => {
  const client = mockClient();
  assert.equal(await connectE2E(environment(), () => client), client);
  assert.deepEqual(client.calls, ['connect', 'BEGIN READ ONLY', identitySql, 'ROLLBACK']);
  await client.end();
});

test('wrong real database rolls back/closes and suppresses provider details', async () => {
  const client = mockClient({ ...identity(), database: 'citajusta_dev' });
  await assert.rejects(connectE2E(environment(), () => client), /Details omitted/);
  assert.deepEqual(client.calls.slice(-2), ['ROLLBACK', 'end']);
  const broken = mockClient(); broken.connect = async () => { throw new Error(`private:${password}`); };
  await assert.rejects(connectE2E(environment(), () => broken), (error) => !error.message.includes(password));
  assert.deepEqual(broken.calls, ['end']);
});

test('loader fails closed without preflight, ignores API .env, rejects changed target and foreign cleanup client', async () => {
  const saved = { ...process.env }, previousDirectory = process.cwd();
  const directory = await mkdtemp(join(tmpdir(), 'citajusta-e2e-test-'));
  try {
    process.chdir(directory); Object.assign(process.env, environment());
    assert.throws(() => loadApiEnvironment(), /preflight missing/);
    const prisma = { async $queryRawUnsafe(sql) { assert.equal(sql, identitySql); return [{ ...identity(), database: 'citajusta_dev' }]; } };
    await assert.rejects(cleanupCheckpointFixtures(prisma), /preflight missing/);
    await initializeE2EProcess(process.env, () => mockClient());
    loadApiEnvironment(); assertVerifiedE2EProcess(); assertSafeLocalDatabaseUrl(process.env.DATABASE_URL);
    assert.equal(process.env.EMAIL_DELIVERY_ENABLED, 'false');
    await assert.rejects(assertE2EFixtureDatabase(prisma), /identity\/marker mismatch/);
    await assert.rejects(cleanupCheckpointFixtures(prisma), /identity\/marker mismatch/);
    await assert.rejects(createCheckpointFixtures(prisma, 'unused'), /identity\/marker mismatch/);
    process.env.DATABASE_URL = environment().DATABASE_URL.replace('/citajusta_e2e?', '/citajusta_dev?');
    assert.throws(() => loadApiEnvironment(), /Only Docker E2E/);
    Object.assign(process.env, environment());
    await writeFile(join(directory, '.env'), 'DATABASE_URL=do-not-load\n');
    assert.throws(() => loadApiEnvironment(), /preflight missing or changed/);
    await assert.rejects(initializeE2EProcess(process.env, () => { throw new Error('must not connect'); }), /empty working directory/);
    assert.equal(process.env.DATABASE_URL, environment().DATABASE_URL);
  } finally {
    process.chdir(previousDirectory);
    for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
    Object.assign(process.env, saved);
    await rm(directory, { recursive: true }); // Exact mkdtemp directory owned by this test.
  }
});

test('external fetch and redirects are blocked; loopback HTTP is preserved', async () => {
  const calls = [], fetch = loopbackFetch(async (...args) => { calls.push(args); return 'ok'; });
  assert.equal(await fetch('http://127.0.0.1:12345/api/v1/appointments', { method: 'GET' }), 'ok');
  assert.equal(calls[0][1].redirect, 'error');
  for (const url of ['https://api.resend.com/emails', 'https://www.googleapis.com', 'http://localhost:3000', 'http://user:pass@127.0.0.1:12345']) {
    assert.throws(() => fetch(url), /External fetch is disabled/);
  }
  assert.equal(calls.length, 1);
});
