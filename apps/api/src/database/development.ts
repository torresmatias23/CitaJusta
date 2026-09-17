import { Prisma, type PrismaClient } from '../generated/prisma/client.js';
import { provisionWaitlistCatalog } from './waitlist.bootstrap.js';
import { isTransactionConflict } from './transaction-conflict.js';

export class DevelopmentError extends Error {}

export const demo = {
  institution: { id: 'd1000000-0000-4000-8000-000000000001', name: 'Institución Demo CitaJusta', status: 'ACTIVE', deletedAt: null },
  branch: { id: 'd1000000-0000-4000-8000-000000000002', institutionId: 'd1000000-0000-4000-8000-000000000001', code: 'DEMO-CENTRO', name: 'Sede Centro Demo', status: 'ACTIVE', deletedAt: null },
  service: { id: 'd1000000-0000-4000-8000-000000000003', institutionId: 'd1000000-0000-4000-8000-000000000001', code: 'DEMO-ATENCION', name: 'Atención General Demo', durationMinutes: 30, active: true, allowsWaitlist: true, deletedAt: null },
} as const;

export function assertDevelopmentTarget(connectionString: string | undefined, nodeEnv: string | undefined): string {
  const invalid = () => new DevelopmentError('Destino rechazado: usa NODE_ENV=development y PostgreSQL local citajusta_dev (o citajusta_dev_<sufijo>), sin parámetros de conexión alternativos.');
  if (!connectionString) throw new DevelopmentError('Falta DATABASE_URL. Configura apps/api/.env sin versionar secretos.');
  let url: URL;
  try { url = new URL(connectionString); } catch { throw invalid(); }
  if ((nodeEnv !== undefined && nodeEnv !== 'development') ||
      !['postgres:', 'postgresql:'].includes(url.protocol) ||
      !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname.toLowerCase()) ||
      !/^\/citajusta_dev(?:_[a-z0-9]+)?$/.test(url.pathname) || url.hash ||
      [...url.searchParams].some(([key, value]) => key !== 'schema' || value !== 'public')) throw invalid();
  return url.pathname.slice(1);
}

function compatible(existing: object | null, expected: object, label: string) {
  if (!existing) return;
  const values = new Map(Object.entries(existing));
  if (Object.entries(expected).some(([key, value]) => values.get(key) !== value)) {
    throw new DevelopmentError(`Seed detenido: ${label} demo pertenece a otra identidad o tiene configuración incompatible; no se sobrescribió.`);
  }
}

async function verifyDatabase(tx: Prisma.TransactionClient, database: string) {
  const rows = await tx.$queryRaw<{ database: string }[]>`SELECT current_database() AS database`;
  if (rows[0]?.database !== database) throw new DevelopmentError('La base conectada no coincide con el destino autorizado.');
}

export async function seedDevelopment(prisma: Pick<PrismaClient, '$transaction'>, connectionString: string | undefined, nodeEnv: string | undefined) {
  const database = assertDevelopmentTarget(connectionString, nodeEnv);
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await prisma.$transaction(async (tx) => {
        await verifyDatabase(tx, database);
        const institution = await tx.institution.findUnique({ where: { id: demo.institution.id } });
        const branch = await tx.branch.findUnique({ where: { id: demo.branch.id } });
        const service = await tx.service.findUnique({ where: { id: demo.service.id } });
        const link = await tx.serviceBranch.findUnique({ where: { serviceId_branchId: { serviceId: demo.service.id, branchId: demo.branch.id } } });
        compatible(institution, demo.institution, 'institución');
        compatible(branch, demo.branch, 'sede');
        compatible(service, demo.service, 'servicio');
        compatible(link, { active: true }, 'relación servicio/sede');
        // Sólo crea lo ausente; conserva metadatos y timestamps de registros compatibles.
        if (!institution) await tx.institution.create({ data: demo.institution });
        if (!branch) await tx.branch.create({ data: demo.branch });
        if (!service) await tx.service.create({ data: demo.service });
        if (!link) await tx.serviceBranch.create({ data: { serviceId: demo.service.id, branchId: demo.branch.id } });
        await provisionWaitlistCatalog(tx, demo.institution.id);
        return { database, institutionId: demo.institution.id };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (attempt === 0 && isTransactionConflict(error)) continue;
      throw error;
    }
  }
  throw new Error('No se pudo completar el seed.');
}

