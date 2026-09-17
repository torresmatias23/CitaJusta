import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../dist/generated/prisma/client.js';
import { bootstrapWaitlist } from '../dist/database/waitlist.bootstrap.js';

let prisma;
try {
  try { loadEnvFile(fileURLToPath(new URL('../.env', import.meta.url))); }
  catch (error) { if (error?.code !== 'ENOENT' || !process.env.DATABASE_URL) throw error; }
  const url = new URL(process.env.DATABASE_URL);
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error('Invalid database configuration');
  prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
  const result = await bootstrapWaitlist(prisma);
  console.log(`Waitlist ACTIVE/WITHDRAWN/FULFILLED provisioned; STANDARD provisioned for ${result.institutions} active institutions. Existing configuration preserved.`);
} catch {
  console.error('Waitlist bootstrap failed; check database, ACTIVE/WITHDRAWN/FULFILLED/STANDARD configuration and institution priority level 0 conflicts.');
  process.exitCode = 1;
} finally {
  if (prisma) await prisma.$disconnect();
}
