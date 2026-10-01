import { developmentClient, reportDevelopmentFailure } from './development-runtime.mjs';
import { DevelopmentError } from '../dist/database/development.js';
import { seedDesktopReportsReader } from '../dist/database/desktop-reports-reader.js';

let prisma;
try {
  if (process.argv.slice(2).length) throw new DevelopmentError('seed:desktop-reports-reader no acepta argumentos.');
  prisma = developmentClient();
  const result = await seedDesktopReportsReader(prisma, {
    connectionString: process.env.DATABASE_URL, nodeEnv: process.env.NODE_ENV,
    email: process.env.DESKTOP_REPORTS_READER_EMAIL,
  });
  console.log(`[OK] Cuenta existente: ${result.email}`);
  console.log(`[OK] Institución: ${result.institutionId}; rol: ${result.role}`);
  console.log(`[OK] Permisos: ${result.permissions.join(', ')}`);
  console.log('[ACTION] En Desktop, inicia sesión y aplica esta institución sin sede en Sedes y servicios. Luego abre Reportes. No se crearon ni cambiaron credenciales.');
} catch (error) { reportDevelopmentFailure(error); }
finally { if (prisma) await prisma.$disconnect(); }
