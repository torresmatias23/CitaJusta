import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../dist/generated/prisma/client.js';
import { bootstrapAppointmentStatus } from '../dist/database/appointment-status.bootstrap.js';
import { bootstrapWaitlist } from '../dist/database/waitlist.bootstrap.js';
import { assertE2EFixtureDatabase, initializeE2EProcess } from './e2e-docker-environment.mjs';

try {
  await initializeE2EProcess();
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
  try {
    await assertE2EFixtureDatabase(prisma);
    await bootstrapAppointmentStatus(prisma);
    await assertE2EFixtureDatabase(prisma);
    await bootstrapWaitlist(prisma);
  } finally { await prisma.$disconnect(); }
  console.log('[OK] E2E appointment/waitlist catalogs provisioned; no demo seed executed');
} catch {
  console.error('[ERROR] Isolated E2E bootstrap failed; provider details omitted');
  process.exitCode = 1;
}
