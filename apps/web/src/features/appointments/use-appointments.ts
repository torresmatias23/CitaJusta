import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../auth/auth-provider';
import { appointmentErrorMessage, createAppointmentsApi, type AppointmentSummary } from './appointments-api';

type AppointmentState = {
  owner: string | undefined;
  status: 'loading' | 'ready' | 'error';
  data: AppointmentSummary[];
  message: string;
};

export function useAppointments() {
  const { api, user } = useAuth();
  const userId = user?.id;
  const appointmentsApi = useMemo(() => createAppointmentsApi(api), [api]);
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<AppointmentState>({ owner: userId, status: 'loading', data: [], message: '' });

  useEffect(() => {
    const controller = new AbortController();
    setState({ owner: userId, status: 'loading', data: [], message: '' });
    if (userId) void appointmentsApi.list(controller.signal).then(
      (data) => {
        if (!controller.signal.aborted) setState({ owner: userId, status: 'ready', data, message: '' });
      },
      (error: unknown) => {
        if (!controller.signal.aborted) setState({ owner: userId, status: 'error', data: [], message: appointmentErrorMessage(error, 'list') });
      },
    );
    return () => controller.abort();
  }, [appointmentsApi, userId, revision]);

  const visible = state.owner === userId ? state : { owner: userId, status: 'loading' as const, data: [], message: '' };
  return {
    ...visible,
    refresh: () => setRevision((value) => value + 1),
    replace: (appointment: AppointmentSummary) => setState((current) => current.owner === userId
      ? { ...current, data: current.data.map((item) => item.id === appointment.id ? appointment : item) }
      : current),
  };
}
