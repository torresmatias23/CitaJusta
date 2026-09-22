import { pathToFileURL } from 'node:url';
import { developmentClient, reportDevelopmentFailure } from './development-runtime.mjs';
import { DevelopmentError } from '../dist/database/development.js';
import { prepareBookingDemo } from '../dist/database/booking-demo.js';
import { ProfessionalAdministrationService } from '../dist/professionals/professional-administration.service.js';
import { AvailabilityAdministrationService } from '../dist/availability/availability-administration.service.js';

export async function runBookingDemo() {
  let prisma;
  try {
    if (process.argv.slice(2).length) throw new DevelopmentError('seed:booking-demo no acepta argumentos.');
    prisma = developmentClient();
    const result = await prepareBookingDemo(prisma, {
      professionals: new ProfessionalAdministrationService(prisma),
      availability: new AvailabilityAdministrationService(prisma),
    }, { connectionString: process.env.DATABASE_URL, nodeEnv: process.env.NODE_ENV });
    console.log(`[OK] Booking demo: ${result.reused ? 'cupos existentes reutilizados' : 'nuevo intervalo creado mediante dominio real'}`);
    console.log(`[OK] ${result.institution} → ${result.branch} → ${result.service} → ${result.professional}`);
    const format = new Intl.DateTimeFormat('es-CL', { timeZone: result.timeZone, dateStyle: 'medium', timeStyle: 'short' });
    for (const slot of result.slots) console.log(`[AVAILABLE] ${format.format(new Date(slot.startsAt))} — ${format.format(new Date(slot.endsAt))} (${result.timeZone}); UTC ${slot.startsAt} — ${slot.endsAt}`);
    console.log('[ACTION] Inicia sesión con tu cuenta Web, selecciona el catálogo indicado y busca en Próximos 30 días. Web muestra la zona horaria de tu dispositivo. El tooling no reserva.');
  } catch (error) { reportDevelopmentFailure(error); }
  finally { if (prisma) await prisma.$disconnect(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await runBookingDemo();
