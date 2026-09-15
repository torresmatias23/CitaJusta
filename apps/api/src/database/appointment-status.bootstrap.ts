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
    }, ...['ATENDIDA', 'INASISTENCIA'].map((code) => ({
      id: randomUUID(), code, name: code === 'ATENDIDA' ? 'Atendida' : 'Inasistencia',
      active: true, isFinal: true, allowsCancellation: false, allowsConfirmation: false,
    }))],
    skipDuplicates: true,
  });

  for (const code of ['ATENDIDA', 'INASISTENCIA']) {
    const status = await prisma.appointmentStatus.findUniqueOrThrow({ where: { code },
      select: { active: true, isFinal: true, allowsCancellation: true, allowsConfirmation: true } });
    if (!status.active || !status.isFinal || status.allowsCancellation || status.allowsConfirmation) {
      throw new Error('Incompatible attendance status configuration; existing configuration preserved');
    }
  }

  await prisma.appointmentStatus.findUniqueOrThrow({
    where: { code: 'CANCELADA' },
    select: { code: true },
  });
  return prisma.appointmentStatus.findUniqueOrThrow({
    where: { code: 'AGENDADA' },
    select: { code: true },
  });
}
