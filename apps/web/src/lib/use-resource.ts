import { useEffect, useRef, useState } from 'react';

export type Resource<T> =
  | { status: 'loading'; data?: never }
  | { status: 'error'; data?: never }
  | { status: 'success'; data: T };

// key incluye usuario y selección: nunca presenta datos del contexto anterior.
export function useResource<T>(key: string | null, load: (signal: AbortSignal) => Promise<T>) {
  const loader = useRef(load);
  loader.current = load;
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<{ key: string | null; attempt: number; result: Resource<T> }>({ key: null, attempt: 0, result: { status: 'loading' } });

  useEffect(() => {
    if (key === null) return;
    const controller = new AbortController();
    // Deferir un microtask evita la petición descartada por el primer montaje de StrictMode.
    void Promise.resolve().then(async () => {
      if (controller.signal.aborted) return;
      try {
        const data = await loader.current(controller.signal);
        if (!controller.signal.aborted) setState({ key, attempt, result: { status: 'success', data } });
      } catch {
        if (!controller.signal.aborted) setState({ key, attempt, result: { status: 'error' } });
      }
    });
    return () => controller.abort();
  }, [key, attempt]);

  const result: Resource<T> = state.key === key && state.attempt === attempt ? state.result : { status: 'loading' };
  return { ...result, reload: () => setAttempt((current) => current + 1) };
}
