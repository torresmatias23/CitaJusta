import { pathToFileURL } from 'node:url';
import { developmentClient, reportDevelopmentFailure } from './development-runtime.mjs';
import { DevelopmentError, assertDevelopmentTarget } from '../dist/database/development.js';
import { provisionDevelopmentInstitutionAdministrator, parseInstitutionAdministratorIdentity } from '../dist/database/institution-administrator.js';

export async function runInstitutionAdministratorProvision() {
  let prisma;
  try {
    if (process.argv.slice(2).length) throw new DevelopmentError('Este procedimiento no acepta argumentos.');
    // Fail before creating a client/loading normal API settings unless explicitly confirmed.
    const database = assertDevelopmentTarget(process.env.DATABASE_URL, process.env.NODE_ENV);
    if (process.env.NODE_ENV !== 'development' || process.env.INSTITUTION_ADMIN_CONFIRM_DATABASE !== database) {
      throw new DevelopmentError('Configura explícitamente DATABASE_URL, NODE_ENV=development e INSTITUTION_ADMIN_CONFIRM_DATABASE en esta sesión administrativa.');
    }
    parseInstitutionAdministratorIdentity({ email: process.env.INSTITUTION_ADMIN_EMAIL, userId: process.env.INSTITUTION_ADMIN_USER_ID });
    prisma = developmentClient();
    const result = await provisionDevelopmentInstitutionAdministrator(prisma, {
      connectionString: process.env.DATABASE_URL, nodeEnv: process.env.NODE_ENV,
      confirmedDatabase: process.env.INSTITUTION_ADMIN_CONFIRM_DATABASE,
      email: process.env.INSTITUTION_ADMIN_EMAIL, userId: process.env.INSTITUTION_ADMIN_USER_ID,
    });
    console.log(`[OK] ${result.changed ? 'Provisión persistida y auditada' : 'Asignación existente compatible, sin cambios'}. Rol: ${result.role}; asignación: ${result.grantId}.`);
    console.log('[ACTION] Inicia sesión nuevamente en Desktop. Retira las variables de esta sesión administrativa.');
  } catch (error) { reportDevelopmentFailure(error); }
  finally { if (prisma) await prisma.$disconnect(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await runInstitutionAdministratorProvision();
