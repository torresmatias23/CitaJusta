// Suites targeting manual generation need a release that was not reusable at
// cancellation time. Exercise that real domain condition, without mocking or
// disabling automatic start. The caller supplies its own fixture appointment.
export async function cancelWithBlockedSlot(prisma, appointmentId, cancel) {
  const appointment = await prisma.appointment.findUniqueOrThrow({ where: { id: appointmentId },
    select: { agendaSlot: { select: { id: true, blockedUntilAt: true } } } });
  const slot = appointment.agendaSlot;
  const blockedUntilAt = new Date(Date.now() + 3_600_000);
  await prisma.agendaSlot.update({ where: { id: slot.id }, data: { blockedUntilAt } });
  try { return await cancel(); }
  finally {
    await prisma.agendaSlot.updateMany({ where: { id: slot.id, blockedUntilAt }, data: { blockedUntilAt: slot.blockedUntilAt } });
  }
}
