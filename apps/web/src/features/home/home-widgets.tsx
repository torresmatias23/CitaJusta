import { Bell, CalendarCheck2, CircleHelp, Heart, Search, UsersRound } from 'lucide-react';
import { Link } from 'react-router';
import { Badge } from '../../components/ui/badge';
import { Card } from '../../components/ui/card';
import { useAuth } from '../auth/auth-provider';

export function HomeWidgets() {
  const { status } = useAuth();
  const authenticated = status === 'authenticated';

  return (
    <div className="dashboard-grid">
      <Card title="Mis citas" icon={CalendarCheck2} tone="teal">
        <h3 className="text-lg font-semibold">Tus reservas, en un solo lugar</h3>
        <p className="mt-3 mb-5 text-sm leading-relaxed text-muted">Consulta el horario, la sede y el estado de tus citas. También puedes cancelar una reserva agendada.</p>
        <Link to={authenticated ? '/mis-citas' : '/login'} className="button button-outline mt-auto">{authenticated ? 'Ver mis citas' : 'Iniciar sesión'}</Link>
      </Card>
      <Card title="Lista de espera" icon={UsersRound} tone="blue">
        <h3 className="text-lg font-semibold">Tus preferencias de atención</h3>
        <p className="mt-3 mb-5 text-sm leading-relaxed text-muted">Ingresa a una lista de espera, configura tus preferencias o retira una solicitud.</p>
        <Link to="/lista-de-espera" className="button button-outline mt-auto">Ver mi lista de espera</Link>
      </Card>
      <Card title="Notificaciones" icon={Bell} tone="amber">
        <Badge>Próximamente</Badge>
        <p className="mt-4 text-sm leading-relaxed text-muted">Aquí podrás consultar novedades sobre tus atenciones cuando esta función esté disponible.</p>
      </Card>
      <Card title="¿Cómo funciona?" icon={CircleHelp} tone="purple" id="como-funciona">
        <ol className="steps-list">
          <li><span className="step-number">1</span><span className="step-icon"><Search aria-hidden="true" /></span><div><h3>Busca tu hora</h3><p>Inicia sesión y selecciona institución, sede y servicio.</p></div></li>
          <li><span className="step-number">2</span><span className="step-icon"><CalendarCheck2 aria-hidden="true" /></span><div><h3>Reserva una atención</h3><p>Elige uno de los horarios disponibles.</p></div></li>
          <li><span className="step-number">3</span><span className="step-icon"><UsersRound aria-hidden="true" /></span><div><h3>Gestiona tus citas</h3><p>Consulta tus reservas o cancela desde Mis citas.</p></div></li>
        </ol>
        <div className="care-note"><Heart size={24} aria-hidden="true" /><p>Cuidamos tu tiempo para que te preocupes de lo importante.</p></div>
      </Card>
    </div>
  );
}
