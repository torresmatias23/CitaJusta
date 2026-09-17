import { seedDevelopment } from '../dist/database/development.js';
import { developmentClient, reportDevelopmentFailure } from './development-runtime.mjs';

let prisma;
try {
  prisma = developmentClient();
  await seedDevelopment(prisma, process.env.DATABASE_URL, process.env.NODE_ENV);
  console.log('[OK] Catálogo demo y Waitlist ACTIVE/WITHDRAWN/FULFILLED + STANDARD institucional preparados. Datos existentes preservados.');
} catch (error) { reportDevelopmentFailure(error); }
finally { if (prisma) await prisma.$disconnect(); }
