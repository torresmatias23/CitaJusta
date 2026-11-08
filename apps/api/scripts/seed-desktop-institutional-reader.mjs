import { developmentClient, reportDevelopmentFailure } from './development-runtime.mjs';
import { DevelopmentError } from '../dist/database/development.js';
import { seedDesktopInstitutionalReader } from '../dist/database/desktop-institutional-reader.js';

let prisma;
try {
  const args = process.argv.slice(2);
  if (args.length > 1 || (args.length === 1 && !['--check', '--apply'].includes(args[0]))) {
    throw new DevelopmentError('Usa --check (sólo lectura, por defecto) o --apply (asignación explícita).');
  }
  prisma = developmentClient();
  const result = await seedDesktopInstitutionalReader(prisma, {
    connectionString: process.env.DATABASE_URL, nodeEnv: process.env.NODE_ENV,
    email: process.env.DESKTOP_INSTITUTIONAL_READER_EMAIL, apply: args[0] === '--apply',
  });
  console.log(`[OK] Base local verificada: ${result.database}`);
  console.log(`[OK] Cuenta ACTIVE: ${result.email}; UUID: ${result.userId}`);
  console.log(`[OK] Institución: ${result.institutionId}; rol INSTITUTION: ${result.role}`);
  console.log(`[OK] Permisos exclusivos validados: ${result.permissions.join(', ')}`);
  console.log(`[OK] Permisos de catálogo ${result.applied ? 'creados' : 'por crear'}: ${result.missingPermissions.join(', ') || 'ninguno'}`);
  console.log(`[OK] Asignaciones previas de la cuenta: ${result.existingAssignments}; se conservan intactas.`);
  console.log(`[OK] ${result.applied ? 'Aplicación completada' : 'Comprobación READ ONLY'}; registros ${result.applied ? 'insertados' : 'pendientes'}: ${result.changes}`);
  console.log(result.applied
    ? '[ACTION] Vuelve a iniciar sesión en Desktop, aplica la institución sin sede y comprueba /users/me. No se cambiaron credenciales.'
    : '[ACTION] Revisa cuenta, institución y asignaciones. Sólo tras autorización ejecuta el mismo comando con --apply.');
} catch (error) { reportDevelopmentFailure(error); }
finally { if (prisma) await prisma.$disconnect(); }
