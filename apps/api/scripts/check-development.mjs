import { readdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { checkDevelopment } from '../dist/database/development.js';
import { developmentClient, reportDevelopmentFailure } from './development-runtime.mjs';

let prisma;
try {
  const root = new URL('../prisma/migrations/', import.meta.url);
  const directories = (await readdir(root, { withFileTypes: true })).filter((entry) => entry.isDirectory());
  const migrations = await Promise.all(directories.map(async ({ name }) => ({ name, checksum: createHash('sha256').update(await readFile(new URL(`${name}/migration.sql`, root))).digest('hex') })));
  prisma = developmentClient();
  const checks = await checkDevelopment(prisma, process.env.DATABASE_URL, process.env.NODE_ENV, migrations);
  for (const check of checks) console.log(`[${check.ok ? 'OK' : 'WARN'}] ${check.message}`);
  if (checks.some((check) => !check.ok)) {
    console.log('[ACTION] Revisa migrate status; prepara seed:dev y bootstrap:appointment-status según los avisos. No se ejecutaron escrituras.');
    process.exitCode = 1;
  }
} catch (error) { reportDevelopmentFailure(error); }
finally { if (prisma) await prisma.$disconnect(); }
