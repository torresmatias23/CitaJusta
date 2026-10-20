import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { executeE2EAction, migrationStatus, parseArguments, runNode, stagePrismaConfiguration, suites, summarizeTapFailures, versionedMigrations, verifyProfilePreferencesMigration } from '../scripts/e2e-docker.mjs';

const manifest = [{ name: '001_first', relative: '001_first/migration.sql', checksum: 'checksum' }];
const applied = { migration_name: '001_first', checksum: 'checksum', finished_at: new Date(), rolled_back_at: null };
function history({ tables = [{ tablename: '_prisma_migrations' }], rows = [applied] } = {}) {
  const calls = [];
  return { calls, async query(sql) {
    calls.push(sql); return { rows: sql.includes('pg_tables') ? tables : sql.includes('SELECT migration_name') ? rows : [] };
  } };
}
function dependencies({ pending = 0, locked = true } = {}) {
  const calls = [], client = { async end() { calls.push('end'); }, async query(sql) { calls.push(sql); return { rows: [{ acquired: locked }] }; } };
  return { calls, connect: async () => { calls.push('identity'); return client; },
    manifest: async () => { calls.push('manifest'); return manifest; },
    status: async () => { calls.push('history'); return { applied: 1 - pending, pending }; },
    workspace: async () => { calls.push('workspace'); return 'owned-scratch'; },
    stage: async () => { calls.push('stage'); return 'isolated-config'; },
    run: (args, env, cwd, label) => { calls.push({ args, env, cwd, label }); },
    cleanup: async (directory) => { assert.equal(directory, 'owned-scratch'); calls.push('cleanup'); },
  };
}

test('runner arguments are explicit, allowlisted and never accept arbitrary files/commands', () => {
  assert.deepEqual(parseArguments([]), { action: 'check', suite: undefined });
  assert.deepEqual(parseArguments(['test', 'waitlist']), { action: 'test', suite: 'waitlist' });
  for (const args of [['reset'], ['db', 'push'], ['test'], ['test', '../unsafe'], ['migrate', '--force'], ['test', 'reassignment-demo']]) {
    assert.throws(() => parseArguments(args), /Usage/);
  }
  assert.equal(Object.keys(suites).length, 21);
});

test('every backend E2E npm entry point uses the verified runner and an existing suite', async () => {
  const { scripts, dependencies, devDependencies } = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  for (const [name, file] of Object.entries(suites)) {
    assert.equal(scripts[`test:e2e:${name}`], `node scripts/e2e-docker.mjs test ${name}`);
    assert.ok((await readFile(new URL(`e2e/${file}.e2e.test.mjs`, import.meta.url), 'utf8')).includes('loadApiEnvironment('));
  }
  assert.equal(Object.keys(scripts).filter((name) => name.startsWith('test:e2e:')).length, 21);
  assert.equal(devDependencies.prisma, '7.10.0'); assert.equal(dependencies['@prisma/client'], '7.10.0');
  assert.equal(dependencies['@prisma/adapter-pg'], '7.10.0');
});

test('legacy development tooling E2E fails closed before opening its development client', async () => {
  const source = await readFile(new URL('e2e/reassignment-demo.e2e.test.mjs', import.meta.url), 'utf8');
  assert.ok(source.indexOf('assertVerifiedE2EProcess();') < source.indexOf('const prisma = developmentClient();'));
  assert.match(source, /assertVerifiedE2EProcess\(\);/);
  assert.equal(Object.hasOwn(suites, 'reassignment-demo'), false);
});

test('manifest contains HEAD migrations plus exact approved additive migration, excluding retired local directories', async () => {
  const files = await versionedMigrations();
  assert.equal(files.filter((file) => file.relative.endsWith('/migration.sql')).length, 14);
  assert.ok(files.some((file) => file.relative === 'migration_lock.toml'));
  assert.ok(files.every((file) => !file.relative.includes('whatsapp')));
  assert.ok(files.every((file) => file.content instanceof Buffer));
});

test('uncommitted profile preferences migration is accepted only with its reviewed checksum', async () => {
  const bytes = await readFile(new URL('../prisma/migrations/20261019000000_user_profile_notification_preferences/migration.sql', import.meta.url));
  assert.equal(verifyProfilePreferencesMigration(bytes), bytes);
  assert.throws(() => verifyProfilePreferencesMigration(Buffer.concat([bytes, Buffer.from('SELECT 1;')])) , /checksum differs/);
});

test('temporary Prisma config preserves versioned SQL, uses original schema and stores no credentials/dotenv', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'citajusta-e2e-test-'));
  try {
    const files = [{ relative: '001_first/migration.sql', content: Buffer.from('SELECT 1;\n') },
      { relative: 'migration_lock.toml', content: Buffer.from('provider = "postgresql"\n') }];
    const config = await stagePrismaConfiguration(directory, files);
    const source = await readFile(config, 'utf8');
    assert.match(source, /process\.env\.DATABASE_URL/); assert.match(source, /schema\.prisma/);
    assert.doesNotMatch(source, /dotenv|postgresql:\/\/|password|citajusta_dev/);
    assert.deepEqual((await readdir(join(directory, 'migrations'))).sort(), ['001_first', 'migration_lock.toml']);
    assert.equal(await readFile(join(directory, 'migrations/001_first/migration.sql'), 'utf8'), 'SELECT 1;\n');
  } finally { await rm(directory, { recursive: true }); }
});

