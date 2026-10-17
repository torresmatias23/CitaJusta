import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mock, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { assertDockerTarget, DockerSetupError, prepareDockerDatabase, readMigrationManifest, verifyDockerDatabase } from '../api/migrate.mjs';

const password = 'a'.repeat(64);
const environment = { NODE_ENV: 'development', CITAJUSTA_DOCKER: 'development',
  DATABASE_URL: `postgresql://citajusta:${password}@db:5432/citajusta_docker?schema=public` };
const migrations = [{ name: '20260101000000_base', checksum: 'a'.repeat(64) }, { name: '20260102000000_next', checksum: 'b'.repeat(64) }];
const history = () => migrations.map(({ name, checksum }) => ({ migration_name: name, checksum, finished_at: new Date(), rolled_back_at: null }));
function fixture() {
  const state = { identity: { database: 'citajusta_docker', username: 'citajusta', version: 180000, marker: 'citajusta-capstone-docker-v1' }, tables: [], history: [] };
  const client = { connect: mock.fn(async () => undefined), end: mock.fn(async () => undefined), query: mock.fn(async (sql) => {
    assert.match(sql, /^(SELECT|BEGIN READ ONLY|ROLLBACK)/);
    if (sql.includes('FROM pg_database')) {
      assert.match(sql, /shobj_description\(oid, 'pg_database'\)/);
      return { rows: [state.identity] };
    }
    if (sql.includes('FROM pg_catalog.pg_tables')) return { rows: state.tables.map((tablename) => ({ tablename })) };
    if (sql.includes('FROM public._prisma_migrations')) return { rows: state.history };
    return { rows: [] };
  }) };
  const dependencies = { manifest: mock.fn(async () => migrations), client: mock.fn(() => client), run: mock.fn(() => {
    state.tables = ['_prisma_migrations', 'usuarios'];
    if (!state.history.length) state.history = history();
    return { status: 0 };
  }) };
  return { state, client, dependencies };
}

test('accepts only explicitly identified local Compose target, without leaking credentials', () => {
  assert.equal(assertDockerTarget(environment), environment.DATABASE_URL);
});
for (const [label, patch] of [
  ['production', { NODE_ENV: 'production' }], ['test', { NODE_ENV: 'test' }], ['missing marker flag', { CITAJUSTA_DOCKER: undefined }],
  ['missing URL', { DATABASE_URL: undefined }], ['invalid URL', { DATABASE_URL: 'private-password' }],
  ['host dev database', { DATABASE_URL: `postgresql://citajusta:${password}@localhost:5432/citajusta_dev` }],
  ['host gateway', { DATABASE_URL: environment.DATABASE_URL.replace('@db:', '@host.docker.internal:') }],
  ['remote database', { DATABASE_URL: environment.DATABASE_URL.replace('@db:', '@remote.example:') }],
  ['different database', { DATABASE_URL: environment.DATABASE_URL.replace('/citajusta_docker?', '/citajusta_dev?') }],
  ['different user', { DATABASE_URL: environment.DATABASE_URL.replace('//citajusta:', '//postgres:') }],
  ['different port', { DATABASE_URL: environment.DATABASE_URL.replace(':5432/', ':5433/') }],
  ['schema override', { DATABASE_URL: `${environment.DATABASE_URL}&options=unsafe` }],
  ['fragment', { DATABASE_URL: `${environment.DATABASE_URL}#private-password` }],
  ['short password', { DATABASE_URL: environment.DATABASE_URL.replace(password, 'private-password') }],
  ['URI encoded password', { DATABASE_URL: environment.DATABASE_URL.replace(password, `${password}%40`) }],
]) test(`unsafe target ${label} fails before filesystem, connection or Prisma`, async () => {
  const { dependencies } = fixture();
  await assert.rejects(prepareDockerDatabase({ ...environment, ...patch }, { ...dependencies, deploy: true }), (error) => {
    assert.ok(error instanceof DockerSetupError);
    assert.ok(!error.message.includes(password) && !error.message.includes('private-password'));
    return true;
  });
  assert.equal(dependencies.manifest.mock.callCount(), 0);
  assert.equal(dependencies.client.mock.callCount(), 0);
  assert.equal(dependencies.run.mock.callCount(), 0);
});

