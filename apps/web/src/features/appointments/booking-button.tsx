import { useEffect, useMemo, useRef, useState } from 'react';
import { LoaderCircle } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { ApiError } from '../../lib/http-client';
import { useAuth } from '../auth/auth-provider';
import { appointmentErrorMessage, createAppointmentsApi, createSubmissionLock, type BookingResponse } from './appointments-api';

export function BookingButton({ agendaSlotId, onBooked, onConflict }: {
  agendaSlotId: string;
  onBooked: (appointment: BookingResponse) => void;
  onConflict: () => void;
}) {
  const { api, user } = useAuth();
  const appointments = useMemo(() => createAppointmentsApi(api), [api]);
  const lock = useRef(createSubmissionLock());
  const request = useRef<AbortController | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [conflict, setConflict] = useState(false);
  useEffect(() => {
    setMessage('');
    setConflict(false);
    setBusy(false);
    return () => request.current?.abort();
  }, [agendaSlotId, user?.id]);

  const reserve = () => void lock.current.run(async () => {
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setMessage('');
    try {
      const appointment = await appointments.reserve(agendaSlotId, controller.signal);
      if (!controller.signal.aborted) onBooked(appointment);
    } catch (error: unknown) {
      if (!controller.signal.aborted) {
        setMessage(appointmentErrorMessage(error, 'reserve'));
        setConflict(error instanceof ApiError && error.status === 409);
      }
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  });

  return (
    <div className="grid gap-2">
      <Button onClick={reserve} disabled={busy || conflict} aria-busy={busy}>
        {busy && <LoaderCircle size={18} aria-hidden="true" className="motion-safe:animate-spin" />}
        {busy ? 'Reservando…' : 'Reservar hora'}
      </Button>
      {message && <p className="form-error max-w-xs" role="alert">{message}</p>}
      {conflict && <Button variant="outline" onClick={onConflict}>Actualizar resultados</Button>}
    </div>
  );
}
