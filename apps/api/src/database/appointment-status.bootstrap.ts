import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '../generated/prisma/client.js';

export async function bootstrapAppointmentStatus(
  prisma: Pick<PrismaClient, 'appointmentStatus'>,
) {
  // ON CONFLICT DO NOTHING preserves every existing configuration, even inactive.
  await prisma.appointmentStatus.createMany({
    data: [{
      id: randomUUID(),
      code: 'AGENDADA',
      name: 'Agendada',
      isFinal: false,
      allowsCancellation: true,
      active: true,
    }, {
      id: randomUUID(),
      code: 'CANCELADA',
      name: 'Cancelada',
      isFinal: true,
      allowsCancellation: false,
      allowsConfirmation: false,
      active: true,
    }],
    skipDuplicates: true,
  });

  await prisma.appointmentStatus.findUniqueOrThrow({
    where: { code: 'CANCELADA' },
    select: { code: true },
  });
  return prisma.appointmentStatus.findUniqueOrThrow({
    where: { code: 'AGENDADA' },
    select: { code: true },
  });
}
