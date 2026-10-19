import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { KeyRound } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { publicRecoveryApi, readRecoveryToken, recoveryConfirmation, recoveryError, removeRecoveryFragment } from './account-recovery-api';

export function ForgotPasswordPage() {
  const [api] = useState(publicRecoveryApi);
  const busy = useRef(false);
  const [email, setEmail] = useState(''), [pending, setPending] = useState(false);
  const [done, setDone] = useState(false), [error, setError] = useState('');
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy.current) return;
    busy.current = true; setPending(true); setError('');
    try { await api.request(email); setEmail(''); setDone(true); }
    catch (failure) { setError(recoveryError(failure)); }
    finally { busy.current = false; setPending(false); }
  }
  return <section className="auth-page" aria-labelledby="recovery-title"><div className="auth-card">
    <span className="auth-symbol"><KeyRound aria-hidden="true" /></span>
    <h1 id="recovery-title">Recupera tu cuenta</h1>
    {done ? <p role="status" className="form-success">{recoveryConfirmation}</p> : <>
      <p>Ingresa el correo de tu cuenta para solicitar un enlace de recuperación.</p>
      <form onSubmit={event => { void submit(event); }} aria-busy={pending}>
        <div className="form-field"><label htmlFor="recovery-email">Correo electrónico</label><input id="recovery-email" type="email" autoComplete="email" required maxLength={254} value={email} onChange={event => setEmail(event.target.value)} disabled={pending} /></div>
        {error && <p role="alert" className="form-error">{error}</p>}
        <Button type="submit" disabled={pending}>{pending ? 'Enviando solicitud…' : 'Solicitar recuperación'}</Button>
      </form>
    </>}
    <p className="auth-switch"><Link to="/login">Volver a iniciar sesión</Link></p>
  </div></section>;
}

export function ResetPasswordPage() {
  const [api] = useState(publicRecoveryApi);
  const [token, setToken] = useState(() => typeof window === 'undefined' ? '' : readRecoveryToken(window.location.hash));
  const [password, setPassword] = useState(''), [confirmation, setConfirmation] = useState('');
  const [pending, setPending] = useState(false), [error, setError] = useState('');
  const busy = useRef(false), navigate = useNavigate();
  useEffect(() => { removeRecoveryFragment(window.location, window.history); }, []);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy.current || !token) return;
    if (password !== confirmation) { setError('Las contraseñas no coinciden.'); return; }
    busy.current = true; setPending(true); setError('');
    try {
      await api.reset(token, password); setToken(''); setPassword(''); setConfirmation('');
      navigate('/login', { replace: true, state: { passwordReset: true } });
    } catch (failure) { setError(recoveryError(failure)); }
    finally { busy.current = false; setPending(false); }
  }
  return <section className="auth-page" aria-labelledby="reset-title"><div className="auth-card">
    <span className="auth-symbol"><KeyRound aria-hidden="true" /></span><h1 id="reset-title">Restablece tu contraseña</h1>
    {!token ? <p role="alert">El enlace no es válido. Solicita una nueva recuperación.</p> : <>
      <p>Elige una contraseña de entre 12 y 128 caracteres. Deberás iniciar sesión nuevamente en tus dispositivos.</p>
      <form onSubmit={event => { void submit(event); }} aria-busy={pending}>
        <div className="form-field"><label htmlFor="reset-password">Contraseña nueva</label><input id="reset-password" type="password" autoComplete="new-password" required minLength={12} maxLength={128} value={password} onChange={event => setPassword(event.target.value)} disabled={pending} /></div>
        <div className="form-field"><label htmlFor="reset-confirmation">Repite la contraseña</label><input id="reset-confirmation" type="password" autoComplete="new-password" required minLength={12} maxLength={128} value={confirmation} onChange={event => setConfirmation(event.target.value)} disabled={pending} /></div>
        {error && <p role="alert" className="form-error">{error}</p>}
        <Button type="submit" disabled={pending}>{pending ? 'Restableciendo…' : 'Guardar contraseña nueva'}</Button>
      </form>
    </>}
    <p className="auth-switch"><Link to="/recuperar-cuenta">Solicitar otro enlace</Link> · <Link to="/login">Iniciar sesión</Link></p>
  </div></section>;
}
