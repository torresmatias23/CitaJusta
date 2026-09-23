import { createHash } from 'node:crypto';
import { z } from 'zod';
import { Prisma, type PrismaClient } from '../generated/prisma/client.js';
import { assertDevelopmentTarget, demo, DevelopmentError } from './development.js';
import { isTransactionConflict } from './transaction-conflict.js';

const MARKER = 'CITAJUSTA_DESKTOP_PROFESSIONAL_ADMIN_V1';
const ROLE = 'DEMO_DESKTOP_PROFESSIONAL_ADMIN';
const PERMISSIONS = ['professionals.read', 'professionals.create', 'professionals.update', 'branches.read', 'services.read'] as const;
const uuid = (key: string) => {
  const hex = createHash('sha256').update(`${MARKER}:${key}`).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
};
function compatible(row: object, expected: object, label: string) {
  const values = new Map(Object.entries(row));
  if (Object.entries(expected).some(([key, value]) => values.get(key) !== value)) {
    throw new DevelopmentError(`Desktop profesionales: ${label} incompatible; no se sobrescribe.`);
  }
}
export function parseDesktopProfessionalAdminEmail(email: string | undefined): string {
  const parsed = z.string().trim().email().max(254).safeParse(email);
  if (!parsed.success) throw new DevelopmentError('Configura DESKTOP_PROFESSIONAL_ADMIN_EMAIL con el email válido de una cuenta ACTIVE existente.');
  return parsed.data.toLowerCase();
}

export async function seedDesktopProfessionalAdmin(prisma: Pick<PrismaClient, '$transaction'>, options: {
  connectionString: string | undefined; nodeEnv: string | undefined; email: string | undefined;
}) {
  const database = assertDevelopmentTarget(options.connectionString, options.nodeEnv);
  if (options.nodeEnv !== 'development') throw new DevelopmentError('Este tooling exige NODE_ENV=development explícito.');
  const email = parseDesktopProfessionalAdminEmail(options.email);
  for (let attempt = 0; ; attempt++) {
    try {
      return await prisma.$transaction(async (tx) => {
        const rows = await tx.$queryRaw<{ database: string }[]>`SELECT current_database() AS database`;
        if (rows[0]?.database !== database) throw new DevelopmentError('La base conectada no coincide con el destino autorizado.');
        const institution = await tx.institution.findUnique({ where: { id: demo.institution.id }, select: { id: true, name: true, status: true, deletedAt: true } });
        if (!institution) throw new DevelopmentError('Falta la institución demo. Ejecuta seed:dev primero.');
        compatible(institution, demo.institution, 'institución demo');
        const user = await tx.user.findUnique({ where: { email }, select: { id: true, email: true, status: true, deletedAt: true } });
        if (!user || user.status !== 'ACTIVE' || user.deletedAt !== null) {
          throw new DevelopmentError('La cuenta debe existir, estar ACTIVE y no estar eliminada. No se crean ni modifican usuarios.');
        }
        const role = { id: uuid('role'), code: ROLE, name: 'Demo local Desktop profesionales', description: MARKER, scope: 'INSTITUTION' as const, active: true };
        const roles = await tx.role.findMany({ where: { OR: [{ id: role.id }, { code: role.code }] } });
        if (roles.length > 1) throw new DevelopmentError('Colisión de identidad del rol Desktop profesionales.');
        if (roles[0]) compatible(roles[0], role, 'rol');
        const links = await tx.rolePermission.findMany({ where: { roleId: role.id }, select: { permissionId: true, permission: { select: { code: true } } } });
        if (links.some((link) => !PERMISSIONS.some((code) => code === link.permission.code))) {
          throw new DevelopmentError('El rol Desktop profesionales contiene permisos ajenos.');
        }
        const grant = { id: uuid(`grant:${user.id}`), userId: user.id, roleId: role.id, institutionId: demo.institution.id,
          branchId: null, active: true, validFrom: null, validTo: null };
        // Inspect every grant of this dedicated role, including inactive and differently scoped grants.
        // Unrelated roles held by the selected user are intentionally untouched.
        const grants = await tx.userRole.findMany({ where: { OR: [{ roleId: role.id }, { id: grant.id }] } });
        if (grants.length > 1) throw new DevelopmentError('El rol Desktop profesionales tiene asignaciones ajenas o duplicadas.');
        if (grants[0]) compatible(grants[0], grant, 'asignación');
        const permissions: { id: string; code: string; module: string; action: string; exists: boolean }[] = [];
        for (const code of PERMISSIONS) {
          const [module, action] = code.split('.');
          const fields = { code, module: module!, action: action! };
          const id = uuid(`permission:${code}`);
          const matches = await tx.permission.findMany({ where: { OR: [{ id }, { code }] }, select: { id: true, code: true, module: true, action: true } });
          if (matches.length > 1) throw new DevelopmentError('Colisión de identidad de permiso Desktop profesionales.');
          if (matches[0]) compatible(matches[0], fields, 'permiso');
          permissions.push({ id: matches[0]?.id ?? id, ...fields, exists: matches.length === 1 });
        }
        // Only insert missing compatible RBAC records, preserving all existing timestamps.
        if (!roles.length) await tx.role.create({ data: role });
        for (const { exists, ...permission } of permissions) {
          if (!exists) await tx.permission.create({ data: permission });
          if (!links.some((link) => link.permissionId === permission.id)) {
            await tx.rolePermission.create({ data: { roleId: role.id, permissionId: permission.id } });
          }
        }
        if (!grants.length) await tx.userRole.create({ data: grant });
        return { email: user.email, institutionId: institution.id, role: ROLE, permissions: [...PERMISSIONS] };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (attempt === 0 && isTransactionConflict(error)) continue;
      throw error;
    }
  }
}
