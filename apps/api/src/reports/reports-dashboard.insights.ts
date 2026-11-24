// Decision-support rules for the institutional dashboard. Pure and deterministic:
// they only read aggregates already calculated by PostgreSQL and never change data.
// Thresholds are initial operational references for CitaJusta, not regulatory targets.

export const insightThresholds = Object.freeze({
  minimumSample: 10,
  serviceMinimumSample: 5,
  noShowMediumPct: 8,
  noShowHighPct: 15,
  cancellationMediumPct: 15,
  cancellationHighPct: 25,
  minimumReleased: 3,
  recoveryLowPct: 50,
  minimumOffers: 5,
  expiredOffersPct: 40,
  minimumCapacity: 20,
  occupancyHighPct: 85,
  occupancyLowPct: 40,
});

export type InsightSeverity = 'high' | 'medium' | 'info';
export interface DashboardInsight { code: string; severity: InsightSeverity; title: string; detail: string; action: string }

export interface InsightInput {
  appointmentStatus: { total: number; attended: number; noShows: number; cancelled: number };
  rates: { noShowRatePct: number; cancellationRatePct: number; occupancyPct: number };
  slots: { released: number; recovered: number; recoveryRatePct: number };
  offers: { sent: number; expired: number };
  capacity: { total: number };
  services: { name: string; attended: number; noShows: number; noShowRatePct: number; waiting: number }[];
  waitlist: { active: number };
}

const order: Record<InsightSeverity, number> = { high: 0, medium: 1, info: 2 };
export function percentage(part: number, whole: number): number {
  return whole > 0 ? Number((part / whole * 100).toFixed(2)) : 0;
}
const pct = (value: number) => `${value.toLocaleString('es-CL', { maximumFractionDigits: 1 })} %`;

export function dashboardInsights(input: InsightInput): DashboardInsight[] {
  const t = insightThresholds;
  const insights: DashboardInsight[] = [];
  const closed = input.appointmentStatus.attended + input.appointmentStatus.noShows;

  if (closed >= t.minimumSample && input.rates.noShowRatePct >= t.noShowMediumPct) {
    insights.push({ code: 'NO_SHOW_RATE', severity: input.rates.noShowRatePct >= t.noShowHighPct ? 'high' : 'medium',
      title: `Inasistencia de ${pct(input.rates.noShowRatePct)}`,
      detail: `${input.appointmentStatus.noShows} de ${closed} citas cerradas del período terminaron en inasistencia.`,
      action: 'Exigir confirmación anticipada de asistencia en los servicios más afectados y reforzar los recordatorios por correo.' });
  }

  const hotspot = input.services
    .filter((service) => service.attended + service.noShows >= t.serviceMinimumSample && service.noShowRatePct >= t.noShowMediumPct)
    .sort((a, b) => b.noShowRatePct - a.noShowRatePct || a.name.localeCompare(b.name, 'es'))[0];
  if (hotspot) {
    insights.push({ code: 'NO_SHOW_SERVICE', severity: 'medium',
      title: `${hotspot.name} concentra inasistencias`,
      detail: `${hotspot.noShows} inasistencias de ${hotspot.attended + hotspot.noShows} citas cerradas (${pct(hotspot.noShowRatePct)}).`,
      action: `Revisar horarios, requisitos de confirmación y comunicación previa de ${hotspot.name}.` });
  }

  if (input.appointmentStatus.total >= t.minimumSample && input.rates.cancellationRatePct >= t.cancellationMediumPct) {
    insights.push({ code: 'CANCELLATION_RATE', severity: input.rates.cancellationRatePct >= t.cancellationHighPct ? 'high' : 'medium',
      title: `Cancelación de ${pct(input.rates.cancellationRatePct)}`,
      detail: `${input.appointmentStatus.cancelled} de ${input.appointmentStatus.total} citas del período están canceladas.`,
      action: 'Mantener activa la lista de espera de los servicios afectados para recuperar esos cupos y revisar los motivos de cancelación.' });
  }

  if (input.slots.released >= t.minimumReleased && input.slots.recoveryRatePct < t.recoveryLowPct) {
    insights.push({ code: 'LOW_RECOVERY', severity: 'medium',
      title: `Recuperación de cupos de ${pct(input.slots.recoveryRatePct)}`,
      detail: `Se recuperaron ${input.slots.recovered} de ${input.slots.released} cupos liberados por cancelación.`,
      action: 'Revisar la política de reasignación (plazo de respuesta y criterios de candidatos) y promover la inscripción en lista de espera.' });
  }

  const expiredShare = percentage(input.offers.expired, input.offers.sent);
  if (input.offers.sent >= t.minimumOffers && expiredShare >= t.expiredOffersPct) {
    insights.push({ code: 'OFFERS_EXPIRING', severity: 'medium',
      title: `${pct(expiredShare)} de las ofertas expira sin respuesta`,
      detail: `${input.offers.expired} de ${input.offers.sent} ofertas enviadas vencieron.`,
      action: 'Evaluar un plazo de oferta distinto y confirmar que las personas reciban el aviso por correo.' });
  }

  const demand = input.services.filter((service) => service.waiting > 0)
    .sort((a, b) => b.waiting - a.waiting || a.name.localeCompare(b.name, 'es'))[0];
  const enoughCapacity = input.capacity.total >= t.minimumCapacity;
  if (enoughCapacity && input.rates.occupancyPct >= t.occupancyHighPct && input.waitlist.active > 0) {
    insights.push({ code: 'DEMAND_OVER_CAPACITY', severity: 'high',
      title: 'La demanda supera la capacidad publicada',
      detail: `Ocupación de ${pct(input.rates.occupancyPct)} con ${input.waitlist.active} personas en lista de espera.`,
      action: demand ? `Abrir más disponibilidad para ${demand.name}, que tiene ${demand.waiting} personas esperando.` : 'Abrir más disponibilidad en los servicios con lista de espera.' });
  } else if (demand) {
    insights.push({ code: 'WAITLIST_FOCUS', severity: 'info',
      title: `${input.waitlist.active} personas esperan un cupo`,
      detail: `La mayor demanda en espera está en ${demand.name} (${demand.waiting}).`,
      action: `Priorizar la apertura o reasignación de cupos de ${demand.name}.` });
  }

  if (enoughCapacity && input.rates.occupancyPct < t.occupancyLowPct) {
    insights.push({ code: 'LOW_OCCUPANCY', severity: 'medium',
      title: `Ocupación de agenda de ${pct(input.rates.occupancyPct)}`,
      detail: `Solo una parte de los ${input.capacity.total} cupos del período quedó reservada.`,
      action: 'Redistribuir o reducir bloques con baja demanda, o difundir esos horarios.' });
  }

  const activity = input.appointmentStatus.total + input.capacity.total + input.waitlist.active + input.offers.sent + input.slots.released;
  if (!activity) {
    insights.push({ code: 'NO_ACTIVITY', severity: 'info', title: 'Sin actividad en el período',
      detail: 'No hay citas, cupos ni personas en espera para los filtros seleccionados.',
      action: 'Amplía el período o quita filtros para comparar.' });
  } else if (!insights.length) {
    insights.push({ code: 'STABLE', severity: 'info', title: 'Indicadores dentro de rangos esperados',
      detail: 'Inasistencia, cancelación, recuperación y ocupación no superan los umbrales de alerta.',
      action: 'Mantener la operación actual y revisar el panel periódicamente.' });
  }
  return insights.sort((a, b) => order[a.severity] - order[b.severity]);
}
