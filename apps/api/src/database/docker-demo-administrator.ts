import { createHash } from 'node:crypto';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import { Prisma, type PrismaClient } from '../generated/prisma/client.js';
import { CATALOG_PERMISSIONS } from '../services/catalog-administration.service.js';
import { PROFESSIONAL_PERMISSIONS } from '../professionals/professional-administration.service.js';
import { parseInstitutionAdministratorIdentity, provisionInstitutionAdministrator } from './institution-administrator.js';
import { isTransactionConflict } from './transaction-conflict.js';

export class DemoProvisionError extends Error {}

const marker = 'CITAJUSTA_DOCKER_INSTITUTION_OPERATOR_V1';
const uuid = (key: string, namespace = marker) => {
  const hex = createHash('sha256').update(`${namespace}:${key}`).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
};
export const demoOperatorRole = { id: uuid('role'), code: 'DEMO_INSTITUTION_SETUP_OPERATOR',
  name: 'Operador de preparación Docker DEMO', description: marker, scope: 'INSTITUTION' as const, isSystem: false, active: true };
export const demoOperatorPermissions = [
  CATALOG_PERMISSIONS.readBranches, CATALOG_PERMISSIONS.createBranch,
  CATALOG_PERMISSIONS.readServices, CATALOG_PERMISSIONS.createService,
  PROFESSIONAL_PERMISSIONS.read, PROFESSIONAL_PERMISSIONS.create,
  'availability.read', 'availability.create',
] as const;

const agendaReaderMarker = 'CITAJUSTA_DOCKER_AGENDA_READER_V1';
const agendaReaderUuid = (key: string) => uuid(key, agendaReaderMarker);
export const demoAgendaReaderRole = { id: agendaReaderUuid('role'), code: 'DEMO_DOCKER_AGENDA_READER',
  name: 'Lector de agenda Docker DEMO', description: agendaReaderMarker, scope: 'INSTITUTION' as const, isSystem: false, active: true };
export const demoAgendaReaderPermissions = ['agenda.read'] as const;

const identity = { email: z.string(), userId: z.string().uuid(), confirmation: z.string() };
const requestSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('platform'), ...identity }).strict(),
  z.object({ mode: z.literal('institution'), ...identity, institutionId: z.string().uuid() }).strict(),
  z.object({ mode: z.literal('agenda-reader'), ...identity, institutionId: z.string().uuid() }).strict(),
]);
export function parseDemoProvisionRequest(input: unknown) {
  const parsed = requestSchema.safeParse(input);
  if (!parsed.success) throw new DemoProvisionError('Provisión DEMO: modo, identidad o confirmación obligatoria inválidos.');
  const request = parsed.data;
  const target = parseInstitutionAdministratorIdentity({ email: request.email, userId: request.userId });
  const expected = `citajusta_docker:${request.mode}:${target.userId}${request.mode !== 'platform' ? `:${request.institutionId}` : ''}`;
  if (request.confirmation !== expected) throw new DemoProvisionError('Provisión DEMO: falta confirmación exacta de base, acción, cuenta e institución cuando corresponda.');
  return { ...request, ...target };
}

function compatible(row: object, expected: object) {
  const values = new Map(Object.entries(row));
  if (Object.entries(expected).some(([key, value]) => values.get(key) !== value)) {
    throw new DemoProvisionError('Provisión DEMO: rol, permiso o asignación incompatible; no se sobrescribe.');
  }
}

