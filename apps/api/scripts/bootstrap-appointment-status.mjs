import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../dist/generated/prisma/client.js';
import { bootstrapAppointmentStatus } from '../dist/database/appointment-status.bootstrap.js';

let prisma;
try {
  try {
    loadEnvFile(fileURLToPath(new URL('../.env', import.meta.url)));
  } catch (error) {
    if (error?.code !== 'ENOENT' || !process.env.DATABASE_URL) throw error;
  }
  const url = new URL(process.env.DATABASE_URL);
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) {
    throw new Error('Invalid database configuration');
  }
  prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });
  await bootstrapAppointmentStatus(prisma);
  console.log('AppointmentStatus AGENDADA and CANCELADA are present; existing configuration preserved.');
} catch {
  console.error('AppointmentStatus bootstrap failed; check database configuration and migrations.');
  process.exitCode = 1;
} finally {
  if (prisma) await prisma.$disconnect();
}
