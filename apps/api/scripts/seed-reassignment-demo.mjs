import { ConfigService } from '@nestjs/config';
import { developmentClient, reportDevelopmentFailure } from './development-runtime.mjs';
import { validateEnvironment } from '../dist/config/environment.validation.js';
import { parseReassignmentDemoInput, prepareReassignmentDemo } from '../dist/database/reassignment-demo.js';
import { CatalogAdministrationService } from '../dist/services/catalog-administration.service.js';
import { ProfessionalAdministrationService } from '../dist/professionals/professional-administration.service.js';
import { AvailabilityAdministrationService } from '../dist/availability/availability-administration.service.js';
import { AppointmentsService } from '../dist/appointments/appointments.service.js';
import { WaitlistService } from '../dist/waitlist/waitlist.service.js';
import { WaitlistPreferencesService } from '../dist/waitlist/waitlist-preferences.service.js';
import { ReassignmentsService } from '../dist/reassignments/reassignments.service.js';
import { RecipientOffersService } from '../dist/reassignments/recipient-offers.service.js';
import { ReassignmentPolicyService } from '../dist/reassignment-policy/reassignment-policy.service.js';

// Composition only: all critical writes remain in the same services used by HTTP.
export function reassignmentDemoDomain(prisma, config) {
  return {
    catalog: new CatalogAdministrationService(prisma), professionals: new ProfessionalAdministrationService(prisma),
    availability: new AvailabilityAdministrationService(prisma), appointments: new AppointmentsService(prisma, config),
    waitlist: new WaitlistService(prisma), preferences: new WaitlistPreferencesService(prisma),
    reassignments: new ReassignmentsService(prisma, config), offers: new RecipientOffersService(prisma),
    policy: new ReassignmentPolicyService(prisma, config),
  };
}

export async function runReassignmentDemo() {
  let prisma;
  try {
    prisma = developmentClient();
    const input = parseReassignmentDemoInput(process.argv.slice(2), process.env.REASSIGNMENT_DEMO_RECIPIENT_EMAIL);
    const config = new ConfigService(validateEnvironment(process.env));
    const result = await prepareReassignmentDemo(prisma, reassignmentDemoDomain(prisma, config), {
      ...input, connectionString: process.env.DATABASE_URL, nodeEnv: process.env.NODE_ENV,
    });
    console.log(`[OK] Scenario: ${result.scenario} (${result.reused ? 'existente, sin duplicar' : 'preparado mediante dominio real'})`);
    console.log(`[OK] Recipient: ${result.recipient}`);
    console.log(`[OK] Offer: ${result.offer.id}`);
    console.log(`[OK] Status: ${result.offer.status}`);
    console.log(`[OK] Service: ${result.offer.service.name}`);
    console.log(`[OK] Branch: ${result.offer.branch.name}`);
    console.log(`[OK] Starts at: ${result.offer.startsAt}`);
    console.log(`[OK] Expires at: ${result.offer.expiresAt}`);
    console.log(result.offer.status !== 'PENDING' || result.elapsed
      ? '[ACTION] Escenario consumido o plazo vencido. No se revive ni se borra su historia.'
      : '[ACTION] Inicia sesión con el destinatario y abre /ofertas. El tooling NO responde la oferta.');
  } catch (error) { reportDevelopmentFailure(error); }
  finally { if (prisma) await prisma.$disconnect(); }
}

import { pathToFileURL } from 'node:url';
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await runReassignmentDemo();
