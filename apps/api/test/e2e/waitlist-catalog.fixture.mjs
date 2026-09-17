import { bootstrapWaitlist } from '../../dist/database/waitlist.bootstrap.js';

// Registrar sólo IDs creados por esta ejecución; nunca eliminar un catálogo preexistente.
export async function provisionFixtureWaitlist(prisma, institutionId, ownedStatusIds) {
  const codes = ['ACTIVE', 'WITHDRAWN', 'FULFILLED'];
  const before = await prisma.waitlistStatus.findMany({ where: { code: { in: codes } }, select: { id: true } });
  const existingIds = new Set(before.map((row) => row.id));
  await bootstrapWaitlist(prisma, institutionId);
  const after = await prisma.waitlistStatus.findMany({ where: { code: { in: codes } }, select: { id: true } });
  for (const row of after) if (!existingIds.has(row.id)) ownedStatusIds.push(row.id);
}
