import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseEnv } from 'node:util';
import { connectE2E, createE2EEnvironment, E2ESafetyError } from './e2e-docker-environment.mjs';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const api = join(root, 'apps/api');
const prismaCli = join(root, 'node_modules/prisma/build/index.js');
export const suites = Object.freeze({
  institutions: 'institutions',
  checkpoint: 'backend-checkpoint', agenda: 'agenda', reports: 'reports', expiration: 'offer-expiration',
  notifications: 'notifications', 'email-delivery': 'email-delivery', google: 'google-auth',
  'google-calendar': 'google-calendar', audit: 'audit', attendance: 'attendance', catalog: 'catalog-administration',
  professionals: 'professional-administration', 'availability-admin': 'availability-administration',
  appointments: 'appointments', waitlist: 'waitlist', 'automatic-start': 'automatic-reassignment-start',
  reassignments: 'reassignments', 'reassignment-policy': 'reassignment-policy',
});

export function parseArguments(args) {
  const [action = 'check', suite] = args;
  if (!['check', 'migrate', 'bootstrap', 'test'].includes(action) ||
    (action === 'test' ? args.length !== 2 || (suite !== 'all' && !Object.hasOwn(suites, suite)) : args.length > 1)) {
    throw new E2ESafetyError('Usage: e2e:docker -- check | migrate | bootstrap | test <suite|all>');
  }
  return { action, suite };
}

function git(args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'buffer', windowsHide: true });
  if (result.error || result.status !== 0) throw new E2ESafetyError('Cannot verify versioned migrations with Git');
  return result.stdout;
}

export async function versionedMigrations() {
  const paths = git(['ls-files', '-z', '--', 'apps/api/prisma/migrations']).toString().split('\0');
  const sqlPaths = paths.filter((path) => /^apps\/api\/prisma\/migrations\/[a-z0-9_]+\/migration\.sql$/.test(path));
  if (!sqlPaths.length) throw new E2ESafetyError('No versioned migrations found');
  const files = await Promise.all([...sqlPaths, 'apps/api/prisma/migrations/migration_lock.toml'].map(async (path) => {
    const committed = git(['show', `HEAD:${path}`]);
    if (!(await readFile(join(root, path))).equals(committed)) {
      throw new E2ESafetyError('Versioned migration differs from HEAD; manual review required');
    }
    return { path, content: committed };
  }));
  return files.map(({ path, content }) => ({
    name: path.split('/').at(-2), relative: path.slice('apps/api/prisma/migrations/'.length), content,
    checksum: createHash('sha256').update(content).digest('hex'),
  })).sort((a, b) => a.name.localeCompare(b.name));
}

export async function migrationStatus(client, manifest) {
  const migrations = manifest.filter((file) => file.relative.endsWith('/migration.sql'));
  await client.query('BEGIN READ ONLY');
  try {
    const { rows: tables } = await client.query("SELECT tablename FROM pg_catalog.pg_tables WHERE schemaname = 'public'");
    if (!tables.length) return { applied: 0, pending: migrations.length };
    if (!tables.some(({ tablename }) => tablename === '_prisma_migrations')) {
      throw new E2ESafetyError('Nonempty E2E schema without migration history; manual review required');
    }
    const { rows } = await client.query('SELECT migration_name, checksum, finished_at, rolled_back_at FROM public._prisma_migrations ORDER BY migration_name');
    for (const [index, row] of rows.entries()) {
      if (!row.finished_at || row.rolled_back_at || row.migration_name !== migrations[index]?.name ||
        row.checksum !== migrations[index]?.checksum) {
        throw new E2ESafetyError('E2E migration history/checksum incompatible; no repair attempted');
      }
    }
    if (!rows.length && tables.length !== 1) throw new E2ESafetyError('Untracked E2E schema; manual review required');
    return { applied: rows.length, pending: migrations.length - rows.length };
  } finally { await client.query('ROLLBACK'); }
}

export async function stagePrismaConfiguration(directory, manifest) {
  const migrations = join(directory, 'migrations');
  for (const file of manifest) {
    const target = join(migrations, file.relative);
    await mkdir(join(target, '..'), { recursive: true });
    await writeFile(target, file.content);
  }
  // No dotenv import, no credentials on disk. Original schema and migrations remain untouched.
  const config = join(directory, 'prisma.config.mjs');
  await writeFile(config, `export default { ...${JSON.stringify({ schema: join(api, 'prisma/schema.prisma'),
    migrations: { path: migrations } })}, datasource: { url: process.env.DATABASE_URL } };\n`);
  return config;
}

async function cleanupWorkspace(directory) {
  const absolute = resolve(directory);
  if (dirname(absolute) !== resolve(tmpdir()) || !/^citajusta-e2e-[a-zA-Z0-9]+$/.test(basename(absolute))) {
    throw new E2ESafetyError('Refusing to remove an unexpected temporary workspace');
  }
  await rm(absolute, { recursive: true, force: true });
}

