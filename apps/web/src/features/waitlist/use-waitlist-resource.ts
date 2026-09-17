import { useEffect, useRef, useState } from 'react';
import { waitlistErrorMessage } from './waitlist-api';

type Result<T> = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; data: T };

// La clave incluye usuario/recurso; las respuestas tardías nunca cambian el contexto actual.
export function useWaitlistResource<T>(key: string | null, load: (signal: AbortSignal) => Promise<T>) {
  const loader = useRef(load);
  loader.current = load;
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<{ key: string | null; revision: number; result: Result<T> }>();
  useEffect(() => {
    if (key === null) return;
    const controller = new AbortController();
    void Promise.resolve().then(async () => {
      if (controller.signal.aborted) return;
      try {
        const data = await loader.current(controller.signal);
        if (!controller.signal.aborted) setState({ key, revision, result: { status: 'ready', data } });
      } catch (error) {
        if (!controller.signal.aborted) setState({ key, revision, result: { status: 'error', message: waitlistErrorMessage(error) } });
      }
    });
    return () => controller.abort();
  }, [key, revision]);
  const result: Result<T> = state?.key === key && state.revision === revision ? state.result : { status: 'loading' };
  return { ...result, reload: () => setRevision((value) => value + 1) };
}
