import { createHash } from 'node:crypto';
import type { PrismaClient } from '../generated/prisma/client.js';
import type { ProfessionalAdministrationService } from '../professionals/professional-administration.service.js';
import type { AvailabilityAdministrationService } from '../availability/availability-administration.service.js';
import { localWindow } from '../availability/availability-administration.schemas.js';
import { availableAvailabilityWhere } from '../availability/availability.policy.js';
import { assertDevelopmentTarget, demo, DevelopmentError } from './development.js';

const MARKER = 'CITAJUSTA_BOOKING_DEMO_V1';
const CODE = 'DEMO-BOOKING';
const ROLE = 'DEMO_BOOKING_TOOL';
const PERMISSIONS = ['professionals.create', 'availability.create'];
const uuid = (key: string) => {
  const hex = createHash('sha256').update(`${MARKER}:${key}`).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
};
const actorId = uuid('operator');
const professionalUserId = uuid('professional');
const roleId = uuid('role');
export interface BookingDemoDomain {
  professionals: Pick<ProfessionalAdministrationService, 'create'>;
  availability: Pick<AvailabilityAdministrationService, 'create'>;
}

function compatible(row: object | null, expected: object, label: string) {
  const values = new Map(Object.entries(row ?? {}));
  if (!row || Object.entries(expected).some(([key, value]) => values.get(key) !== value)) {
    throw new DevelopmentError(`Booking demo: ${label} ausente o incompatible; no se sobrescribe. Prepara seed:dev y bootstrap:appointment-status o revisa la colisión.`);
  }
}

// Only technical identities/RBAC are written directly. Neither identity can log in.
async function foundation(prisma: PrismaClient) {
  await prisma.$transaction(async (tx) => {
    for (const identity of [
      { id: actorId, email: 'demo-booking-operator@example.invalid', firstNames: 'Operador Demo', lastNames: 'Booking' },
      { id: professionalUserId, email: 'demo-booking-professional@example.invalid', firstNames: 'Profesional Demo', lastNames: 'Booking' },
    ]) {
      const expected = { ...identity, passwordHash: '!CITA_JUSTA_DEMO_NO_LOGIN!', status: 'ACTIVE' as const, deletedAt: null };
      const rows = await tx.user.findMany({ where: { OR: [{ id: identity.id }, { email: identity.email }] } });
      if (rows.length > 1) throw new DevelopmentError('Colisión de identidad técnica booking demo.');
      if (rows[0]) compatible(rows[0], expected, 'identidad técnica');
      else await tx.user.create({ data: expected });
    }
    const role = { id: roleId, code: ROLE, name: 'Demo local booking', description: MARKER, scope: 'INSTITUTION' as const, active: true };
    const roles = await tx.role.findMany({ where: { OR: [{ id: roleId }, { code: ROLE }] } });
    if (roles.length > 1) throw new DevelopmentError('Colisión de rol booking demo.');
    if (roles[0]) compatible(roles[0], role, 'rol');
    else await tx.role.create({ data: role });
    if (await tx.rolePermission.count({ where: { roleId, permission: { code: { notIn: PERMISSIONS } } } }) ||
        await tx.userRole.count({ where: { roleId, NOT: { userId: actorId, institutionId: demo.institution.id } } }) ||
        await tx.userRole.count({ where: { userId: professionalUserId } })) {
      throw new DevelopmentError('Permisos/asignaciones ajenos en identidades booking demo.');
    }
    for (const code of PERMISSIONS) {
      const [module, action] = code.split('.');
      const fields = { code, module: module!, action: action! };
      const existing = await tx.permission.findUnique({ where: { code } });
      if (existing) compatible(existing, fields, 'permiso');
      const permission = existing ?? await tx.permission.create({ data: { id: uuid(code), ...fields } });
      await tx.rolePermission.upsert({ where: { roleId_permissionId: { roleId, permissionId: permission.id } },
        create: { roleId, permissionId: permission.id }, update: {} });
    }
    const grant = { id: uuid('grant'), userId: actorId, roleId, institutionId: demo.institution.id,
      branchId: null, active: true, validFrom: null, validTo: null };
    const grants = await tx.userRole.findMany({ where: { OR: [{ id: grant.id }, { userId: actorId }] } });
    if (grants.length > 1) throw new DevelopmentError('Asignaciones ajenas del operador booking demo.');
    if (grants[0]) compatible(grants[0], grant, 'asignación');
    else await tx.userRole.create({ data: grant });
  });
}

async function owned(prisma: PrismaClient, actionCode: string, resourceId: string) {
  if (!await prisma.auditEvent.count({ where: { actionCode, resourceId, actorUserId: actorId, institutionId: demo.institution.id } })) {
    throw new DevelopmentError('Recurso sin evidencia de creación por booking demo; no se reutiliza.');
  }
}