export function summarizeTapFailures(output) {
  const failures = [];
  const knownFiles = new Set(Object.values(suites).map((file) => `${file}.e2e.test.mjs`));
  let current;
  for (const line of output.split(/\r?\n/)) {
    const failure = /^( {0,40})not ok ([1-9][0-9]{0,3})(?: - .*)?$/.exec(line);
    if (failure && failure[1].length % 4 === 0) {
      if (failures.length >= 100) break;
      current = { index: Number(failure[2]), depth: failure[1].length / 4 };
      failures.push(current);
      continue;
    }
    if (!current) continue;
    // Only direct diagnostic keys; never inspect multiline error/stack/payload bodies.
    const prefix = ' '.repeat(current.depth * 4 + 2);
    if (line === `${prefix}...`) { current = undefined; continue; }
    const field = new RegExp(`^${prefix}(location|failureType|code|expected|actual): (.+)$`).exec(line);
    if (!field) continue;
    const [, key, value] = field;
    if (key === 'location') {
      const location = /[/\\]([a-z0-9-]+\.e2e\.test\.mjs):([1-9][0-9]{0,4}):([1-9][0-9]{0,3})'$/.exec(value);
      if (location && knownFiles.has(location[1])) current.location = `${location[1]}:${location[2]}:${location[3]}`;
    } else if (key === 'code' && /^'(ERR_ASSERTION|ERR_TEST_FAILURE|P[0-9]{4})'$/.test(value)) {
      current.code = value.slice(1, -1);
    } else if (key === 'failureType' && /^'(testCodeFailure|subtestsFailed|cancelledByParent|testTimeoutFailure|hookFailed)'$/.test(value)) {
      current.failureType = value.slice(1, -1);
    } else if ((key === 'expected' || key === 'actual') && /^(true|false|null|0|1|2|200|201|204|400|401|403|404|409|500|503)$/.test(value)) {
      current[key] = value;
    }
  }
  return failures;
}

export function runNode(args, environment, directory, label, run = spawnSync) {
  const result = run(process.execPath, args, { cwd: directory, env: environment, encoding: 'utf8',
    windowsHide: true, timeout: 600000, maxBuffer: 16 * 1024 * 1024 });
  // Never forward arbitrary subprocess output: Prisma/Nest failures may contain secrets.
  const counts = (result.stdout ?? '').split(/\r?\n/).filter((line) => /^# (tests|pass|fail|cancelled|skipped|todo) \d+$/.test(line));
  for (const line of counts) console.log(`[${label}] ${line.slice(2)}`);
  if (args.includes('--test')) {
    for (const failure of summarizeTapFailures(result.stdout ?? '')) {
      console.log(`[${label}] failure ${JSON.stringify(failure)}`);
    }
  }
  if (result.error || result.status !== 0) throw new E2ESafetyError(`${label} failed; raw provider/process output withheld. Stop and diagnose in the isolated environment`);
  console.log(`[OK] ${label}`);
}

export async function executeE2EAction({ action, suite }, environment, {
  connect = connectE2E, manifest: readManifest = versionedMigrations, status = migrationStatus,
  stage = stagePrismaConfiguration, run = runNode,
  workspace = () => mkdtemp(join(tmpdir(), 'citajusta-e2e-')),
  cleanup = cleanupWorkspace,
} = {}) {
  // Identity is checked before history inspection, lock acquisition, subprocesses or fixture writes.
  const client = await connect(environment);
  let directory;
  try {
    const manifest = await readManifest();
    const before = await status(client, manifest);
    if (action === 'check') return before;
    const lock = await client.query('SELECT pg_try_advisory_lock(20261017, 15432) AS acquired');
    if (lock.rows[0]?.acquired !== true) throw new E2ESafetyError('Another Docker E2E operation is running; execute sequentially');
    // Recheck after acquiring the session lock. The same connection holds it until all children finish.
    const current = await status(client, manifest);
    if (action !== 'migrate' && current.pending) throw new E2ESafetyError('E2E migrations pending; authorize and run the explicit migrate action first');
    directory = await workspace();
    const config = await stage(directory, manifest);
    if (action === 'migrate') {
      run([prismaCli, 'migrate', 'deploy', '--config', config], environment, directory, 'Prisma migrate deploy (E2E only)');
      const after = await status(client, manifest);
      if (after.pending) throw new E2ESafetyError('E2E migrations remain pending; stop');
      return after;
    }
    run([prismaCli, 'generate', '--config', config], environment, directory, 'Prisma generate');
    run([join(root, 'node_modules/typescript/bin/tsc'), '-p', join(api, 'tsconfig.build.json')], environment, directory, 'API build');
    if (action === 'bootstrap') {
      run([join(api, 'scripts/e2e-docker-bootstrap.mjs')], environment, directory, 'E2E catalogs bootstrap');
    } else {
      for (const name of suite === 'all' ? Object.keys(suites) : [suite]) {
        run(['--import', pathToFileURL(join(api, 'test/e2e/docker-preflight.mjs')).href,
          '--test', '--test-reporter=tap', '--test-concurrency=1', join(api, `test/e2e/${suites[name]}.e2e.test.mjs`)],
        environment, directory, `E2E ${name}`);
      }
    }
    return current;
  } finally {
    try { await client.end(); } finally { if (directory) await cleanup(directory); }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const options = parseArguments(process.argv.slice(2));
    let settings;
    try { settings = parseEnv(await readFile(join(root, 'docker/e2e/.env'), 'utf8')); }
    catch { throw new E2ESafetyError('Create docker/e2e/.env from its template and configure an exclusive E2E password'); }
    const result = await executeE2EAction(options, createE2EEnvironment(settings));
    console.log(`[OK] citajusta_e2e: ${result.applied} migrations applied, ${result.pending} pending`);
  } catch (error) {
    console.error(`[ERROR] ${error instanceof E2ESafetyError ? error.message : 'E2E preparation failed; connection/provider details omitted'}`);
    process.exitCode = 1;
  }
}
