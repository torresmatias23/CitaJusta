import { useRef, useState } from 'react';
import { useAuth } from './auth-provider';
import { GoogleButton } from './google-button';
import { googleClientId, googleErrorMessage } from './google-identity';

export function AccountPage() {
  const { user, status, linkGoogle } = useAuth();
  const busy = useRef(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function link(credential: string) {
    if (busy.current) return;
    busy.current = true; setPending(true); setMessage(null); setError(null);
    try { await linkGoogle(credential); setMessage('Cuenta Google vinculada. Puedes usarla para iniciar sesión.'); }
    catch (failure) { setError(googleErrorMessage(failure)); }
    finally { busy.current = false; setPending(false); }
  }
  if (status !== 'authenticated' || !user) return null;
  return <section className="auth-page" aria-labelledby="account-title"><div className="auth-card">
    <h1 id="account-title">Mi cuenta</h1>
    <p>{user.firstName} {user.lastName}</p><p>{user.email}</p>
    {googleClientId(import.meta.env.VITE_GOOGLE_CLIENT_ID) ? <>
      <p>Vincula Google con el mismo correo para iniciar sesión. Tu contraseña y permisos actuales se conservan.</p>
      <GoogleButton disabled={pending} onCredential={(credential) => { void link(credential); }} />
    </> : <p>La vinculación con Google no está habilitada.</p>}
    {message && <p role="status" className="form-success">{message}</p>}
    {error && <p role="alert" className="form-error">{error}</p>}
  </div></section>;
}
