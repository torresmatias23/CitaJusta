import { Prisma } from '../generated/prisma/client.js';
import { availableAvailabilityWhere } from '../availability/availability.policy.js';

export const confirmationSelect = {
  agendaSlotId: true, branchId: true, serviceId: true, professionalId: true,
  status: { select: { code: true, active: true, isFinal: true, allowsConfirmation: true } },
  service: { select: { id: true, institutionId: true, name: true, requiresConfirmation: true } },
} as const satisfies Prisma.AppointmentSelect;

export type ConfirmationAppointment = {
  id: string; institutionId: string; agendaSlotId: string; branchId: string; serviceId: string; professionalId: string;
  startsAt: Date; endsAt: Date;
  status: { code: string; active: boolean; isFinal: boolean; allowsConfirmation: boolean };
  service: { requiresConfirmation: boolean; institutionId: string };
  branch: { institutionId: string }; professional: { institutionId: string };
};
export type ConfirmationState = { required: boolean; confirmed: boolean; confirmedAt: string | null; canConfirm: boolean };
type Facts = { id: string; confirmedAt: Date | null; ownershipValid: boolean };

// Compare timestamps in PostgreSQL, preserving microseconds. A -> B -> A must not
// reuse A's confirmation from an earlier ownership period. Legacy rows without
// history use the appointment's creation time, never another user's confirmation.
async function confirmationFacts(tx: Prisma.TransactionClient, userId: string, ids: string[]): Promise<Facts[]> {
  if (!ids.length) return [];
  return tx.$queryRaw<Facts[]>(Prisma.sql`
    SELECT a.id, c.confirmada_at AS "confirmedAt",
      (h.id IS NULL OR h.usuario_nuevo_id = a.usuario_id) AS "ownershipValid"
    FROM citas a
    LEFT JOIN LATERAL (
      SELECT id, ocurrido_at, usuario_nuevo_id FROM historial_cambios_cita
      WHERE cita_id = a.id AND usuario_anterior_id IS DISTINCT FROM usuario_nuevo_id
      ORDER BY ocurrido_at DESC, id DESC LIMIT 1
    ) h ON true
    LEFT JOIN LATERAL (
      SELECT confirmada_at FROM confirmaciones
      WHERE cita_id = a.id AND usuario_id = a.usuario_id AND confirmada = true
        AND confirmada_at >= COALESCE(h.ocurrido_at, a.created_at)
        AND (h.id IS NULL OR h.usuario_nuevo_id = a.usuario_id)
      ORDER BY confirmada_at ASC, id ASC LIMIT 1
    ) c ON true
    WHERE a.usuario_id = ${userId}::uuid AND a.deleted_at IS NULL
      AND a.id IN (${Prisma.join(ids.map(id => Prisma.sql`${id}::uuid`))})
  `);
}

function eligibleRecord(row: ConfirmationAppointment, now: Date): boolean {
  return row.service.requiresConfirmation && row.status.active && !row.status.isFinal && row.status.allowsConfirmation &&
    !['CANCELADA', 'ATENDIDA', 'INASISTENCIA'].includes(row.status.code) && row.startsAt > now && row.endsAt > row.startsAt &&
    row.branch.institutionId === row.institutionId && row.service.institutionId === row.institutionId && row.professional.institutionId === row.institutionId;
}

// Fixed number of batched queries, not one lookup per appointment. The public
// DTO excludes the eligibility flag used internally for idempotent retries.
export async function confirmationStates(tx: Prisma.TransactionClient, userId: string, rows: ConfirmationAppointment[], now = new Date()) {
  const facts = new Map((await confirmationFacts(tx, userId, rows.map(row => row.id))).map(row => [row.id, row]));
  const eligible = rows.filter(row => eligibleRecord(row, now));
  const slots = eligible.length ? await tx.agendaSlot.findMany({ where: { OR: eligible.map(row => ({
    id: row.agendaSlotId, status: 'RESERVED', startsAt: row.startsAt, endsAt: row.endsAt,
    availability: availableAvailabilityWhere(row, row.professionalId),
  })) }, select: { id: true, availability: { select: { attentionPointId: true } }, appointment: { select: { attentionPointId: true } } } }) : [];
  const validSlots = new Set(slots.filter(slot => slot.availability.attentionPointId === slot.appointment?.attentionPointId).map(slot => slot.id));
  return new Map(rows.map(row => {
    const fact = facts.get(row.id), confirmedAt = fact?.confirmedAt?.toISOString() ?? null;
    const eligible = Boolean(fact?.ownershipValid && eligibleRecord(row, now) && validSlots.has(row.agendaSlotId));
    return [row.id, { required: row.service.requiresConfirmation, confirmed: confirmedAt !== null, confirmedAt,
      canConfirm: eligible && confirmedAt === null, eligible }];
  }));
}

export function publicConfirmation(state: ConfirmationState): ConfirmationState {
  return { required: state.required, confirmed: state.confirmed, confirmedAt: state.confirmedAt, canConfirm: state.canConfirm };
}
