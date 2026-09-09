import { CalendarDays, Clock3, MapPin, UserRound } from 'lucide-react';
import { Badge } from '../../components/ui/badge';
import type { AppointmentSummary } from './appointments-api';

const dateFormat = new Intl.DateTimeFormat('es-CL', { dateStyle: 'full' });
const timeFormat = new Intl.DateTimeFormat('es-CL', { timeStyle: 'short' });

export function AppointmentDetails({ appointment }: { appointment: AppointmentSummary }) {
  return (
    <div className="appointment-details">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-semibold text-ink">{appointment.service.name}</h2>
        <Badge tone={appointment.status === 'AGENDADA' ? 'teal' : 'neutral'}>{appointment.status}</Badge>
      </div>
      <dl className="mt-4 grid gap-3 text-sm">
        <div className="flex items-start gap-3"><UserRound size={18} aria-hidden="true" /><dt className="sr-only">Profesional</dt><dd>{appointment.professional.firstNames} {appointment.professional.lastNames}</dd></div>
        <div className="flex items-start gap-3"><MapPin size={18} aria-hidden="true" /><dt className="sr-only">Sede o sucursal</dt><dd>{appointment.branch.name}</dd></div>
        <div className="flex items-start gap-3"><CalendarDays size={18} aria-hidden="true" /><dt className="sr-only">Fecha</dt><dd><time dateTime={appointment.startsAt}>{dateFormat.format(new Date(appointment.startsAt))}</time></dd></div>
        <div className="flex items-start gap-3"><Clock3 size={18} aria-hidden="true" /><dt className="sr-only">Horario local</dt><dd><time dateTime={appointment.startsAt}>{timeFormat.format(new Date(appointment.startsAt))}</time>–<time dateTime={appointment.endsAt}>{timeFormat.format(new Date(appointment.endsAt))}</time> <span className="text-muted">(hora local)</span></dd></div>
      </dl>
    </div>
  );
}
