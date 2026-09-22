import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { PrismaClient } from '../generated/prisma/client.js';
import type { CatalogAdministrationService } from '../services/catalog-administration.service.js';
import type { ProfessionalAdministrationService } from '../professionals/professional-administration.service.js';
import type { AvailabilityAdministrationService } from '../availability/availability-administration.service.js';
import type { AppointmentsService } from '../appointments/appointments.service.js';
import type { WaitlistService } from '../waitlist/waitlist.service.js';
import type { WaitlistPreferencesService } from '../waitlist/waitlist-preferences.service.js';
import type { ReassignmentsService } from '../reassignments/reassignments.service.js';
import type { RecipientOffersService } from '../reassignments/recipient-offers.service.js';
import type { ReassignmentPolicyService } from '../reassignment-policy/reassignment-policy.service.js';
import { bootstrapAppointmentStatus } from './appointment-status.bootstrap.js';
import { assertDevelopmentTarget, demo, DevelopmentError, seedDevelopment } from './development.js';

export type DemoScenario = 'reject' | 'accept';
export interface ReassignmentDemoDomain {
  catalog: Pick<CatalogAdministrationService, 'createService'>;
  professionals: Pick<ProfessionalAdministrationService, 'create'>;
  availability: Pick<AvailabilityAdministrationService, 'create'>;
  appointments: Pick<AppointmentsService, 'reserve' | 'cancel'>;
  waitlist: Pick<WaitlistService, 'enter'>;
  preferences: Pick<WaitlistPreferencesService, 'get' | 'replace'>;
  reassignments: Pick<ReassignmentsService, 'generate'>;
  offers: Pick<RecipientOffersService, 'findMine'>;
  policy: Pick<ReassignmentPolicyService, 'configure'>;
}

export function parseReassignmentDemoInput(args: string[], email: string | undefined) {
  if (args.length !== 1 || !['--scenario=reject', '--scenario=accept'].includes(args[0] ?? '')) {
    throw new DevelopmentError('Usa exactamente --scenario=reject o --scenario=accept.');
  }
  const parsed = z.string().trim().email().max(254).safeParse(email);
  if (!parsed.success) throw new DevelopmentError('Configura REASSIGNMENT_DEMO_RECIPIENT_EMAIL con el email de una cuenta ACTIVE existente.');
  return { scenario: args[0] === '--scenario=reject' ? 'reject' as const : 'accept' as const, email: parsed.data.toLowerCase() };
}

