import { createHash } from 'node:crypto';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import { Prisma, type PrismaClient } from '../generated/prisma/client.js';
import { institutionPermissions } from '../institutions/institution-administration.service.js';
import { assertDevelopmentTarget, DevelopmentError } from './development.js';
import { isTransactionConflict } from './transaction-conflict.js';

const marker = 'CITAJUSTA_INSTITUTION_ADMINISTRATOR_V1';
const uuid = (key: string) => {
  const hex = createHash('sha256').update(`${marker}:${key}`).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
};
export const institutionAdministratorRole = { id: uuid('role'), code: 'INSTITUTION_PLATFORM_ADMINISTRATOR',
  name: 'Administrador general de instituciones', description: marker, scope: 'GLOBAL' as const, active: true };
const identitySchema = z.object({ email: z.string().trim().email().max(254).transform(value => value.toLowerCase()), userId: z.string().uuid() }).strict();
export function parseInstitutionAdministratorIdentity(input: unknown) {
  const parsed = identitySchema.safeParse(input);
  if (!parsed.success) throw new DevelopmentError('Indica INSTITUTION_ADMIN_EMAIL e INSTITUTION_ADMIN_USER_ID de la misma cuenta ACTIVE existente.');
  return parsed.data;
}
function compatible(row: object, expected: object) {
  const values = new Map(Object.entries(row));
  if (Object.entries(expected).some(([key, value]) => values.get(key) !== value)) {
    throw new DevelopmentError('Provisión detenida: identidad, rol, permiso o asignación incompatible; no se sobrescribe.');
  }
}

// Internal transaction primitive, also exercised by the verified E2E runner. Never exposed over HTTP.
export async function provisionInstitutionAdministrator(tx: Prisma.TransactionClient, identity: { email: string; userId: string }) {
  const target = parseInstitutionAdministratorIdentity(identity);
  const user = await tx.user.findUnique({ where: { email: target.email }, select: { id: true, status: true, deletedAt: true } });
  if (!user || user.id !== target.userId || user.status !== 'ACTIVE' || user.deletedAt !== null) {
    throw new DevelopmentError('La cuenta debe coincidir por email/UUID, existir, estar ACTIVE y no eliminada. No se crean ni modifican credenciales.');
  }
  const role = institutionAdministratorRole;
  const roles = await tx.role.findMany({ where: { OR: [{ id: role.id }, { code: role.code }] } });
  if (roles.length > 1) throw new DevelopmentError('Colisión del rol de administrador general.');
  if (roles[0]) compatible(roles[0], role);
  const links = await tx.rolePermission.findMany({ where: { roleId: role.id }, select: { permissionId: true, permission: { select: { code: true } } } });
  if (links.some(link => !institutionPermissions.some(code => code === link.permission.code))) {
    throw new DevelopmentError('El rol dedicado tiene permisos ajenos; no se modifica.');
  }
  const roleGrants = await tx.userRole.findMany({ where: { roleId: role.id } });
  if (roleGrants.some(grant => grant.institutionId !== null || grant.branchId !== null)) {
    throw new DevelopmentError('Asignación institucional incompatible en el rol GLOBAL dedicado.');
  }
  const grant = { id: uuid(`grant:${user.id}`), userId: user.id, roleId: role.id, institutionId: null,
    branchId: null, active: true, validFrom: null, validTo: null };
  const grants = await tx.userRole.findMany({ where: { OR: [{ id: grant.id }, { userId: user.id, roleId: role.id }] } });
  if (grants.length > 1) throw new DevelopmentError('Asignaciones duplicadas del administrador general.');
  if (grants[0]) compatible(grants[0], grant);
  const permissions = [];
  for (const code of institutionPermissions) {
    const action = code.split('.')[1]!;
    const expected = { code, module: 'institutions', action };
    const id = uuid(code);
    const matches = await tx.permission.findMany({ where: { OR: [{ id }, { code }, { module: 'institutions', action }] } });
    if (matches.length > 1) throw new DevelopmentError('Colisión de permiso institucional.');
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
  if (changed) await AuditService.record(tx, { actorType: 'SYSTEM', actionCode: 'INSTITUTION_ADMINISTRATOR_PROVISIONED',
    resourceType: 'USER_ROLE', resourceId: grant.id, outcome: 'SUCCESS' });
  return { userId: user.id, role: role.code, grantId: grant.id, changed };
}

export async function provisionDevelopmentInstitutionAdministrator(prisma: Pick<PrismaClient, '$transaction'>, options: {
  connectionString: string | undefined; nodeEnv: string | undefined; confirmedDatabase: string | undefined;
  email: string | undefined; userId: string | undefined;
}) {
  const database = assertDevelopmentTarget(options.connectionString, options.nodeEnv);
  if (options.nodeEnv !== 'development' || options.confirmedDatabase !== database) {
    throw new DevelopmentError('Exige NODE_ENV=development y INSTITUTION_ADMIN_CONFIRM_DATABASE igual al nombre local autorizado.');
  }
  const identity = parseInstitutionAdministratorIdentity({ email: options.email, userId: options.userId });
  for (let attempt = 0; ; attempt++) {
    try {
      return await prisma.$transaction(async tx => {
        const rows = await tx.$queryRaw<{ database: string; version: number }[]>`SELECT current_database() AS database, current_setting('server_version_num')::int AS version`;
        if (rows[0]?.database !== database || !Number.isInteger(rows[0]?.version) || rows[0].version < 180000 || rows[0].version >= 190000) {
          throw new DevelopmentError('Identidad de PostgreSQL/base incompatible; no se provisiona.');
        }
        // Serialize only this administrative bootstrap; normal API operations use their own transactions.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(186, 1)`;
        return provisionInstitutionAdministrator(tx, identity);
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (attempt === 0 && isTransactionConflict(error)) continue;
      throw error;
    }
  }
}
