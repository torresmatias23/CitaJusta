import { loadEnvFile } from 'node:process';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../dist/generated/prisma/client.js';
import { assertDevelopmentTarget, DevelopmentError } from '../dist/database/development.js';

export function developmentClient() {
  try { loadEnvFile(new URL('../.env', import.meta.url)); }
  catch (error) { if (error?.code !== 'ENOENT') throw new Error('No se pudo cargar apps/api/.env.'); }
  assertDevelopmentTarget(process.env.DATABASE_URL, process.env.NODE_ENV);
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 5000 }) });
}

export function reportDevelopmentFailure(error) {
  // No imprimir excepciones de Prisma/pg: pueden contener parámetros de conexión.
  console.error(error instanceof DevelopmentError ? `[ERROR] ${error.message}` : '[ERROR] Revisa DATABASE_URL local de desarrollo, PostgreSQL, migraciones y compatibilidad de los registros demo/catálogos. No se sobrescriben configuraciones existentes.');
  console.error('[ACTION] Consulta docs/development/SETUP.md; comprueba Prisma migrate status y los catálogos con check:dev.');
  process.exitCode = 1;
}