export async function prepareBookingDemo(prisma: PrismaClient, domain: BookingDemoDomain, options: {
  connectionString: string | undefined; nodeEnv: string | undefined;
}) {
  const database = assertDevelopmentTarget(options.connectionString, options.nodeEnv);
  // Lock only this tooling. Domain services retain their own transactions; partial
  // preparations can be resumed, never rolled back by deleting historical data.
  return prisma.$transaction(async (lock) => {
    const actual = await lock.$queryRaw<{ database: string }[]>`SELECT current_database() AS database`;
    if (actual[0]?.database !== database) throw new DevelopmentError('La base conectada no coincide con el destino autorizado.');
    const acquired = await lock.$queryRaw<{ acquired: boolean }[]>`SELECT pg_try_advisory_xact_lock(220004, 1) AS acquired`;
    if (!acquired[0]?.acquired) throw new DevelopmentError('Otra preparación booking demo está ejecutándose; repite después.');
    const institution = await prisma.institution.findUnique({ where: { id: demo.institution.id } });
    compatible(institution, demo.institution, 'institución');
    compatible(await prisma.branch.findUnique({ where: { id: demo.branch.id } }), demo.branch, 'sede');
    compatible(await prisma.service.findUnique({ where: { id: demo.service.id } }), demo.service, 'servicio');
    compatible(await prisma.serviceBranch.findUnique({ where: { serviceId_branchId: { serviceId: demo.service.id, branchId: demo.branch.id } } }), { active: true }, 'servicio/sede');
    compatible(await prisma.appointmentStatus.findUnique({ where: { code: 'AGENDADA' } }), { code: 'AGENDADA', active: true, isFinal: false }, 'AGENDADA');
    const timeZone = institution!.timeZone;
    await foundation(prisma);
    const context = { userId: actorId, institutionId: demo.institution.id, roleCodes: [ROLE], permissions: [...PERMISSIONS] };
    const expected = { userId: professionalUserId, institutionId: demo.institution.id, internalCode: CODE,
      description: MARKER, status: 'ACTIVE', deletedAt: null };
    let professional = await prisma.professional.findUnique({ where: { institutionId_internalCode: { institutionId: demo.institution.id, internalCode: CODE } } });
    if (!professional) {
      const result = await domain.professionals.create({ userId: professionalUserId, internalCode: CODE,
        description: MARKER, branchIds: [demo.branch.id], serviceIds: [demo.service.id] }, context);
      professional = await prisma.professional.findUniqueOrThrow({ where: { id: result.data.id } });
    }
    compatible(professional, expected, 'profesional');
    await owned(prisma, 'PROFESSIONAL_CREATED', professional.id);
    const services = await prisma.professionalService.findMany({ where: { professionalId: professional.id } });
    const branches = await prisma.professionalBranch.findMany({ where: { professionalId: professional.id } });
    if (services.length !== 1 || branches.length !== 1) throw new DevelopmentError('Relaciones ajenas del profesional booking demo.');
    compatible(services[0] ?? null, { serviceId: demo.service.id, active: true, customDurationMinutes: null }, 'profesional/servicio');
    compatible(branches[0] ?? null, { branchId: demo.branch.id, active: true }, 'profesional/sede');
    const slotContext = { institutionId: demo.institution.id, branchId: demo.branch.id, serviceId: demo.service.id };
    const available = () => prisma.agendaSlot.findMany({ where: {
      status: 'AVAILABLE', startsAt: { gt: new Date() }, blockedUntilAt: null,
      appointment: { is: null }, reassignments: { none: {} },
      availability: availableAvailabilityWhere(slotContext, professional.id),
    }, select: { id: true, availabilityId: true, startsAt: true, endsAt: true }, orderBy: [{ startsAt: 'asc' }, { id: 'asc' }] });
    let slots = await available();
    const reused = slots.length > 0;
    if (!reused) {
      // Bounded search within the Web's 30-day filter. Skip existing dates entirely,
      // even inactive/historical availability: never rematerialize an old interval.
      const now = new Date();
      for (let day = 1; day <= 28; day++) {
        const start = new Date(now); start.setUTCDate(start.getUTCDate() + day); start.setUTCHours(16, 0, 0, 0);
        const end = new Date(+start + 2 * 60 * 60_000);
        const window = localWindow(start, end, timeZone);
        if (await prisma.availability.count({ where: { professionalId: professional.id, date: window.date } }) ||
            await prisma.agendaSlot.count({ where: { availability: { professionalId: professional.id }, startsAt: { lt: end }, endsAt: { gt: start } } }) ||
            await prisma.holiday.count({ where: { institutionId: demo.institution.id, date: window.date, OR: [{ branchId: null }, { branchId: demo.branch.id }] } }) ||
            await prisma.scheduleBlock.count({ where: { institutionId: demo.institution.id, startsAt: { lt: end }, endsAt: { gt: start },
              AND: [{ OR: [{ branchId: null }, { branchId: demo.branch.id }] },
                { OR: [{ professionalId: null }, { professionalId: professional.id }] }], attentionPointId: null } })) continue;
        await domain.availability.create({ branchId: demo.branch.id, serviceId: demo.service.id, professionalId: professional.id,
          startsAt: start.toISOString(), endsAt: end.toISOString() }, context);
        slots = await available();
        break;
      }
    }
    if (!slots.length) throw new DevelopmentError('No hay cupos demo utilizables en el intervalo preparado. Revisa bloqueos/feriados o repite; no se revive agenda anterior.');
    for (const id of new Set(slots.map((slot) => slot.availabilityId))) await owned(prisma, 'AVAILABILITY_CREATED', id);
    return { reused, institution: demo.institution.name, branch: demo.branch.name, service: demo.service.name,
      professional: 'Profesional Demo Booking', timeZone,
      slots: slots.map((slot) => ({ id: slot.id, startsAt: slot.startsAt.toISOString(), endsAt: slot.endsAt.toISOString() })) };
  }, { timeout: 120_000 });
}