async function provisionInstitutionalRole(tx: Prisma.TransactionClient, request: Exclude<ReturnType<typeof parseDemoProvisionRequest>, { mode: 'platform' }>) {
  const institution = await tx.institution.findUnique({ where: { id: request.institutionId },
    select: { status: true, deletedAt: true } });
  if (!institution || institution.status !== 'ACTIVE' || institution.deletedAt !== null) {
    throw new DemoProvisionError('Provisión DEMO: la institución debe existir, estar ACTIVE y no eliminada.');
  }
  const user = await tx.user.findUnique({ where: { email: request.email }, select: { id: true, status: true, deletedAt: true } });
  if (!user || user.id !== request.userId || user.status !== 'ACTIVE' || user.deletedAt !== null) {
    throw new DemoProvisionError('Provisión DEMO: la cuenta debe coincidir por UUID/correo, existir, estar ACTIVE y no eliminada.');
  }
  const role = request.mode === 'agenda-reader' ? demoAgendaReaderRole : demoOperatorRole;
  const allowedPermissions = request.mode === 'agenda-reader' ? demoAgendaReaderPermissions : demoOperatorPermissions;
  const grantUuid = request.mode === 'agenda-reader' ? agendaReaderUuid : uuid;
  const roles = await tx.role.findMany({ where: { OR: [{ id: role.id }, { code: role.code }] } });
  if (roles.length > 1) throw new DemoProvisionError('Provisión DEMO: colisión del rol dedicado.');
  if (roles[0]) compatible(roles[0], role);
  const links = await tx.rolePermission.findMany({ where: { roleId: role.id },
    select: { permissionId: true, permission: { select: { code: true } } } });
  if (links.some(link => !allowedPermissions.some(code => code === link.permission.code))) {
    throw new DemoProvisionError('Provisión DEMO: el rol dedicado contiene permisos ajenos.');
  }
  const roleGrants = await tx.userRole.findMany({ where: { roleId: role.id } });
  // Like the Desktop toolings, this dedicated setup role has one approved owner.
  // Filling missing links must never expand another account's effective rights.
  if (roleGrants.length > 1 || roleGrants.some(grant => grant.userId !== user.id ||
    grant.institutionId !== request.institutionId || grant.branchId !== null)) {
    throw new DemoProvisionError('Provisión DEMO: asignación ajena, duplicada o fuera del alcance institucional.');
  }
  const grant = { id: grantUuid(`grant:${user.id}:${request.institutionId}`), userId: user.id, roleId: role.id,
    institutionId: request.institutionId, branchId: null, active: true, validFrom: null, validTo: null };
  const grants = await tx.userRole.findMany({ where: { OR: [{ id: grant.id },
    { userId: user.id, roleId: role.id, institutionId: request.institutionId }] } });
  if (grants.length > 1) throw new DemoProvisionError('Provisión DEMO: asignaciones duplicadas.');
  if (grants[0]) compatible(grants[0], grant);
  const permissions = [];
  for (const code of allowedPermissions) {
    const [module, action] = code.split('.');
    const expected = { code, module: module!, action: action! };
    const id = grantUuid(code);
    const matches = await tx.permission.findMany({ where: { OR: [{ id }, { code }, { module: expected.module, action: expected.action }] } });
    if (matches.length > 1) throw new DemoProvisionError('Provisión DEMO: colisión de permiso.');
    if (matches[0]) compatible(matches[0], expected);
    permissions.push({ id: matches[0]?.id ?? id, ...expected, exists: Boolean(matches[0]) });
  }
  let changed = false;
  if (!roles.length) { await tx.role.create({ data: role }); changed = true; }
  for (const { exists, ...permission } of permissions) {
    if (!exists) { await tx.permission.create({ data: permission }); changed = true; }
    if (!links.some(link => link.permissionId === permission.id)) {
      await tx.rolePermission.create({ data: { roleId: role.id, permissionId: permission.id } }); changed = true;
    }
  }
  if (!grants.length) { await tx.userRole.create({ data: grant }); changed = true; }
  // Keep the event specific to the provisioned role, in this same transaction.
  if (changed) await AuditService.record(tx, { institutionId: request.institutionId, actorType: 'SYSTEM',
    actionCode: request.mode === 'agenda-reader' ? 'AGENDA_READER_PROVISIONED' : 'INSTITUTION_ADMINISTRATOR_PROVISIONED',
    resourceType: 'USER_ROLE', resourceId: grant.id, outcome: 'SUCCESS' });
  return { role: role.code, changed };
}

// Internal primitive, not an HTTP endpoint. The Docker entry point also validates
// the exact Compose URL and migration history before constructing this client.
export async function provisionDockerDemoAdministrator(prisma: Pick<PrismaClient, '$transaction'>, input: unknown) {
  const request = parseDemoProvisionRequest(input);
  for (let attempt = 0; ; attempt++) {
    try {
      return await prisma.$transaction(async tx => {
        // Recheck identity on the actual writing connection, not only preflight's connection.
        const [actual] = await tx.$queryRaw<{ database: string; username: string; version: number; marker: string | null }[]>`
          SELECT current_database() AS database, current_user AS username,
            current_setting('server_version_num')::int AS version,
            shobj_description(oid, 'pg_database') AS marker
          FROM pg_database WHERE datname = current_database()`;
        if (!actual || actual.database !== 'citajusta_docker' || actual.username !== 'citajusta' ||
          !Number.isInteger(actual.version) || actual.version < 180000 || actual.version >= 190000 ||
          actual.marker !== 'citajusta-capstone-docker-v1') {
          throw new DemoProvisionError('Provisión DEMO: identidad PostgreSQL/base/marcador incompatible.');
        }
        const [lock] = await tx.$queryRaw<{ acquired: boolean }[]>`SELECT pg_try_advisory_xact_lock(186, 1) AS acquired`;
        if (!lock?.acquired) throw new DemoProvisionError('Provisión DEMO: otra provisión está ejecutándose; repetir después.');
        return request.mode === 'platform'
          ? provisionInstitutionAdministrator(tx, { email: request.email, userId: request.userId })
          : provisionInstitutionalRole(tx, request);
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 5000, timeout: 15000 });
    } catch (error) {
      if (attempt === 0 && isTransactionConflict(error)) continue;
      throw error;
    }
  }
}