const MARKER = 'CitaJusta local reassignment demo v1';
// Deliberately not a password hash: AuthService.verifyPassword rejects it. No login credentials issued.
const NO_LOGIN = '!CITA_JUSTA_DEMO_NO_LOGIN!';
const PERMISSIONS = ['services.create', 'professionals.create', 'availability.create', 'reassignments.generate', 'reassignments.policy.update'] as const;
export function demoUuid(key: string) {
  const hex = createHash('sha256').update(`${MARKER}:${key}`).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
export function reassignmentDemoIdentity(recipientId: string, scenario: DemoScenario) {
  const key = `${recipientId}:${scenario}`;
  const suffix = createHash('sha256').update(key).digest('hex').slice(0, 16);
  return {
    code: `DEMO-REASSIGN-${scenario.toUpperCase()}-${suffix}`,
    marker: `${MARKER}; recipient=${recipientId}; scenario=${scenario}`,
    sourceId: demoUuid(`${key}:source`), professionalUserId: demoUuid(`${key}:professional`),
    sourceEmail: `demo-reassign-source-${suffix}@example.invalid`,
    professionalEmail: `demo-reassign-professional-${suffix}@example.invalid`,
    actorId: demoUuid('operator'), roleId: demoUuid('role'),
  };
}

function requireCompatible(existing: object, expected: object, label: string) {
  const values = new Map(Object.entries(existing));
  if (Object.entries(expected).some(([key, value]) => values.get(key) !== value)) {
    throw new DevelopmentError(`Colisión/configuración incompatible en ${label} demo; no se sobrescribe. Revisa el escenario antes de continuar.`);
  }
}

async function foundation(prisma: PrismaClient, identity: ReturnType<typeof reassignmentDemoIdentity>) {
  await prisma.$transaction(async (tx) => {
    for (const user of [
      { id: identity.actorId, email: 'demo-reassignment-operator@example.invalid', firstNames: 'Operador Demo', lastNames: 'Reasignación' },
      { id: identity.sourceId, email: identity.sourceEmail, firstNames: 'Usuario Origen Demo', lastNames: 'Reasignación' },
      { id: identity.professionalUserId, email: identity.professionalEmail, firstNames: 'Profesional Demo', lastNames: 'Reasignación' },
    ]) {
      const expected = { ...user, passwordHash: NO_LOGIN, status: 'ACTIVE' as const, deletedAt: null };
      const rows = await tx.user.findMany({ where: { OR: [{ id: user.id }, { email: user.email }] } });
      if (rows.length > 1) throw new DevelopmentError('Colisión de identidad técnica demo.');
      if (rows[0]) requireCompatible(rows[0], expected, 'identidad técnica');
      else await tx.user.create({ data: expected });
    }
    const roleData = { id: identity.roleId, code: 'DEMO_REASSIGNMENT_TOOL', name: 'Demo local reasignación', description: MARKER, scope: 'INSTITUTION' as const, active: true };
    const roles = await tx.role.findMany({ where: { OR: [{ id: roleData.id }, { code: roleData.code }] } });
    if (roles.length > 1) throw new DevelopmentError('Colisión del rol demo.');
    if (roles[0]) requireCompatible(roles[0], roleData, 'rol');
    else await tx.role.create({ data: roleData });
    const extraPermissions = await tx.rolePermission.count({ where: { roleId: identity.roleId, permission: { code: { notIn: [...PERMISSIONS] } } } });
    const extraGrants = await tx.userRole.count({ where: { roleId: identity.roleId, NOT: { userId: identity.actorId, institutionId: demo.institution.id } } });
    if (extraPermissions || extraGrants) throw new DevelopmentError('El rol técnico demo tiene permisos/asignaciones ajenos; no se modifica.');
    for (const code of PERMISSIONS) {
      const split = code.lastIndexOf('.');
      const fields = { code, module: code.slice(0, split), action: code.slice(split + 1) };
      const existing = await tx.permission.findUnique({ where: { code } });
      if (existing) requireCompatible(existing, fields, 'permiso');
      const permission = existing ?? await tx.permission.create({ data: { id: demoUuid(`permission:${code}`), ...fields } });
      await tx.rolePermission.upsert({ where: { roleId_permissionId: { roleId: identity.roleId, permissionId: permission.id } }, create: { roleId: identity.roleId, permissionId: permission.id }, update: {} });
    }
    const grant = { id: demoUuid('operator-grant'), userId: identity.actorId, roleId: identity.roleId, institutionId: demo.institution.id, branchId: null, active: true, validFrom: null, validTo: null };
    const grants = await tx.userRole.findMany({ where: { OR: [{ id: grant.id }, { userId: identity.actorId }] } });
    if (grants.length > 1) throw new DevelopmentError('La identidad técnica tiene asignaciones ajenas.');
    if (grants[0]) requireCompatible(grants[0], grant, 'asignación técnica');
    else await tx.userRole.create({ data: grant });
  });
}

export async function prepareReassignmentDemo(prisma: PrismaClient, domain: ReassignmentDemoDomain, options: {
  connectionString: string | undefined; nodeEnv: string | undefined; email: string; scenario: DemoScenario;
}) {
  const database = assertDevelopmentTarget(options.connectionString, options.nodeEnv);
  const input = parseReassignmentDemoInput([`--scenario=${options.scenario}`], options.email);
  // Only serialize this local tool, without replacing/nesting domain transactions.
  // A failure may leave owned intermediate resources; later runs resume, never rewind history.
  return prisma.$transaction(async (lock) => {
    const actual = await lock.$queryRaw<{ database: string }[]>`SELECT current_database() AS database`;
    if (actual[0]?.database !== database) throw new DevelopmentError('La base conectada no coincide con el destino autorizado.');
    const acquired = await lock.$queryRaw<{ acquired: boolean }[]>`SELECT pg_try_advisory_xact_lock(220022, 1) AS acquired`;
    if (!acquired[0]?.acquired) throw new DevelopmentError('Otra preparación demo está ejecutándose; espera y repite.');
    const recipient = await prisma.user.findUnique({ where: { email: input.email }, select: { id: true, email: true, status: true, deletedAt: true, updatedAt: true } });
    if (!recipient || recipient.status !== 'ACTIVE' || recipient.deletedAt) {
      throw new DevelopmentError('El destinatario debe existir y estar ACTIVE. Registra/activa la cuenta por el flujo real; no se crean credenciales.');
    }
    const identity = reassignmentDemoIdentity(recipient.id, input.scenario);
    if ([identity.actorId, identity.sourceId, identity.professionalUserId].includes(recipient.id)) throw new DevelopmentError('El destinatario no puede ser una identidad técnica demo.');
    await seedDevelopment(prisma, options.connectionString, options.nodeEnv);
    await bootstrapAppointmentStatus(prisma);
    await foundation(prisma, identity);
    const context = { userId: identity.actorId, institutionId: demo.institution.id, roleCodes: ['DEMO_REASSIGNMENT_TOOL'], permissions: [...PERMISSIONS] };
    const principal = { userId: recipient.id, sessionId: demoUuid('offline-tool-session') };
    const source = { userId: identity.sourceId, sessionId: principal.sessionId };
    const name = `Atención Demo Reasignación ${input.scenario.toUpperCase()}`;
    const expectedService = { institutionId: demo.institution.id, code: identity.code, name, description: identity.marker, durationMinutes: 30, active: true, allowsWaitlist: true, deletedAt: null, minimumAdvanceMinutes: 0, maximumAdvanceDays: null };
    let service = await prisma.service.findUnique({ where: { institutionId_code: { institutionId: demo.institution.id, code: identity.code } } });
    if (service) requireCompatible(service, expectedService, 'servicio');
    else {
      const created = await domain.catalog.createService({ code: identity.code, name, description: identity.marker, durationMinutes: 30, active: true, allowsWaitlist: true, branchIds: [demo.branch.id] }, context);
      service = await prisma.service.findUniqueOrThrow({ where: { id: created.data.id } });
    }
    await requireOwnedCreation(prisma, 'SERVICE_CREATED', service.id, identity.actorId);
    const branches = await prisma.serviceBranch.findMany({ where: { serviceId: service.id } });
    if (branches.length !== 1 || branches[0]?.branchId !== demo.branch.id || !branches[0]?.active) throw new DevelopmentError('Relaciones del servicio demo modificadas; no se sobrescriben.');

    // A dedicated service prevents changing the manual user's existing waitlist/preferences.
    const entries = await prisma.waitlistEntry.findMany({ where: { serviceId: service.id }, select: { id: true, userId: true, branchId: true, deletedAt: true, status: { select: { code: true } } } });
    if (entries.length > 1 || (entries[0] && (entries[0].userId !== recipient.id || entries[0].branchId !== demo.branch.id || entries[0].deletedAt))) {
      throw new DevelopmentError('El servicio de escenario contiene solicitudes ajenas o modificadas; no se generan ofertas.');
    }
    const expectedProfessional = { userId: identity.professionalUserId, institutionId: demo.institution.id, internalCode: identity.code, description: identity.marker, status: 'ACTIVE', deletedAt: null };
    let professional = await prisma.professional.findUnique({ where: { institutionId_internalCode: { institutionId: demo.institution.id, internalCode: identity.code } } });
    if (professional) requireCompatible(professional, expectedProfessional, 'profesional');
    else {
      const created = await domain.professionals.create({ userId: identity.professionalUserId, internalCode: identity.code, description: identity.marker, branchIds: [demo.branch.id], serviceIds: [service.id] }, context);
      professional = await prisma.professional.findUniqueOrThrow({ where: { id: created.data.id } });
    }
    await requireOwnedCreation(prisma, 'PROFESSIONAL_CREATED', professional.id, identity.actorId);
    const assignments = await prisma.professionalService.findMany({ where: { professionalId: professional.id } });
    const professionalBranches = await prisma.professionalBranch.findMany({ where: { professionalId: professional.id } });
    if (assignments.length !== 1 || assignments[0]?.serviceId !== service.id || !assignments[0]?.active || assignments[0]?.customDurationMinutes !== null ||
        professionalBranches.length !== 1 || professionalBranches[0]?.branchId !== demo.branch.id || !professionalBranches[0]?.active) throw new DevelopmentError('Relaciones del profesional demo modificadas.');
    let availabilities = await prisma.availability.findMany({ where: { OR: [{ professionalId: professional.id }, { serviceId: service.id }] }, include: { slots: true } });
    if (availabilities.length > 1) throw new DevelopmentError('Más de una agenda en el escenario demo; no se duplica.');
    if (!availabilities.length) {
      // Midday UTC one week ahead fits the demo institution's Chilean date, avoiding midnight/DST.
      const startsAt = new Date(); startsAt.setUTCDate(startsAt.getUTCDate() + 7); startsAt.setUTCHours(16, 0, 0, 0);
      await domain.availability.create({ serviceId: service.id, professionalId: professional.id, branchId: demo.branch.id, startsAt: startsAt.toISOString(), endsAt: new Date(+startsAt + 30 * 60_000).toISOString() }, context);
      availabilities = await prisma.availability.findMany({ where: { professionalId: professional.id, serviceId: service.id }, include: { slots: true } });
    }
    const availability = availabilities[0];
    if (!availability || availability.branchId !== demo.branch.id || availability.serviceId !== service.id || availability.professionalId !== professional.id || !availability.active || availability.slots.length !== 1) throw new DevelopmentError('Agenda demo incompatible.');
    await requireOwnedCreation(prisma, 'AVAILABILITY_CREATED', availability.id, identity.actorId);
    const slot = availability.slots[0]!;
    const existingOffers = await prisma.appointmentOffer.findMany({ where: { agendaSlotId: slot.id }, include: {
      candidate: { select: { userId: true } },
      reassignment: { select: { id: true, institutionId: true, serviceId: true, sourceUserId: true } },
    } });
    if (existingOffers.length) {
      if (existingOffers.length !== 1 || existingOffers[0]?.candidate.userId !== recipient.id) throw new DevelopmentError('Ofertas ajenas o múltiples en el escenario; no se modifica.');
      requireCompatible(existingOffers[0]!.reassignment, { institutionId: demo.institution.id, serviceId: service.id, sourceUserId: identity.sourceId }, 'proceso');
      await requireOwnedCreation(prisma, 'REASSIGNMENT_STARTED', existingOffers[0]!.reassignment.id, identity.actorId, true);
      return report(prisma, domain, principal, recipient, input.scenario, existingOffers[0]!.id, true);
    }
    if (slot.startsAt <= new Date()) throw new DevelopmentError('La agenda del escenario ya pasó. No se desplaza ni se revive automáticamente.');
    if (await prisma.reassignment.count({ where: { agendaSlotId: slot.id } })) throw new DevelopmentError('El escenario ya tiene un proceso sin oferta. Revisar sin reiniciar su historia.');
    if (entries[0] && entries[0].status.code !== 'ACTIVE') throw new DevelopmentError('La espera del escenario ya fue finalizada/modificada; no se revive.');
    const entryId = entries[0]?.id ?? (await domain.waitlist.enter({ serviceId: service.id, branchId: demo.branch.id }, principal)).data.id;
    const preferences = { preferredDays: [1, 2, 3, 4, 5, 6, 7], timeRanges: [{ start: '00:00', end: '23:59' }], preferredBranchIds: [], allowsOtherBranches: false, acceptsAnyProfessional: true };
    if (await prisma.waitlistPreference.count({ where: { waitlistEntryId: entryId } })) {
      if (JSON.stringify((await domain.preferences.get(entryId, principal)).data) !== JSON.stringify(preferences)) throw new DevelopmentError('Preferencias demo modificadas; no se sobrescriben.');
    } else await domain.preferences.replace(entryId, preferences, principal);
    const institution = await prisma.institution.findUniqueOrThrow({ where: { id: demo.institution.id }, select: { currentReassignmentPolicyId: true } });
    if (!institution.currentReassignmentPolicyId) {
      if (await prisma.reassignmentPolicy.count({ where: { institutionId: demo.institution.id } })) throw new DevelopmentError('La institución demo tiene historial de política sin current; revisar manualmente.');
      await domain.policy.configure({ rankingStrategy: 'PRIORITY_THEN_WAITING', offerTtlMinutes: 30 }, context);
    }
    let appointment = await prisma.appointment.findUnique({ where: { agendaSlotId: slot.id }, select: { id: true, userId: true, status: { select: { code: true } } } });
    if (!appointment) {
      const booked = await domain.appointments.reserve(slot.id, source);
      appointment = { id: booked.data.id, userId: source.userId, status: { code: booked.data.status } };
    }
    if (appointment.userId !== source.userId || !['AGENDADA', 'CANCELADA'].includes(appointment.status.code)) throw new DevelopmentError('La cita demo pertenece a otra persona o tiene un estado incompatible.');
    await domain.appointments.cancel(appointment.id, source);
    // HU-025 already starts this release in the cancellation transaction. Keep
    // manual generation only for historical releases without a process.
    const automatic = await prisma.reassignment.findFirst({ where: { agendaSlotId: slot.id, appointmentId: appointment.id,
      institutionId: demo.institution.id, sourceUserId: source.userId }, select: { offers: { select: { id: true }, take: 1 } } });
    const offer = automatic ? automatic.offers[0] : (await domain.reassignments.generate(slot.id, context)).data.offer;
    if (!offer) throw new DevelopmentError('HU-009 no encontró candidato compatible. Revisar el proceso; no se fuerza una oferta.');
    return report(prisma, domain, principal, recipient, input.scenario, offer.id, false);
  }, { timeout: 120_000 });
}

async function requireOwnedCreation(prisma: PrismaClient, actionCode: string, resourceId: string, actorUserId: string, allowSystem = false) {
  if (!await prisma.auditEvent.count({ where: { actionCode, resourceId, institutionId: demo.institution.id,
    OR: [{ actorUserId }, ...(allowSystem ? [{ actorType: 'SYSTEM' as const, actorUserId: null }] : [])],
  } })) throw new DevelopmentError('Recurso demo sin evidencia de creación por el tooling; no se reutiliza.');
}

async function report(prisma: PrismaClient, domain: ReassignmentDemoDomain, principal: { userId: string; sessionId: string }, recipient: { id: string; email: string; updatedAt: Date }, scenario: DemoScenario, offerId: string, reused: boolean) {
  const stored = await prisma.appointmentOffer.findUniqueOrThrow({ where: { id: offerId }, select: { candidate: { select: { userId: true } } } });
  if (stored.candidate.userId !== recipient.id) throw new DevelopmentError('HU-009 seleccionó otro destinatario; no se altera su resultado.');
  const offer = (await domain.offers.findMine(principal)).data.find((item) => item.id === offerId);
  if (!offer) throw new DevelopmentError('La oferta no aparece en la consulta propia; revisa coherencia y límite del listado.');
  const unchanged = await prisma.user.findUniqueOrThrow({ where: { id: recipient.id }, select: { updatedAt: true } });
  if (+unchanged.updatedAt !== +recipient.updatedAt) throw new DevelopmentError('La cuenta destinataria cambió durante la preparación; revisar antes de continuar.');
  return { scenario, recipient: recipient.email, reused, offer, elapsed: offer.status === 'PENDING' && Date.parse(offer.expiresAt) <= Date.now() };
}
