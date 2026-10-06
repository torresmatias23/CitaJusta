import { useEffect, useRef, useState } from 'react';
import { googleClientId, renderGoogleButton } from './google-identity';

export function GoogleButton({ onCredential, disabled = false, clientId = googleClientId(import.meta.env.VITE_GOOGLE_CLIENT_ID) }: {
  onCredential: (credential: string) => void; disabled?: boolean; clientId?: string | undefined;
}) {
  const target = useRef<HTMLDivElement>(null);
  const current = useRef({ onCredential, disabled });
  current.current = { onCredential, disabled };
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!clientId || !target.current) return;
    let active = true;
    let dispose: (() => void) | undefined;
    setFailed(false);
    void renderGoogleButton(clientId, target.current, (credential) => {
      if (active && !current.current.disabled) current.current.onCredential(credential);
    }).then((cleanup) => { if (active) dispose = cleanup; else cleanup(); })
      .catch(() => { if (active) setFailed(true); });
    return () => { active = false; dispose?.(); };
  }, [clientId]);
  if (!clientId) return null;
  return <div className="google-auth" aria-busy={disabled}>
    <p>Continuar con Google</p>
    <div ref={target} inert={disabled} />
    {failed && <p role="alert" className="form-error">No pudimos cargar Google. Revisa tu conexión o usa tu contraseña.</p>}
  </div>;
}
