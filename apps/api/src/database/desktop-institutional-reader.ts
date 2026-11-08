import { createHash } from 'node:crypto';
import { Prisma, type PrismaClient } from '../generated/prisma/client.js';
import { assertDevelopmentTarget, demo, DevelopmentError } from './development.js';
import { isTransactionConflict } from './transaction-conflict.js';

const MARKER = 'CITAJUSTA_DESKTOP_INSTITUTIONAL_READER_V1';
const ROLE = 'DEMO_DESKTOP_INSTITUTIONAL_READER';
const EMAIL = 'matias.desktop.test@example.test';
const permissions = [
  { code: 'users.read', module: 'users', action: 'read' },
  { code: 'waitlist.read', module: 'waitlist', action: 'read' },
] as const;
const uuid = (key: string) => {
  const hex = createHash('sha256').update(`${MARKER}:${key}`).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
};
function compatible(row: object, expected: object, label: string) {
  const values = new Map(Object.entries(row));
  if (Object.entries(expected).some(([key, value]) => values.get(key) !== value)) {
    throw new DevelopmentError(`Desktop RF-038: ${label} incompatible; no se sobrescribe.`);
  }
}
export function parseDesktopInstitutionalReaderEmail(email: string | undefined): string {
  if (email?.trim().toLowerCase() !== EMAIL) {
    throw new DevelopmentError(`Configura DESKTOP_INSTITUTIONAL_READER_EMAIL=${EMAIL}. No se autorizan otras cuentas.`);
  }
  return EMAIL;
}

// Check is the default. Apply repeats every check inside the write transaction.
export async function seedDesktopInstitutionalReader(prisma: Pick<PrismaClient, '$transaction'>, options: {
  connectionString: string | undefined; nodeEnv: string | undefined; email: string | undefined; apply?: boolean;
}) {
  const database = assertDevelopmentTarget(options.connectionString, options.nodeEnv);
  if (options.nodeEnv !== 'development') throw new DevelopmentError('Este tooling exige NODE_ENV=development explícito.');
  const email = parseDesktopInstitutionalReaderEmail(options.email);
  for (let attempt = 0; ; attempt++) {
    try {
      return await prisma.$transaction(async (tx) => {
        if (options.apply !== true) await tx.$executeRaw`SET TRANSACTION READ ONLY`;
        const rows = await tx.$queryRaw<{ database: string }[]>`SELECT current_database() AS database`;
        if (rows[0]?.database !== database) throw new DevelopmentError('La base conectada no coincide con el destino autorizado.');
        const institution = await tx.institution.findUnique({ where: { id: demo.institution.id }, select: { id: true, name: true, status: true, deletedAt: true } });
        if (!institution) throw new DevelopmentError('Falta la institución demo compatible. No se crean instituciones.');
        compatible(institution, demo.institution, 'institución demo');
        const user = await tx.user.findUnique({ where: { email }, select: { id: true, email: true, status: true, deletedAt: true } });
        if (!user || user.status !== 'ACTIVE' || user.deletedAt !== null) {
          throw new DevelopmentError('La cuenta debe existir, estar ACTIVE y no estar eliminada. No se crean ni modifican usuarios.');
        }
        compatible(user, { email }, 'cuenta');
        // Reuse compatible permissions; only provision missing exact codes, never repair a collision.
        const required: { id: string; code: string; module: string; action: string; exists: boolean }[] = [];
        for (const fields of permissions) {
          const id = uuid(`permission:${fields.code}`);
          const matches = await tx.permission.findMany({ where: { OR: [{ id }, { code: fields.code }, { module: fields.module, action: fields.action }] },
            select: { id: true, code: true, module: true, action: true } });
          if (matches.length > 1) throw new DevelopmentError('Colisión de identidad de permiso Desktop RF-038.');
          if (matches[0]) compatible(matches[0], fields, 'permiso');
          required.push({ id: matches[0]?.id ?? id, ...fields, exists: matches.length === 1 });
        }
        const role = { id: uuid('role'), code: ROLE, name: 'Demo local Desktop consultas RF-038', description: MARKER,
          scope: 'INSTITUTION' as const, isSystem: false, active: true };
        const roles = await tx.role.findMany({ where: { OR: [{ id: role.id }, { code: role.code }] } });
        if (roles.length > 1) throw new DevelopmentError('Colisión de identidad del rol Desktop RF-038.');
        if (roles[0]) compatible(roles[0], role, 'rol');
        const links = await tx.rolePermission.findMany({ where: { roleId: role.id }, select: { permissionId: true } });
        if (links.some(link => !required.some(permission => permission.id === link.permissionId))) {
          throw new DevelopmentError('El rol Desktop RF-038 contiene permisos ajenos.');
        }
        const grant = { id: uuid(`grant:${user.id}`), userId: user.id, roleId: role.id, institutionId: demo.institution.id,
          branchId: null, assignedByUserId: null, active: true, validFrom: null, validTo: null };
        // Check all assignments of this dedicated role, including other users/institutions and inactive grants.
        const grants = await tx.userRole.findMany({ where: { OR: [{ roleId: role.id }, { id: grant.id }] } });
        if (grants.length > 1) throw new DevelopmentError('El rol Desktop RF-038 tiene asignaciones ajenas o duplicadas.');
        if (grants[0]) compatible(grants[0], grant, 'asignación');
        const existing = await tx.userRole.findMany({ where: { userId: user.id }, select: { id: true } });
        const missing = { role: !roles.length, links: required.filter(permission => !links.some(link => link.permissionId === permission.id)), grant: !grants.length };
        if (options.apply === true) {
          if (missing.role) await tx.role.create({ data: role });
          for (const { exists, ...permission } of required) if (!exists) await tx.permission.create({ data: permission });
          for (const permission of missing.links) await tx.rolePermission.create({ data: { roleId: role.id, permissionId: permission.id } });
          if (missing.grant) await tx.userRole.create({ data: grant });
        }
        return { database, email, userId: user.id, institutionId: institution.id, role: ROLE, permissions: permissions.map(p => p.code),
          existingAssignments: existing.length, missingPermissions: required.filter(p => !p.exists).map(p => p.code),
          changes: Number(missing.role) + required.filter(p => !p.exists).length + missing.links.length + Number(missing.grant), applied: options.apply === true };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (attempt === 0 && isTransactionConflict(error)) continue;
      throw error;
    }
  }
}