test('migration status is read-only, accepts empty database and exact finished history', async () => {
  const empty = history({ tables: [] });
  assert.deepEqual(await migrationStatus(empty, manifest), { applied: 0, pending: 1 });
  const complete = history();
  assert.deepEqual(await migrationStatus(complete, manifest), { applied: 1, pending: 0 });
  for (const client of [empty, complete]) {
    assert.equal(client.calls[0], 'BEGIN READ ONLY'); assert.equal(client.calls.at(-1), 'ROLLBACK');
    assert.ok(client.calls.every((sql) => /^(SELECT|BEGIN READ ONLY|ROLLBACK)/.test(sql)));
  }
});

for (const row of [{ ...applied, checksum: 'changed' }, { ...applied, finished_at: null },
  { ...applied, rolled_back_at: new Date() }, { ...applied, migration_name: 'retired_whatsapp' }]) {
  test(`incompatible migration history rejected (${JSON.stringify(Object.keys(row).filter((key) => row[key] !== applied[key]))})`, async () => {
    const client = history({ rows: [row] });
    await assert.rejects(migrationStatus(client, manifest), /incompatible/);
    assert.equal(client.calls.at(-1), 'ROLLBACK');
  });
}

test('nonempty schema without valid history and duplicate/gapped migrations are rejected', async () => {
  await assert.rejects(migrationStatus(history({ tables: [{ tablename: 'usuarios' }] }), manifest), /without migration history/);
  await assert.rejects(migrationStatus(history({ rows: [applied, applied] }), manifest), /incompatible/);
  await assert.rejects(migrationStatus(history({ tables: [{ tablename: '_prisma_migrations' }, { tablename: 'usuarios' }], rows: [] }), manifest), /Untracked/);
});

test('check is read-only: no lock, temporary files, build, bootstrap, migration or test subprocess', async () => {
  const deps = dependencies();
  assert.deepEqual(await executeE2EAction(parseArguments(['check']), {}, deps), { applied: 1, pending: 0 });
  assert.deepEqual(deps.calls, ['identity', 'manifest', 'history', 'end']);
});

test('failed identity prevents history, migration, bootstrap and fixture/test execution', async () => {
  for (const args of [['migrate'], ['bootstrap'], ['test', 'waitlist']]) {
    const deps = dependencies(); deps.connect = async () => { throw new Error('identity rejected'); };
    await assert.rejects(executeE2EAction(parseArguments(args), {}, deps), /identity rejected/);
    assert.deepEqual(deps.calls, []);
  }
});

test('pending migrations or concurrent operation stop before any subprocess', async () => {
  for (const options of [{ pending: 1 }, { locked: false }]) {
    const deps = dependencies(options);
    await assert.rejects(executeE2EAction(parseArguments(['test', 'waitlist']), {}, deps), /pending|Another Docker E2E/);
    assert.ok(!deps.calls.includes('workspace')); assert.equal(deps.calls.at(-1), 'end');
  }
});

test('migrate uses only explicit deploy/config after identity/history/lock and rechecks', async () => {
  const deps = dependencies();
  await executeE2EAction(parseArguments(['migrate']), {}, deps);
  const commands = deps.calls.filter((call) => typeof call === 'object');
  assert.equal(commands.length, 1);
  assert.deepEqual(commands[0].args.slice(1), ['migrate', 'deploy', '--config', 'isolated-config']);
  assert.deepEqual(deps.calls.slice(0, 5), ['identity', 'manifest', 'history', 'SELECT pg_try_advisory_lock(20261017, 15432) AS acquired', 'history']);
  assert.deepEqual(deps.calls.slice(-3), ['history', 'end', 'cleanup']);
});

test('bootstrap runs only existing compiled catalog helpers after generation/build', async () => {
  const deps = dependencies();
  await executeE2EAction(parseArguments(['bootstrap']), {}, deps);
  const commands = deps.calls.filter((call) => typeof call === 'object');
  assert.deepEqual(commands.map(({ label }) => label), ['Prisma generate', 'API build', 'E2E catalogs bootstrap']);
  assert.match(commands[2].args[0], /e2e-docker-bootstrap\.mjs$/);
});

test('all 21 suites run sequentially with per-process preflight, isolated cwd and controlled env', async () => {
  const deps = dependencies(), env = { controlled: 'environment' };
  await executeE2EAction(parseArguments(['test', 'all']), env, deps);
  const commands = deps.calls.filter((call) => typeof call === 'object').slice(2);
  assert.equal(commands.length, 21);
  assert.deepEqual(commands.map(({ label }) => label), Object.keys(suites).map((name) => `E2E ${name}`));
  for (const command of commands) {
    assert.equal(command.args[0], '--import'); assert.match(command.args[1], /docker-preflight\.mjs$/);
    assert.ok(command.args.includes('--test-concurrency=1'));
    assert.equal(command.cwd, 'owned-scratch'); assert.equal(command.env, env);
  }
});

