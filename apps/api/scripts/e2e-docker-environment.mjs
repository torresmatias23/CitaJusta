import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { Client } from 'pg';

export class E2ESafetyError extends Error {}
export const identitySql = `SELECT current_database() AS database, current_user AS username,
  current_setting('server_version_num')::int AS version, inet_server_port() AS port,
  shobj_description(oid, 'pg_database') AS marker
  FROM pg_database WHERE datname = current_database()`;

export function assertE2ETarget(environment) {
  let url;
  try { url = new URL(environment.DATABASE_URL); }
  catch { throw new E2ESafetyError('Invalid Docker E2E configuration; use npm run e2e:docker -w @citajusta/api -- check'); }
  if (environment.NODE_ENV !== 'test' || environment.CITAJUSTA_E2E !== 'docker' ||
    url.protocol !== 'postgresql:' || url.hostname !== '127.0.0.1' || url.port !== '15432' ||
    url.pathname !== '/citajusta_e2e' || url.username !== 'citajusta_e2e' ||
    url.search !== '?schema=public' || url.hash || !/^[a-f0-9]{64}$/.test(url.password)) {
    throw new E2ESafetyError('Only Docker E2E at 127.0.0.1:15432/citajusta_e2e is permitted');
  }
  return url.href;
}

export function assertE2EIdentity(identity) {
  if (!identity || identity.database !== 'citajusta_e2e' || identity.username !== 'citajusta_e2e' ||
    !Number.isInteger(identity.version) || identity.version < 180000 || identity.version >= 190000 || identity.port !== 5432 ||
    identity.marker !== 'citajusta-e2e-docker-v1') {
    throw new E2ESafetyError('PostgreSQL E2E identity/marker mismatch; no writes permitted');
  }
}

// Construct a new environment, never inherit DATABASE_URL, NODE_OPTIONS, PG* or provider credentials.
export function createE2EEnvironment(settings, parent = process.env) {
  if (parent.NODE_ENV === 'production' || !/^[a-f0-9]{64}$/.test(settings.E2E_DB_PASSWORD ?? '') ||
    Object.keys(settings).some((key) => key !== 'E2E_DB_PASSWORD')) {
    throw new E2ESafetyError('Use an exclusive 64-character hex E2E password outside production; only E2E_DB_PASSWORD is accepted');
  }
  const environment = {};
  for (const [key, value] of Object.entries(parent)) {
    if (/^(path|systemroot|windir|comspec|pathext|temp|tmp|home|userprofile|appdata|localappdata)$/i.test(key)) environment[key] = value;
  }
  return { ...environment, NODE_ENV: 'test', CITAJUSTA_E2E: 'docker',
    DATABASE_URL: `postgresql://citajusta_e2e:${settings.E2E_DB_PASSWORD}@127.0.0.1:15432/citajusta_e2e?schema=public`,
    SHADOW_DATABASE_URL: 'postgresql://unused:unused@127.0.0.1:1/unused_shadow',
    JWT_ACCESS_SECRET: randomBytes(32).toString('hex'), JWT_REFRESH_SECRET: randomBytes(32).toString('hex'),
    JWT_ACCESS_TTL_SECONDS: '900', JWT_REFRESH_TTL_SECONDS: '2592000', PORT: '3000',
    GOOGLE_AUTH_ENABLED: 'false', GOOGLE_CALENDAR_ENABLED: 'false', EMAIL_DELIVERY_ENABLED: 'false',
    OFFER_EXPIRATION_ENABLED: 'false', WAITLIST_OFFER_TTL_MINUTES: '10',
  };
}

export async function connectE2E(environment, createClient = (options) => new Client(options)) {
  const connectionString = assertE2ETarget(environment);
  const client = createClient({ connectionString, connectionTimeoutMillis: 5000, statement_timeout: 5000 });
  try {
    await client.connect();
    await client.query('BEGIN READ ONLY');
    try { assertE2EIdentity((await client.query(identitySql)).rows[0]); }
    finally { await client.query('ROLLBACK'); }
    return client;
  } catch {
    await client.end().catch(() => {});
    throw new E2ESafetyError('E2E connection/identity check failed; verify the dedicated container and credentials. Details omitted');
  }
}

let verifiedUrl;
export async function initializeE2EProcess(environment = process.env, createClient) {
  verifiedUrl = undefined;
  // Nest's default dotenv lookup must not see apps/api/.env (or another real .env).
  if (existsSync(resolve('.env'))) throw new E2ESafetyError('E2E requires an empty working directory; use the Docker E2E runner');
  const client = await connectE2E(environment, createClient);
  await client.end();
  verifiedUrl = assertE2ETarget(environment);
}

export function assertVerifiedE2EProcess(environment = process.env) {
  if (!verifiedUrl || assertE2ETarget(environment) !== verifiedUrl || existsSync(resolve('.env'))) {
    throw new E2ESafetyError('E2E preflight missing or changed; use npm run e2e:docker -w @citajusta/api -- test <suite>');
  }
}

export async function assertE2EFixtureDatabase(prisma) {
  assertVerifiedE2EProcess();
  // Fixed SQL only: verify the actual client passed to cleanup, not just process.env.
  assertE2EIdentity((await prisma.$queryRawUnsafe(identitySql))[0]);
}

export function loopbackFetch(transport) {
  return (input, options) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.username || url.password) {
      throw new E2ESafetyError('External fetch is disabled in Docker E2E; mock the provider transport');
    }
    return transport(input, { ...options, redirect: 'error' });
  };
}
