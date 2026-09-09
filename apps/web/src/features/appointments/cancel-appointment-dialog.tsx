import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '../../components/ui/button';
import { ApiError } from '../../lib/http-client';
import { useAuth } from '../auth/auth-provider';
import { appointmentErrorMessage, createAppointmentsApi, createSubmissionLock, type AppointmentSummary } from './appointments-api';

export function CancelAppointmentDialog({ appointment, onClose, onCancelled, onRefresh, returnFocus, fallbackFocus }: {
  appointment: AppointmentSummary;
  onClose: () => void;
  onCancelled: (appointment: AppointmentSummary) => void;
  onRefresh: () => void;
  returnFocus: HTMLElement | null;
  fallbackFocus: HTMLElement | null;
}) {
  const { api } = useAuth();
  const appointments = useMemo(() => createAppointmentsApi(api), [api]);
  const dialog = useRef<HTMLDialogElement>(null);
  const request = useRef<AbortController | null>(null);
  const lock = useRef(createSubmissionLock());
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [needsRefresh, setNeedsRefresh] = useState(false);

  useEffect(() => {
    dialog.current?.showModal();
    return () => {
      request.current?.abort();
      (returnFocus?.isConnected ? returnFocus : fallbackFocus)?.focus();
    };
  }, [returnFocus, fallbackFocus]);

  const cancel = () => void lock.current.run(async () => {
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setMessage('');
    setNeedsRefresh(false);
    try {
      const result = await appointments.cancel(appointment.id, controller.signal);
      if (!controller.signal.aborted) onCancelled(result);
    } catch (error: unknown) {
      if (!controller.signal.aborted) {
        setMessage(appointmentErrorMessage(error, 'cancel'));
        setNeedsRefresh(error instanceof ApiError && (error.status === 404 || error.status === 409));
      }
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  });

  return (
    <dialog ref={dialog} className="appointment-dialog" aria-labelledby="cancel-title" aria-describedby="cancel-description" aria-busy={busy}
      onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}>
      <h2 id="cancel-title" className="text-xl font-semibold text-ink">¿Cancelar esta cita?</h2>
      <p id="cancel-description" className="mt-3">Cancelarás tu cita de {appointment.service.name} en {appointment.branch.name}. La cancelación conservará su historial.</p>
      {message && <p className="form-error mt-4" role="alert">{message}</p>}
      {busy && <p className="mt-4 text-sm" role="status">Guardando la cancelación…</p>}
      <div className="mt-6 flex flex-wrap justify-end gap-3">
        <Button variant="outline" autoFocus disabled={busy} onClick={onClose}>Conservar cita</Button>
        {needsRefresh ? <Button onClick={onRefresh}>Actualizar mis citas</Button>
          : <Button variant="danger" disabled={busy} onClick={cancel}>{busy ? 'Cancelando…' : 'Sí, cancelar cita'}</Button>}
      </div>
    </dialog>
  );
}
