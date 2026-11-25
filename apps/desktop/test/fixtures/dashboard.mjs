import { profile as agendaProfile, service } from './agenda.mjs';

export const profile = { ...agendaProfile, permissions: ['reports.read'] };
export const period = { from: '2026-11-01', to: '2026-11-07' };
export const dashboard = (range = period) => ({ data: {
  period: { ...range }, granularity: 'day',
  indicators: { appointments: { scheduled: 20, cancelled: 4, noShows: 3 }, slots: { released: 4, recovered: 1, recoveryRatePct: 25 },
    offers: { sent: 10, accepted: 1, rejected: 3, expired: 5 } },
  appointmentStatus: { total: 20, booked: 4, attended: 9, noShows: 3, cancelled: 3, other: 1 },
  rates: { attendanceRatePct: 75, noShowRatePct: 25, cancellationRatePct: 15, recoveryRatePct: 25, offerAcceptanceRatePct: 11.11, occupancyPct: 90 },
  capacity: { total: 40, reserved: 36, available: 2, inProcess: 1, expired: 1 },
  trend: ['01', '02', '03', '04', '05', '06', '07'].map((day, index) => ({ start: `2026-11-${day}`, scheduled: index + 1, cancelled: index % 2, noShows: index % 3 === 0 ? 1 : 0 })),
  services: [{ id: service.id, name: 'Kinesiología', scheduled: 14, attended: 6, noShows: 3, cancelled: 2, noShowRatePct: 33.33, waiting: 5 }],
  professionals: [{ id: 'p1', name: 'Ana Pérez', scheduled: 20, attended: 9, noShows: 3, cancelled: 3, noShowRatePct: 25 }],
  waitlist: { active: 5, averageWaitDays: 3.3, oldestWaitDays: 9.5, byPriority: [{ name: 'Estándar', level: 0, count: 5 }] },
  insights: [{ code: 'NO_SHOW_RATE', severity: 'high', title: 'Inasistencia de 25 %', detail: '3 de 12 citas cerradas.', action: 'Exigir confirmación anticipada de asistencia.' },
    { code: 'WAITLIST_FOCUS', severity: 'info', title: '5 personas esperan un cupo', detail: 'Mayor demanda en Kinesiología.', action: 'Priorizar cupos de Kinesiología.' }],
} });
