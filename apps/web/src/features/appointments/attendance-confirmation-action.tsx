import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '../../components/ui/button';
import type { ApiClient } from '../../lib/http-client';
import { appointmentErrorMessage, createAppointmentsApi, createSubmissionLock, type AttendanceConfirmation } from './appointments-api';

export function AttendanceConfirmationAction({ appointmentId, confirmation, api, onConfirmed, onRefresh }: {
  appointmentId: string; confirmation: AttendanceConfirmation | undefined; api: ApiClient;
  onConfirmed: () => void; onRefresh: () => void;
}) {
  const [state, setState] = useState({ busy: false, error: '' });
  const completed = useRef(onConfirmed); completed.current = onConfirmed;
  const submission = useMemo(() => createConfirmationSubmission(api, appointmentId, setState, () => completed.current()), [api, appointmentId]);
  useEffect(() => () => submission.dispose(), [submission]);
  return <AttendanceConfirmationView confirmation={confirmation} {...state} onConfirm={() => { void submission.run(); }} onRefresh={onRefresh} />;
}

export function createConfirmationSubmission(api: ApiClient, appointmentId: string,
  publish: (state: { busy: boolean; error: string }) => void, onConfirmed: () => void) {
  const appointments = createAppointmentsApi(api), lock = createSubmissionLock();
  let request: AbortController | undefined;
  return {
    dispose() { request?.abort(); },
    run: () => lock.run(async () => {
      const controller = new AbortController(); request = controller;
      let error = ''; publish({ busy: true, error });
      try { await appointments.confirmAttendance(appointmentId, controller.signal); if (!controller.signal.aborted) onConfirmed(); }
      catch (failure) { error = appointmentErrorMessage(failure, 'confirm'); }
      finally { if (!controller.signal.aborted) publish({ busy: false, error }); }
    }),
  };
}

export function AttendanceConfirmationView({ confirmation, busy, error, onConfirm, onRefresh }: {
  confirmation: AttendanceConfirmation | undefined; busy: boolean; error: string; onConfirm: () => void; onRefresh: () => void;
}) {
  if (!confirmation) return null; // Older cancellation responses have no action capability.
  if (confirmation.confirmed) return <p className="form-success mt-4" role="status">Asistencia confirmada previamente por ti. No equivale al registro de atención realizada.</p>;
  if (!confirmation.canConfirm) return confirmation.required
    ? <p className="mt-4 text-sm text-muted">La confirmación de asistencia no está disponible para esta cita.</p> : null;
  return <div className="mt-5" aria-busy={busy}>
    <p className="mb-3 text-sm">Este servicio solicita que confirmes anticipadamente tu asistencia. Tu cita seguirá agendada.</p>
    <Button onClick={onConfirm} disabled={busy} aria-label="Confirmar que asistiré a esta cita">{busy ? 'Confirmando…' : 'Confirmar asistencia'}</Button>
    {error && <div className="mt-3"><p role="alert" className="form-error">{error}</p><Button variant="outline" onClick={onRefresh}>Actualizar Mis citas</Button></div>}
  </div>;
}
