import { useEffect, useRef, useState } from 'react';
import { Button } from '../../components/ui/button';
import { useAuth } from '../auth/auth-provider';
import { createAppointmentsApi, createSubmissionLock, type AppointmentSummary } from './appointments-api';
import { calendarClientId, calendarEligible, calendarErrorMessage, prepareCalendarCodeClient } from './google-calendar';

export function CalendarExportView({ eligible, ready, pending, message, failed, onExport }: {
  eligible: boolean; ready: boolean; pending: boolean; message: string; failed: boolean; onExport: () => void;
}) {
  if (!eligible) return null;
  return <div className="mt-5">
    <Button variant="outline" disabled={!ready || pending} onClick={onExport}>
      {pending ? 'Agregando a Google Calendar…' : 'Agregar a Google Calendar'}
    </Button>
    {message && <p className={failed ? 'form-error mt-2' : 'mt-2 text-sm'} role={failed ? 'alert' : 'status'}>{message}</p>}
  </div>;
}

export function GoogleCalendarButton({ appointment }: { appointment: AppointmentSummary }) {
  const { api, user } = useAuth();
  const clientId = calendarClientId(import.meta.env.VITE_GOOGLE_CALENDAR_ENABLED, import.meta.env.VITE_GOOGLE_CLIENT_ID);
  const eligible = Boolean(clientId && user && calendarEligible(appointment));
  const authorization = useRef<Awaited<ReturnType<typeof prepareCalendarCodeClient>> | null>(null);
  const controller = useRef<AbortController | null>(null);
  const lock = useRef(createSubmissionLock());
  const [ready, setReady] = useState(false), [pending, setPending] = useState(false);
  const [message, setMessage] = useState(''), [failed, setFailed] = useState(false);
  useEffect(() => {
    const abort = new AbortController(); controller.current = abort;
    setReady(false); setPending(false); setMessage(''); setFailed(false);
    if (eligible && clientId) void prepareCalendarCodeClient(clientId).then((client) => {
      if (abort.signal.aborted) client.dispose();
      else { authorization.current = client; setReady(true); }
    }).catch(() => {
      if (!abort.signal.aborted) { setFailed(true); setMessage('No pudimos cargar Google Calendar. Tu cita y las demás acciones siguen disponibles.'); }
    });
    return () => { abort.abort(); authorization.current?.dispose(); authorization.current = null; };
  }, [clientId, eligible, user?.id, appointment.id]);

  async function exportAppointment() {
    const client = authorization.current, signal = controller.current?.signal;
    if (!client || !signal || signal.aborted || !calendarEligible(appointment)) return;
    await lock.current.run(async () => {
      setPending(true); setMessage(''); setFailed(false);
      try {
        const code = await client.requestCode();
        signal.throwIfAborted();
        await createAppointmentsApi(api).exportCalendar(appointment.id, code, signal);
        if (!signal.aborted) setMessage('Cita agregada a Google Calendar. Es una copia; consulta CitaJusta para verificar su estado vigente.');
      } catch (error: unknown) {
        if (!signal.aborted) { setFailed(true); setMessage(calendarErrorMessage(error)); }
      } finally { if (!signal.aborted) setPending(false); }
    });
  }
  return <CalendarExportView eligible={eligible} ready={ready} pending={pending} message={message} failed={failed}
    onExport={() => { void exportAppointment(); }} />;
}
