import { Check, CircleAlert } from 'lucide-react';
import { Link, useParams } from 'react-router';
import { AsyncState } from '../../components/ui/async-state';
import { AppointmentDetails } from './appointment-details';
import { isAppointmentId } from './appointments-api';
import { useAppointments } from './use-appointments';

export function AppointmentConfirmationPage() {
  const { appointmentId = '' } = useParams();
  const appointments = useAppointments();
  const validId = isAppointmentId(appointmentId);
  const appointment = validId ? appointments.data.find((item) => item.id === appointmentId) : undefined;
  const scheduled = appointment?.status === 'AGENDADA';
  return (
    <div className="page-container route-page">
      <div className="mx-auto max-w-2xl">
        {validId && appointments.status === 'loading' && <AsyncState kind="loading" title="Consultando tu reserva…" />}
        {validId && appointments.status === 'error' && <AsyncState kind="error" title="No pudimos consultar tu reserva" description={appointments.message} onRetry={appointments.refresh} />}
        {(!validId || appointments.status === 'ready' && !appointment) && <AsyncState kind="empty" title="No encontramos esta cita en tu cuenta" description="Consulta Mis citas para revisar tus reservas actuales." />}
        {appointment && <section className="content-panel">
          <div className="mb-6 text-center">
            <span className="mx-auto mb-4 flex size-14 items-center justify-center rounded-full bg-teal-50 text-teal-700">{scheduled ? <Check aria-hidden="true" /> : <CircleAlert aria-hidden="true" />}</span>
            <h1 className="text-2xl font-bold text-ink">{scheduled ? 'Reserva realizada' : 'Estado actual de tu cita'}</h1>
            <p className="mt-3">{scheduled ? 'Tu cita quedó agendada. Este comprobante de reserva no implica una confirmación de asistencia.' : 'Esta cita ya no está agendada. Se muestra el estado actual informado por la institución.'}</p>
          </div>
          <AppointmentDetails appointment={appointment} />
        </section>}
        <div className="mt-6 flex flex-wrap justify-center gap-3"><Link to="/mis-citas" className="button button-primary">Ver mis citas</Link><Link to="/" className="button button-outline">Volver al inicio</Link></div>
      </div>
    </div>
  );
}
