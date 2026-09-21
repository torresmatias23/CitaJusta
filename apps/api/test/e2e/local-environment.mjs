import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';

export function loadApiEnvironment() {
  try {
    loadEnvFile(fileURLToPath(new URL('../../.env', import.meta.url)));
  } catch (error) {
    if (error?.code !== 'ENOENT' || !process.env.DATABASE_URL) {
      throw new Error('E2E environment could not be loaded');
    }
  }
  // Historical suites explicitly control expired PENDING offers. Opt in after loading only in runner tests.
  process.env.OFFER_EXPIRATION_ENABLED = 'false';
}

export function assertSafeLocalDatabaseUrl(connectionString) {
  let url;
  try { url = new URL(connectionString); } catch {
    throw new Error('E2E safety check failed: DATABASE_URL is invalid or missing');
  }
  if (
    !['postgresql:', 'postgres:'].includes(url.protocol) ||
    !['localhost', '127.0.0.1', '::1', '[::1]'].includes(url.hostname.toLowerCase()) ||
    !/^citajusta_(dev|test|e2e)(_[a-z0-9-]+)?$/i.test(decodeURIComponent(url.pathname.slice(1))) ||
    process.env.NODE_ENV === 'production'
  ) {
    throw new Error('E2E safety check failed: only an allowlisted local PostgreSQL database is accepted');
  }
}

export function getE2ePort() {
  if (process.env.E2E_PORT === undefined) return 0;
  const port = Number(process.env.E2E_PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65_535 || port === 3_000) {
    throw new Error('E2E_PORT must be a valid non-3000 port');
  }
  return port;
}