test('manifest hashes SQL bytes, orders directories and ignores ordinary files', async () => {
  const sql = new Map([['20260202/migration.sql', 'second'], ['20260101/migration.sql', 'first']]);
  const result = await readMigrationManifest(async () => [
    { name: '20260202', isDirectory: () => true }, { name: 'migration_lock.toml', isDirectory: () => false }, { name: '20260101', isDirectory: () => true },
  ], async (url) => sql.get(url.pathname.split('/').slice(-2).join('/')));
  assert.deepEqual(result, ['20260101', '20260202'].map((name, i) => ({ name, checksum: createHash('sha256').update(i === 0 ? 'first' : 'second').digest('hex') })));
});
test('missing SQL and empty migration manifest fail before connecting', async () => {
  await assert.rejects(readMigrationManifest(async () => []), /No versioned migrations/);
  await assert.rejects(readMigrationManifest(async () => [{ name: 'empty', isDirectory: () => true }], async () => { throw new Error('Missing SQL'); }), /Missing SQL/);
  const { dependencies } = fixture();
  await assert.rejects(prepareDockerDatabase(environment, { ...dependencies, manifest: async () => { throw new Error('Missing SQL'); } }), /Missing SQL/);
  assert.equal(dependencies.client.mock.callCount(), 0);
});
test('verifies real database identity in a read-only transaction before allowing empty initialization', async () => {
  const { client } = fixture();
  assert.deepEqual(await verifyDockerDatabase(client, migrations), { applied: 0, pending: 2 });
  assert.equal(client.query.mock.calls[0].arguments[0], 'BEGIN READ ONLY');
  assert.equal(client.query.mock.calls.at(-1).arguments[0], 'ROLLBACK');
});
for (const [field, value] of [['database', 'citajusta_dev'], ['username', 'postgres'], ['version', 170000], ['version', 190000], ['marker', null], ['marker', 'foreign']]) {
  test(`real identity mismatch ${field}=${value} prevents deployment and closes connection`, async () => {
    const { state, client, dependencies } = fixture(); state.identity[field] = value;
    await assert.rejects(prepareDockerDatabase(environment, { ...dependencies, deploy: true }), /identity\/marker mismatch/);
    assert.equal(dependencies.run.mock.callCount(), 0);
    assert.equal(client.query.mock.calls.at(-1).arguments[0], 'ROLLBACK');
    assert.equal(client.end.mock.callCount(), 1);
  });
}
test('nonempty untracked database is never adopted or reset', async () => {
  const { state, client, dependencies } = fixture(); state.tables = ['external_data'];
  await assert.rejects(prepareDockerDatabase(environment, { ...dependencies, deploy: true }), /without Prisma history/);
  assert.equal(dependencies.run.mock.callCount(), 0);
  assert.equal(client.end.mock.callCount(), 1);
});
for (const [label, mutate] of [
  ['unknown migration', (rows) => { rows[0].migration_name = 'experimental_whatsapp'; }],
  ['changed checksum', (rows) => { rows[0].checksum = 'changed'; }],
  ['incomplete migration', (rows) => { rows[0].finished_at = null; }],
  ['rolled back migration', (rows) => { rows[0].rolled_back_at = new Date(); }],
  ['duplicate history', (rows) => { rows.push({ ...rows[0] }); }],
]) test(`${label} prevents deploy without altering history`, async () => {
  const { state, dependencies } = fixture(); state.tables = ['_prisma_migrations', 'usuarios']; state.history = history(); mutate(state.history);
  const before = structuredClone(state);
  await assert.rejects(prepareDockerDatabase(environment, { ...dependencies, deploy: true }), /history incompatible/);
  assert.equal(dependencies.run.mock.callCount(), 0); assert.deepEqual(state, before);
});
test('existing schema with empty history fails closed', async () => {
  const { state, dependencies } = fixture(); state.tables = ['_prisma_migrations', 'usuarios'];
  await assert.rejects(prepareDockerDatabase(environment, { ...dependencies, deploy: true }), /Untracked Docker schema/);
  assert.equal(dependencies.run.mock.callCount(), 0);
});
test('API preflight is read-only by default and refuses pending migrations', async () => {
  const { dependencies, state } = fixture();
  await assert.rejects(prepareDockerDatabase(environment, dependencies), /migrations pending/);
  assert.equal(dependencies.run.mock.callCount(), 0); assert.deepEqual(state.tables, []);
  state.tables = ['_prisma_migrations', 'usuarios']; state.history = history();
  assert.deepEqual(await prepareDockerDatabase(environment, dependencies), { applied: 2, pending: 0 });
  assert.equal(dependencies.run.mock.callCount(), 0);
});
test('explicit deploy uses only installed Prisma migrate deploy, verifies result and is repeatable', async () => {
  const { client, dependencies, state } = fixture();
  assert.deepEqual(await prepareDockerDatabase(environment, { ...dependencies, deploy: true }), { applied: 2, pending: 0 });
  const after = structuredClone(state);
  assert.deepEqual(await prepareDockerDatabase(environment, { ...dependencies, deploy: true }), { applied: 2, pending: 0 });
  assert.deepEqual(state, after);
  assert.equal(dependencies.run.mock.callCount(), 2); assert.equal(client.end.mock.callCount(), 2);
  const [binary, args, options] = dependencies.run.mock.calls[0].arguments;
  assert.equal(binary, process.execPath); assert.match(args[0], /prisma[/\\]build[/\\]index\.js$/);
  assert.deepEqual(args.slice(1), ['migrate', 'deploy']); assert.match(options.cwd, /apps[/\\]api[/\\]$/);
  assert.equal(options.env.DATABASE_URL, environment.DATABASE_URL);
  assert.equal(options.timeout, 120000); assert.equal(options.encoding, 'utf8');
});
for (const result of [{ status: 1, stderr: 'private-password' }, { status: null, error: new Error('private-password') }]) {
  test('Prisma failure is controlled, not retried/reset and never relays child credentials', async () => {
    const { client, dependencies, state } = fixture(); dependencies.run.mock.mockImplementation(() => result);
    await assert.rejects(prepareDockerDatabase(environment, { ...dependencies, deploy: true }), (error) => {
      assert.match(error.message, /migrate deploy failed/); assert.ok(!error.message.includes('private-password')); return true;
    });
    assert.equal(dependencies.run.mock.callCount(), 1); assert.deepEqual(state.tables, []);
    assert.equal(client.end.mock.callCount(), 1);
  });
}
test('successful process exit is not sufficient when migrations remain pending', async () => {
  const { dependencies, client } = fixture(); dependencies.run.mock.mockImplementation(() => ({ status: 0 }));
  await assert.rejects(prepareDockerDatabase(environment, { ...dependencies, deploy: true }), /remain pending/);
  assert.equal(client.end.mock.callCount(), 1);
});
test('connection failure is not retried and always closes the client', async () => {
  const { dependencies, client } = fixture(); client.connect.mock.mockImplementation(async () => { throw new Error('private-password'); });
  await assert.rejects(prepareDockerDatabase(environment, { ...dependencies, deploy: true }), /private-password/);
  assert.equal(dependencies.run.mock.callCount(), 0); assert.equal(client.end.mock.callCount(), 1);
});
test('CLI never loads host .env or exposes URL/password/stack when target is unsafe', () => {
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('../api/migrate.mjs', import.meta.url))], {
    encoding: 'utf8', env: { ...process.env, NODE_ENV: 'development', CITAJUSTA_DOCKER: 'development', DATABASE_URL: 'postgresql://private-user:private-password@localhost:5432/citajusta_dev' },
  });
  assert.equal(result.status, 1); assert.equal(result.stdout, '');
  assert.match(result.stderr, /Only the isolated Compose development database/);
  assert.doesNotMatch(result.stderr, /private-user|private-password|postgresql:|\bat file:/);
});