export type MigrationFile = { name: string; checksum: string };
type AppliedMigration = { migration_name: string; checksum: string; finished_at: Date | null; rolled_back_at: Date | null };
export function migrationsMatch(expected: MigrationFile[], applied: AppliedMigration[]): boolean {
  const current = applied.filter((row) => !row.rolled_back_at);
  return expected.length > 0 && current.length === expected.length && current.every((row) =>
    row.finished_at !== null && expected.some((file) => file.name === row.migration_name && file.checksum === row.checksum));
}

export async function checkDevelopment(prisma: Pick<PrismaClient, '$transaction'>, connectionString: string | undefined, nodeEnv: string | undefined, migrations: MigrationFile[]) {
  const database = assertDevelopmentTarget(connectionString, nodeEnv);
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SET TRANSACTION READ ONLY`;
    await verifyDatabase(tx, database);
    const checks: { ok: boolean; message: string }[] = [{ ok: true, message: `PostgreSQL conectado: ${database}` }];
    const applied = await tx.$queryRaw<AppliedMigration[]>`SELECT migration_name, checksum, finished_at, rolled_back_at FROM _prisma_migrations`;
    checks.push({ ok: migrationsMatch(migrations, applied), message: 'Migraciones aplicadas y checksums coinciden con el repositorio (no sustituye una auditoría completa de drift)' });
    const statuses = await tx.waitlistStatus.findMany({ select: { code: true, active: true, isFinal: true } });
    for (const code of ['ACTIVE', 'WITHDRAWN', 'FULFILLED']) {
      checks.push({ ok: statuses.some((status) => status.code === code && status.active && status.isFinal === (code !== 'ACTIVE')), message: `Waitlist ${code}: debe existir, activo y con semántica final compatible` });
    }
    const institution = await tx.institution.findUnique({ where: { id: demo.institution.id } });
    const branch = await tx.branch.findUnique({ where: { id: demo.branch.id } });
    const service = await tx.service.findUnique({ where: { id: demo.service.id } });
    const link = await tx.serviceBranch.findUnique({ where: { serviceId_branchId: { serviceId: demo.service.id, branchId: demo.branch.id } } });
    let validDemo = Boolean(institution && branch && service && link);
    try { compatible(institution, demo.institution, 'institución'); compatible(branch, demo.branch, 'sede'); compatible(service, demo.service, 'servicio'); compatible(link, { active: true }, 'relación'); } catch { validDemo = false; }
    checks.push({ ok: validDemo, message: 'Catálogo demo: institución, sede, servicio y relación compatibles' });
    const priority = await tx.priority.findUnique({ where: { institutionId_code: { institutionId: demo.institution.id, code: 'STANDARD' } } });
    checks.push({ ok: priority?.active === true, message: 'Institución Demo CitaJusta: prioridad STANDARD institucional activa' });
    const appointments = await tx.appointmentStatus.findMany({ select: { code: true, active: true, isFinal: true, allowsCancellation: true, allowsConfirmation: true } });
    for (const code of ['AGENDADA', 'CANCELADA', 'ATENDIDA', 'INASISTENCIA']) {
      checks.push({ ok: appointments.some((status) => status.code === code && status.active && status.isFinal === (code !== 'AGENDADA') && (code === 'AGENDADA' || (!status.allowsCancellation && !status.allowsConfirmation))), message: `Catálogo de citas ${code} compatible (bootstrap:appointment-status)` });
    }
    return checks;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
}
