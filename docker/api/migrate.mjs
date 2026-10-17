import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Client } from 'pg';

const marker = 'citajusta-capstone-docker-v1';
const apiDirectory = fileURLToPath(new URL('../../apps/api/', import.meta.url));
export class DockerSetupError extends Error {}

export function assertDockerTarget(environment) {
  let url;
  try { url = new URL(environment.DATABASE_URL); }
  catch { throw new DockerSetupError('Invalid isolated Docker database configuration'); }
  if (environment.NODE_ENV !== 'development' || environment.CITAJUSTA_DOCKER !== 'development' ||
    url.protocol !== 'postgresql:' || url.hostname !== 'db' || url.port !== '5432' ||
    url.username !== 'citajusta' || url.pathname !== '/citajusta_docker' ||
    url.search !== '?schema=public' || url.hash || !/^[A-Za-z0-9_-]{32,128}$/.test(url.password)) {
    throw new DockerSetupError('Only the isolated Compose development database is permitted; no migrations executed');
  }
  return url.href;
}

export async function readMigrationManifest(readDirectory = readdir, readSql = readFile) {
  const root = new URL('../../apps/api/prisma/migrations/', import.meta.url);
  const entries = (await readDirectory(root, { withFileTypes: true })).filter((entry) => entry.isDirectory());
  const migrations = await Promise.all(entries.map(async ({ name }) => ({ name,
    checksum: createHash('sha256').update(await readSql(new URL(`${name}/migration.sql`, root))).digest('hex'),
  })));
  if (!migrations.length) throw new DockerSetupError('No versioned migrations available');
  return migrations.sort((a, b) => a.name.localeCompare(b.name));
}

export async function verifyDockerDatabase(client, migrations) {
  await client.query('BEGIN READ ONLY');
  try {
    const { rows: [identity] } = await client.query(`SELECT current_database() AS database,
      current_user AS username, current_setting('server_version_num')::int AS version,
      shobj_description(oid, 'pg_database') AS marker
      FROM pg_database WHERE datname = current_database()`);
    if (!identity || identity.database !== 'citajusta_docker' || identity.username !== 'citajusta' ||
      identity.version < 180000 || identity.version >= 190000 || identity.marker !== marker) {
      throw new DockerSetupError('Docker database identity/marker mismatch; no migrations executed');
    }
    const { rows: tables } = await client.query("SELECT tablename FROM pg_catalog.pg_tables WHERE schemaname = 'public'");
    if (!tables.length) return { applied: 0, pending: migrations.length };
    if (!tables.some((table) => table.tablename === '_prisma_migrations')) {
      throw new DockerSetupError('Nonempty Docker database without Prisma history; manual review required');
    }
    const { rows } = await client.query('SELECT migration_name, checksum, finished_at, rolled_back_at FROM public._prisma_migrations');
    const known = new Map(migrations.map((migration) => [migration.name, migration.checksum]));
    const names = new Set();
    for (const row of rows) {
      if (!row.finished_at || row.rolled_back_at || known.get(row.migration_name) !== row.checksum || names.has(row.migration_name)) {
        throw new DockerSetupError('Docker migration history incompatible; manual review required');
      }
      names.add(row.migration_name);
    }
    if (!rows.length && tables.length > 1) throw new DockerSetupError('Untracked Docker schema; manual review required');
    return { applied: names.size, pending: migrations.length - names.size };
  } finally {
    await client.query('ROLLBACK');
  }
}

export async function prepareDockerDatabase(environment, { deploy = false, manifest = readMigrationManifest,
  client: createClient = (config) => new Client(config), run = spawnSync } = {}) {
  const connectionString = assertDockerTarget(environment);
  const migrations = await manifest();
  const client = createClient({ connectionString, connectionTimeoutMillis: 5000, statement_timeout: 5000 });
  try {
    await client.connect();
    const before = await verifyDockerDatabase(client, migrations);
    if (!deploy) {
      if (before.pending) throw new DockerSetupError('Docker migrations pending; run the explicit migrate service before starting API');
      return before;
    }
    const result = run(process.execPath,
      [fileURLToPath(new URL('../../node_modules/prisma/build/index.js', import.meta.url)), 'migrate', 'deploy'],
      { cwd: apiDirectory, env: environment, encoding: 'utf8', timeout: 120000, maxBuffer: 1024 * 1024 });
    // Do not relay CLI output, connection strings or SQL error details to shared logs.
    if (result.error || result.status !== 0) throw new DockerSetupError('Prisma migrate deploy failed in Docker; inspect isolated migration status. No reset performed');
    const status = await verifyDockerDatabase(client, migrations);
    if (status.pending !== 0) throw new DockerSetupError('Docker migrations remain pending; do not start API');
    return status;
  } finally {
    await client.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const args = process.argv.slice(2);
    if (args.length > 1 || (args.length === 1 && args[0] !== '--check')) throw new DockerSetupError('Only --check or the explicit migration command is supported');
    const result = await prepareDockerDatabase(process.env, { deploy: args.length === 0 });
    console.log(`[OK] Isolated Docker database: ${result.applied} migrations applied, ${result.pending} pending. No bootstrap or seed executed.`);
  } catch (error) {
    console.error(`[ERROR] ${error instanceof DockerSetupError ? error.message : 'Docker preparation failed; verify isolated database connectivity, marker and migration history. Provider details omitted'}`);
    process.exitCode = 1;
  }
}
