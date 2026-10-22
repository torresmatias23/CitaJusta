import { pathToFileURL } from 'node:url';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../dist/generated/prisma/client.js';
import { DemoProvisionError, parseDemoProvisionRequest, provisionDockerDemoAdministrator } from '../dist/database/docker-demo-administrator.js';
import { DevelopmentError } from '../dist/database/development.js';
import { assertDockerTarget, DockerSetupError, prepareDockerDatabase } from '../../../docker/api/migrate.mjs';

// No dotenv, subprocesses, migrations or seeds. Use only Compose's explicit environment.
export async function runDockerDemoProvision(args, environment, {
  verify = prepareDockerDatabase,
  createPrisma = connectionString => new PrismaClient({ adapter: new PrismaPg({ connectionString,
    connectionTimeoutMillis: 5000, statement_timeout: 15000 }) }),
  log = console.log,
} = {}) {
  if (args.length !== 1 || !['platform', 'institution'].includes(args[0])) {
    throw new DemoProvisionError('Usa provision:docker-demo -- platform o institution; no se aceptan otros argumentos.');
  }
  const snapshot = { ...environment };
  const connectionString = assertDockerTarget(snapshot);
  const request = parseDemoProvisionRequest({ mode: args[0], email: snapshot.DEMO_ADMIN_EMAIL,
    userId: snapshot.DEMO_ADMIN_USER_ID, confirmation: snapshot.DEMO_PROVISION_CONFIRM,
    ...(snapshot.DEMO_INSTITUTION_ID !== undefined ? { institutionId: snapshot.DEMO_INSTITUTION_ID } : {}) });
  await verify(snapshot, { deploy: false });
  const prisma = createPrisma(connectionString);
  try {
    const result = await provisionDockerDemoAdministrator(prisma, request);
    log(`[OK] Provisión DEMO ${request.mode}: ${result.changed ? 'persistida y auditada' : 'compatible, sin cambios'}. Rol: ${result.role}.`);
    return result;
  } finally { await prisma.$disconnect(); }
}

export function reportDemoProvisionFailure(error, log = console.error) {
  log(`[ERROR] ${error instanceof DemoProvisionError || error instanceof DockerSetupError || error instanceof DevelopmentError
    ? error.message : 'Provisión DEMO fallida; revisar configuración e identidad. Detalles del proveedor omitidos.'}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { await runDockerDemoProvision(process.argv.slice(2), process.env); }
  catch (error) { reportDemoProvisionFailure(error); process.exitCode = 1; }
}
