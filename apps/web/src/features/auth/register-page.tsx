import { UserPlus } from 'lucide-react';
import { useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, Navigate, useNavigate } from 'react-router';
import { Button } from '../../components/ui/button';
import { AsyncState } from '../../components/ui/async-state';
import { useAuth } from './auth-provider';
import { authErrorMessage } from './auth-session';
import { GoogleButton } from './google-button';
import { googleClientId, signInWithGoogle } from './google-identity';

export function RegisterPage() {
  const { register, loginGoogle, status } = useAuth();
  const busy = useRef(false);
  const clientId = googleClientId(import.meta.env.VITE_GOOGLE_CLIENT_ID);
  const navigate = useNavigate();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy.current) return;
    setError(null);
    if (!firstName.trim() || !lastName.trim()) { setError('Ingresa tu nombre y apellido.'); return; }
    busy.current = true; setPending(true);
    try {
      await register({ firstName: firstName.trim(), lastName: lastName.trim(), email: email.trim(), password });
      setPassword('');
      navigate('/login', { replace: true, state: { registered: true } });
    } catch (failure) { setError(authErrorMessage(failure, 'register')); }
    finally { busy.current = false; setPending(false); }
  }

  async function googleSignIn(credential: string) {
    await signInWithGoogle(credential, {
      busy, loginGoogle, setPending, setError,
      onSuccess: () => { setPassword(''); navigate('/', { replace: true }); },
    });
  }

  if (status === 'authenticated') return <Navigate to="/" replace />;
  if (status === 'loading' && !pending) return <AsyncState kind="loading" title="Verificando tu sesión" />;
  return (
    <section className="auth-page" aria-labelledby="register-title">
      <div className="auth-card">
        <span className="auth-symbol"><UserPlus aria-hidden="true" /></span>
        <p className="eyebrow">Comienza con CitaJusta</p>
        <h1 id="register-title">Crea tu cuenta</h1>
        <p>Una cuenta para gestionar tus atenciones con instituciones, empresas y profesionales.</p>
        <form onSubmit={(event) => { void submit(event); }} aria-busy={pending}>
          <div className="form-field"><label htmlFor="register-first-name">Nombre</label><input id="register-first-name" name="firstName" autoComplete="given-name" required maxLength={120} value={firstName} onChange={(event) => setFirstName(event.target.value)} disabled={pending} /></div>
          <div className="form-field"><label htmlFor="register-last-name">Apellido</label><input id="register-last-name" name="lastName" autoComplete="family-name" required maxLength={120} value={lastName} onChange={(event) => setLastName(event.target.value)} disabled={pending} /></div>
          <div className="form-field"><label htmlFor="register-email">Correo electrónico</label><input id="register-email" name="email" type="email" autoComplete="email" required maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} disabled={pending} /></div>
          <div className="form-field"><label htmlFor="register-password">Contraseña</label><input id="register-password" name="password" type="password" autoComplete="new-password" required minLength={12} maxLength={128} aria-describedby="password-help" value={password} onChange={(event) => setPassword(event.target.value)} disabled={pending} /><small id="password-help">Entre 12 y 128 caracteres.</small></div>
          {error && <p role="alert" className="form-error">{error}</p>}
          <Button type="submit" disabled={pending}>{pending ? 'Creando cuenta…' : 'Crear cuenta'}</Button>
        </form>
        {clientId && <>
          <div className="auth-divider" aria-hidden="true">o</div>
          <p>También puedes crear o acceder a tu cuenta con Google.</p>
          <GoogleButton clientId={clientId} disabled={pending} onCredential={(credential) => { void googleSignIn(credential); }} />
        </>}
        <p className="auth-switch">¿Ya tienes cuenta? <Link to="/login">Iniciar sesión</Link></p>
      </div>
    </section>
  );
}
