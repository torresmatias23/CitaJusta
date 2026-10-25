import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

// A fresh namespace per run; never cleans or reuses historical checkpoint IDs.
export const FIXTURE_EMAIL_PREFIX = `e2e_audit+${randomUUID()}-`;
export const ids = Object.fromEntries([
  'institutionA', 'institutionB', 'branchA1', 'branchA2', 'branchB1',
  'serviceA', 'serviceA2', 'serviceB', 'professionalA', 'professionalA2', 'professionalB',
  'availabilityMain', 'availabilityOtherContext', 'availabilityCrossTenant', 'slotAvailable',
  'roleInstitution', 'roleBranch', 'roleGlobal',
  'roleAgendaReader', 'grantAgendaReader', 'permissionAgendaRead',
].map((name) => [name, randomUUID()]));
const institutions = [ids.institutionA, ids.institutionB];
const roles = [ids.roleInstitution, ids.roleBranch, ids.roleGlobal, ids.roleAgendaReader];

// E2E-owned RBAC data only: never invoke the Docker DEMO identity/provisioning wrapper.
export async function createAgendaReaderAuditFixture(prisma, userId, recordAudit) {
  return prisma.$transaction(async (tx) => {
    let permission = await tx.permission.findUnique({ where: { code: 'agenda.read' } });
    if (permission) {
      assert.equal(permission.module, 'agenda'); assert.equal(permission.action, 'read');
    } else {
      permission = await tx.permission.create({ data: { id: ids.permissionAgendaRead,
        code: 'agenda.read', module: 'agenda', action: 'read' } });
    }
    await tx.role.create({ data: { id: ids.roleAgendaReader, code: `E2E_AUDIT_AGENDA_READER_${ids.roleAgendaReader}`,
      name: 'Audit agenda reader fixture', scope: 'INSTITUTION', isSystem: false, active: true } });
    await tx.rolePermission.create({ data: { roleId: ids.roleAgendaReader, permissionId: permission.id } });
    const grant = await tx.userRole.create({ data: { id: ids.grantAgendaReader, userId,
      roleId: ids.roleAgendaReader, institutionId: ids.institutionA, branchId: null, active: true } });
    await recordAudit(tx, { institutionId: ids.institutionA, actorType: 'SYSTEM',
      actionCode: 'AGENDA_READER_PROVISIONED', resourceType: 'USER_ROLE', resourceId: grant.id, outcome: 'SUCCESS' });
    return grant;
  }, { isolationLevel: 'Serializable' });
}

export async function createAuditFixtures(prisma, adminId, secondUserId) {
  await prisma.institution.createMany({ data: institutions.map((id) => ({ id, name: `E2E Audit ${id}`, timeZone: 'America/Santiago' })) });
  await prisma.role.createMany({ data: [
    { id: ids.roleGlobal, code: `E2E_AUDIT_${ids.roleGlobal}`, name: 'Audit global', scope: 'GLOBAL' },
    { id: ids.roleInstitution, code: `E2E_AUDIT_${ids.roleInstitution}`, name: 'Audit institution', scope: 'INSTITUTION' },
    { id: ids.roleBranch, code: `E2E_AUDIT_${ids.roleBranch}`, name: 'Audit branch', scope: 'BRANCH' },
  ] });
  await prisma.userRole.create({ data: { id: randomUUID(), userId: adminId, roleId: ids.roleInstitution, institutionId: ids.institutionA } });
  const groups = [
    [ids.institutionA, ids.branchA1, ids.serviceA, ids.professionalA, adminId, ids.availabilityMain],
    [ids.institutionA, ids.branchA2, ids.serviceA2, ids.professionalA2, secondUserId, ids.availabilityOtherContext],
    [ids.institutionB, ids.branchB1, ids.serviceB, ids.professionalB, adminId, ids.availabilityCrossTenant],
  ];
  const startsAt = new Date(); startsAt.setUTCDate(startsAt.getUTCDate() + 7); startsAt.setUTCHours(15, 0, 0, 0);
  for (const [institutionId, branchId, serviceId, professionalId, userId, availabilityId] of groups) {
    await prisma.branch.create({ data: { id: branchId, institutionId, code: branchId, name: 'Audit branch' } });
    await prisma.service.create({ data: { id: serviceId, institutionId, code: `AUDIT_${serviceId}`, name: 'Audit service', durationMinutes: 30 } });
    await prisma.professional.create({ data: { id: professionalId, institutionId, userId } });
    await prisma.serviceBranch.create({ data: { branchId, serviceId } });
    await prisma.professionalService.create({ data: { professionalId, serviceId } });
    await prisma.professionalBranch.create({ data: { professionalId, branchId } });
    await prisma.availability.create({ data: { id: availabilityId, branchId, serviceId, professionalId,
      date: new Date(startsAt.toISOString().slice(0, 10)), startTime: new Date('1970-01-01T00:00:00Z'), endTime: new Date('1970-01-01T23:59:00Z') } });
  }
  await prisma.agendaSlot.create({ data: { id: ids.slotAvailable, availabilityId: ids.availabilityMain,
    startsAt, endsAt: new Date(+startsAt + 1_800_000), status: 'AVAILABLE' } });
}

