import { Bell, CalendarCheck2, CalendarDays, Check, CircleHelp, Clock3, Heart, Info, MapPin, Search, UsersRound } from 'lucide-react';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/card';
import { homePreview } from './home-preview';

export function HomeWidgets() {
  const appointment = homePreview.appointment;
  const waitlist = homePreview.waitlist;
  const noticeIcons = { check: Check, bell: Bell, calendar: CalendarDays };

  return (
    <div className="dashboard-grid">
      <Card title="Próxima cita" icon={CalendarCheck2} tone="teal">
        <div className="flex items-start justify-between gap-3">
          <div><h3 className="text-lg font-semibold">{appointment.service}</h3><p className="mt-1 text-sm text-muted">{appointment.professional}</p></div>
          <span className="appointment-symbol"><CalendarCheck2 size={31} aria-hidden="true" /></span>
        </div>
        <dl className="detail-list">
          <div><dt><CalendarDays aria-hidden="true" /><span className="sr-only">Fecha</span></dt><dd>{appointment.date}</dd></div>
          <div><dt><Clock3 aria-hidden="true" /><span className="sr-only">Hora</span></dt><dd>{appointment.time}</dd></div>
          <div><dt><MapPin aria-hidden="true" /><span className="sr-only">Sede o sucursal</span></dt><dd>{appointment.branch}<span className="block text-muted">{appointment.address}</span></dd></div>
        </dl>
        <div className="mb-4 flex items-center gap-2"><Badge tone="teal">{appointment.statusLabel}</Badge><span className="text-xs text-muted">Ejemplo</span></div>
        <div className="mt-auto grid grid-cols-2 gap-3">
          <Button variant="outline" disabled title="Consulta de citas: próxima iteración">Ver detalles</Button>
          <Button variant="danger" disabled title="Cancelación: próxima iteración">Cancelar cita</Button>
        </div>
      </Card>
      <Card title="Estado de lista de espera" icon={UsersRound} tone="blue">
        <p className="text-sm text-muted">Vista previa de tus preferencias</p>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold">{waitlist.service}</h3><Badge>Ejemplo</Badge></div>
        <p className="mt-7 text-sm text-muted">Tu preferencia</p>
        <dl className="detail-list">
          <div><dt><CalendarDays aria-hidden="true" /><span className="sr-only">Días</span></dt><dd>{waitlist.days}</dd></div>
          <div><dt><Clock3 aria-hidden="true" /><span className="sr-only">Horario</span></dt><dd>{waitlist.time}</dd></div>
        </dl>
        <div className="info-note"><Info size={20} aria-hidden="true" /><p>Próximamente podrás indicar tus preferencias. No hay una solicitud activa en esta vista.</p></div>
      </Card>
      <Card title="Notificaciones" icon={Bell} tone="amber">
        <p className="mb-2 text-xs text-muted">Vista previa · sin notificaciones reales</p>
        <ul className="notification-list">
          {homePreview.notifications.map((notice) => {
            const Icon = noticeIcons[notice.icon];
            return <li key={notice.title}><span className={`notice-icon notice-${notice.icon}`}><Icon size={18} aria-hidden="true" /></span><div><h3>{notice.title}</h3><p>{notice.description}</p></div></li>;
          })}
        </ul>
        <span className="mt-auto pt-3 text-center text-sm text-muted">Disponible en una próxima etapa</span>
      </Card>
      <Card title="¿Cómo funciona?" icon={CircleHelp} tone="purple" id="como-funciona">
        <ol className="steps-list">
          <li><span className="step-number">1</span><span className="step-icon"><Search aria-hidden="true" /></span><div><h3>Busca tu hora</h3><p>Encuentra el servicio, sede o sucursal y horario que necesitas.</p></div></li>
          <li><span className="step-number">2</span><span className="step-icon"><UsersRound aria-hidden="true" /></span><div><h3>Lista de espera</h3><p>Si no hay horas, podrás dejar tus preferencias.</p><small>Próximamente</small></div></li>
          <li><span className="step-number">3</span><span className="step-icon"><Bell aria-hidden="true" /></span><div><h3>Recibe una oferta</h3><p>Podrás elegir si aceptas una hora que se libere.</p><small>Próximamente</small></div></li>
        </ol>
        <div className="care-note"><Heart size={24} aria-hidden="true" /><p>Cuidamos tu tiempo para que te preocupes de lo importante.</p></div>
      </Card>
    </div>
  );
}
