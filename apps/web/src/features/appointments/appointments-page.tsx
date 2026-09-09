import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { AsyncState } from '../../components/ui/async-state';
import { Button } from '../../components/ui/button';
import { useAuth } from '../auth/auth-provider';
import type { AppointmentSummary } from './appointments-api';
import { AppointmentDetails } from './appointment-details';
import { CancelAppointmentDialog } from './cancel-appointment-dialog';
import { useAppointments } from './use-appointments';

export function AppointmentsPage() {
  const appointments = useAppointments();
  const { user } = useAuth();
  const [selected, setSelected] = useState<{ owner: string; appointment: AppointmentSummary } | null>(null);
  const [notice, setNotice] = useState('');
  const returnFocus = useRef<HTMLElement | null>(null);
  const heading = useRef<HTMLHeadingElement | null>(null);
  useEffect(() => { setSelected(null); setNotice(''); }, [user?.id]);

  return (
    <div className="page-container">
      <div className="page-heading">
        <div><h1 ref={heading} tabIndex={-1}>Mis citas</h1><p>Consulta tus atenciones y gestiona tus reservas. Se muestran de la más antigua a la más reciente, sin cambiar su estado.</p></div>
        <Link to="/" className="button button-outline">Buscar una hora</Link>
      </div>
      {notice && <p role="status" className="content-panel mb-5">{notice}</p>}
      {appointments.status === 'loading' && <AsyncState kind="loading" title="Cargando tus citas…" />}
      {appointments.status === 'error' && <AsyncState kind="error" title="No pudimos cargar tus citas" description={appointments.message} onRetry={appointments.refresh} />}
      {appointments.status === 'ready' && appointments.data.length === 0 && <AsyncState kind="empty" title="Aún no tienes citas" description="Busca una atención para encontrar tu próxima hora disponible." />}
      {appointments.status === 'ready' && appointments.data.length > 0 && (
        <ul className="appointment-list" aria-label="Tus citas">
          {appointments.data.map((appointment) => (
            <li key={appointment.id} className="appointment-card">
              <AppointmentDetails appointment={appointment} />
              {appointment.status === 'AGENDADA' && <div className="mt-5 flex justify-end"><Button variant="danger" onClick={(event) => {
                if (!user) return;
                returnFocus.current = event.currentTarget;
                setNotice('');
                setSelected({ owner: user.id, appointment });
              }} aria-label={`Cancelar cita de ${appointment.service.name}`}>Cancelar cita</Button></div>}
            </li>
          ))}
        </ul>
      )}
      {selected && selected.owner === user?.id && <CancelAppointmentDialog appointment={selected.appointment} returnFocus={returnFocus.current} fallbackFocus={heading.current}
        onClose={() => setSelected(null)} onRefresh={() => { setSelected(null); appointments.refresh(); }} onCancelled={(appointment) => {
          appointments.replace(appointment);
          setSelected(null);
          setNotice('Tu cita está cancelada. Puedes consultar su estado actualizado en el listado.');
        }} />}
    </div>
  );
}