export async function cleanupAuditFixtures(prisma) {
  const appointmentScope = { institutionId: { in: institutions } };
  await prisma.scheduleBlock.deleteMany({ where: { institutionId: { in: institutions } } });
  await prisma.institution.updateMany({ where: { id: { in: institutions } }, data: { currentReassignmentPolicyId: null } });
  await prisma.reassignmentPolicy.deleteMany({ where: { institutionId: { in: institutions } } });
  await prisma.appointmentHistory.deleteMany({ where: { appointment: appointmentScope } });
  await prisma.confirmation.deleteMany({ where: { appointment: appointmentScope } });
  await prisma.cancellation.deleteMany({ where: { appointment: appointmentScope } });
  await prisma.appointment.deleteMany({ where: appointmentScope });
  await prisma.agendaSlot.deleteMany({ where: { availability: { branch: { institutionId: { in: institutions } } } } });
  await prisma.availability.deleteMany({ where: { branch: { institutionId: { in: institutions } } } });
  await prisma.professionalService.deleteMany({ where: { professional: { institutionId: { in: institutions } } } });
  await prisma.professionalBranch.deleteMany({ where: { professional: { institutionId: { in: institutions } } } });
  await prisma.professional.deleteMany({ where: { institutionId: { in: institutions } } });
  await prisma.serviceBranch.deleteMany({ where: { service: { institutionId: { in: institutions } } } });
  await prisma.service.deleteMany({ where: { institutionId: { in: institutions } } });
  await prisma.userRole.deleteMany({ where: { roleId: { in: roles } } });
  await prisma.rolePermission.deleteMany({ where: { roleId: { in: roles } } });
  await prisma.role.deleteMany({ where: { id: { in: roles } } });
  await prisma.permission.deleteMany({ where: { id: ids.permissionAgendaRead, code: 'agenda.read', module: 'agenda', action: 'read' } });
  await prisma.branch.deleteMany({ where: { institutionId: { in: institutions } } });
  await prisma.institution.deleteMany({ where: { id: { in: institutions } } });
  const userScope = { email: { startsWith: FIXTURE_EMAIL_PREFIX } };
  await prisma.notification.deleteMany({ where: { OR: [{ institutionId: { in: institutions } }, { recipient: userScope }] } });
  await prisma.auditEvent.deleteMany({ where: { OR: [{ institutionId: { in: institutions } }, { actorUserId: { in: (await prisma.user.findMany({ where: userScope, select: { id: true } })).map((user) => user.id) } }] } });
  await prisma.authSession.deleteMany({ where: { user: userScope } });
  await prisma.externalIdentity.deleteMany({ where: { user: userScope, provider: 'GOOGLE', providerSubject: { startsWith: FIXTURE_EMAIL_PREFIX } } });
  await prisma.user.deleteMany({ where: userScope });
}

export async function assertAuditClean(prisma) {
  assert.equal(await prisma.role.count({ where: { id: { in: roles } } }), 0);
  assert.equal(await prisma.userRole.count({ where: { id: ids.grantAgendaReader } }), 0);
  assert.equal(await prisma.permission.count({ where: { id: ids.permissionAgendaRead } }), 0);
  assert.equal(await prisma.auditEvent.count({ where: { institutionId: { in: institutions } } }), 0);
  assert.equal(await prisma.institution.count({ where: { id: { in: institutions } } }), 0);
  assert.equal(await prisma.user.count({ where: { email: { startsWith: FIXTURE_EMAIL_PREFIX } } }), 0);
  assert.equal(await prisma.externalIdentity.count({ where: { provider: 'GOOGLE', providerSubject: { startsWith: FIXTURE_EMAIL_PREFIX } } }), 0);
}