test('subprocess failure closes lock connection, removes owned scratch and stops subsequent suites', async () => {
  const deps = dependencies(); deps.run = () => { throw new Error('controlled failure'); };
  await assert.rejects(executeE2EAction(parseArguments(['test', 'all']), {}, deps), /controlled failure/);
  assert.deepEqual(deps.calls.slice(-2), ['end', 'cleanup']);
});

test('process output never relays a provider connection string or secret', () => {
  const messages = [], original = console.log;
  console.log = (message) => messages.push(message);
  try {
    assert.throws(() => runNode([], {}, 'scratch', 'E2E waitlist', () => ({ status: 1,
      stdout: 'postgresql://private:password@server/db\n# tests 3\n# pass 2\n# fail 1\n', stderr: 'private-token' })), /output withheld/);
    assert.deepEqual(messages, ['[E2E waitlist] tests 3', '[E2E waitlist] pass 2', '[E2E waitlist] fail 1']);
  } finally { console.log = original; }
});

test('TAP diagnostics identify child and parent by index/location without forwarding their runtime titles', () => {
  const output = `    not ok 7 - private-runtime-title
      ---
      location: 'C:\\private\\audit.e2e.test.mjs:167:13'
      failureType: 'testCodeFailure'
      error: |-
        private-response SQL password token
        actual: 123
      code: 'ERR_ASSERTION'
      expected: 200
      actual: 409
      ...
not ok 1 - another-private-title
  ---
  failureType: 'subtestsFailed'
  code: 'ERR_TEST_FAILURE'
  ...`;
  assert.deepEqual(summarizeTapFailures(output), [
    { index: 7, depth: 1, location: 'audit.e2e.test.mjs:167:13', failureType: 'testCodeFailure', code: 'ERR_ASSERTION', expected: '200', actual: '409' },
    { index: 1, depth: 0, failureType: 'subtestsFailed', code: 'ERR_TEST_FAILURE' },
  ]);
});

test('TAP diagnostics discard secret strings, structured payloads, unknown files/codes and arbitrary numbers', () => {
  const result = summarizeTapFailures(`not ok 2 - postgresql://user:password@private/db
  ---
  location: '/private/secret.e2e.test.mjs:10:2'
  error: 'private-token'
  code: 'private-code'
  expected: 'private-credential'
  actual: 1234
  expected: 1234567890
  stack: |-
    code: 'P2003'
  ...
  actual: 503`);
  assert.deepEqual(result, [{ index: 2, depth: 0 }]);
  assert.doesNotMatch(JSON.stringify(result), /private|password|credential|1234|P2003/);
});

test('TAP diagnostics retain only allowlisted scalar assertions and Prisma error codes', () => {
  assert.deepEqual(summarizeTapFailures(`not ok 3 - untrusted
  ---
  code: 'P2003'
  expected: true
  actual: false
  ...`), [{ index: 3, depth: 0, code: 'P2003', expected: 'true', actual: 'false' }]);
});

test('runNode emits sanitized test diagnostics but never raw TAP or stderr', () => {
  const messages = [], original = console.log;
  console.log = (message) => messages.push(message);
  try {
    assert.throws(() => runNode(['--test'], {}, 'scratch', 'E2E audit', () => ({ status: 1,
      stdout: "not ok 10 - private-token\n  ---\n  code: 'ERR_ASSERTION'\n  expected: true\n  actual: false\n  ...\n# fail 1\n",
      stderr: 'postgresql://private:password@server/db' })), /output withheld/);
    assert.deepEqual(messages, ['[E2E audit] fail 1', '[E2E audit] failure {"index":10,"depth":0,"code":"ERR_ASSERTION","expected":"true","actual":"false"}']);
  } finally { console.log = original; }
});

test('Compose E2E configuration is independent, loopback only, secret-free and persistent', async () => {
  const compose = await readFile(new URL('../../../docker/e2e/compose.yaml', import.meta.url), 'utf8');
  assert.match(compose, /^name: citajusta-e2e/m); assert.match(compose, /postgres:18-bookworm/);
  assert.match(compose, /127\.0\.0\.1:15432:5432/); assert.match(compose, /pg_isready/);
  assert.match(compose, /postgres_data:\/var\/lib\/postgresql/); assert.match(compose, /E2E_DB_PASSWORD:\?/);
  assert.doesNotMatch(compose, /external:|container_name:|citajusta_dev|citajusta_docker|citajusta-capstone|DATABASE_URL|env_file:/);
  assert.match(await readFile(new URL('../../../docker/e2e/.env.example', import.meta.url), 'utf8'), /E2E_DB_PASSWORD=\n$/);
});
