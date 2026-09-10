import { randomUUID } from 'node:crypto';
import { InstitutionStatus, Prisma, type PrismaClient } from '../generated/prisma/client.js';
import { isTransactionConflict } from './transaction-conflict.js';

// STANDARD is institution-scoped: nullable global UNIQUE keys are not a safe identity.
// Provision only existing active institutions. Never overwrite existing catalog settings.
export async function bootstrapWaitlist(prisma: Pick<PrismaClient, '$transaction'>, institutionId?: string) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await prisma.$transaction(async (tx) => {
        const institutions = await tx.institution.findMany({
          where: { ...(institutionId ? { id: institutionId } : {}), status: InstitutionStatus.ACTIVE, deletedAt: null },
          select: { id: true }, orderBy: { id: 'asc' },
        });
        if (institutionId && institutions.length !== 1) throw new Error('Active institution not found');
        await tx.waitlistStatus.createMany({
          data: [
            { id: randomUUID(), code: 'ACTIVE', name: 'Activa', active: true, isFinal: false },
            { id: randomUUID(), code: 'WITHDRAWN', name: 'Retirada', active: true, isFinal: true },
            { id: randomUUID(), code: 'FULFILLED', name: 'Cumplida', active: true, isFinal: true },
          ],
          skipDuplicates: true,
        });
        const status = await tx.waitlistStatus.findUniqueOrThrow({ where: { code: 'ACTIVE' } });
        if (!status.active || status.isFinal) throw new Error('Incompatible ACTIVE waitlist status');
        const withdrawn = await tx.waitlistStatus.findUniqueOrThrow({ where: { code: 'WITHDRAWN' } });
        if (!withdrawn.active || !withdrawn.isFinal) throw new Error('Incompatible WITHDRAWN waitlist status');
        const fulfilled = await tx.waitlistStatus.findUniqueOrThrow({ where: { code: 'FULFILLED' } });
        if (!fulfilled.active || !fulfilled.isFinal) throw new Error('Incompatible FULFILLED waitlist status');
        for (const institution of institutions) {
          const where = { institutionId_code: { institutionId: institution.id, code: 'STANDARD' } };
          const existing = await tx.priority.findUnique({ where });
          if (existing) {
            if (!existing.active) throw new Error('Incompatible STANDARD priority');
            continue;
          }
          // Fail atomically if level 0 belongs to another priority; do not silently pick a level.
          await tx.priority.create({
            data: { id: randomUUID(), institutionId: institution.id, code: 'STANDARD', name: 'Estándar', level: 0, active: true },
          });
        }
        return { status: 'ACTIVE', institutions: institutions.length };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
      if (attempt === 0 && (isTransactionConflict(error) || code === 'P2002')) continue;
      throw error;
    }
  }
  throw new Error('Waitlist bootstrap failed');
}
