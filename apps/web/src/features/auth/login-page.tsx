import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router';
import { Button } from '../../components/ui/button';
import { AsyncState } from '../../components/ui/async-state';
import { useAuth } from './auth-provider';
import { authErrorMessage, safeReturnTo } from './auth-session';

export function LoginPage() {
  const { status, login, error: sessionError, retrySession } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const routeState: unknown = location.state;
  const returnTo = safeReturnTo(typeof routeState === 'object' && routeState !== null && 'returnTo' in routeState ? routeState.returnTo : undefined);
  const registered = typeof routeState === 'object' && routeState !== null && 'registered' in routeState && routeState.registered === true;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      await login({ email: email.trim(), password });
      setPassword('');
      navigate(returnTo, { replace: true });
    } catch (failure) { setError(authErrorMessage(failure, 'login')); }
    finally { setPending(false); }
  }

  if (status === 'authenticated') return <Navigate to={returnTo} replace />;
  if (status === 'loading' && !pending) return <AsyncState kind="loading" title="Verificando tu sesión" />;
  return (
    <section className="auth-page" aria-labelledby="login-title">
      <div className="auth-card">
        <p className="eyebrow">Tu tiempo, mejor organizado</p>
        <h1 id="login-title">Inicia sesión en CitaJusta</h1>
        <p>Busca atenciones y administra tus citas en un solo lugar.</p>
        {registered && <p role="status" className="form-success">Tu cuenta fue creada. Ahora puedes iniciar sesión.</p>}
        <form onSubmit={(event) => { void submit(event); }} aria-busy={pending}>
          <div className="form-field"><label htmlFor="login-email">Correo electrónico</label><input id="login-email" name="email" type="email" autoComplete="username" required maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} disabled={pending} /></div>
          <div className="form-field"><label htmlFor="login-password">Contraseña</label><input id="login-password" name="password" type="password" autoComplete="current-password" required maxLength={128} value={password} onChange={(event) => setPassword(event.target.value)} disabled={pending} /></div>
          {(error || sessionError) && <p role="alert" className="form-error">{error || sessionError}</p>}
          <Button type="submit" disabled={pending}>{pending ? 'Iniciando sesión…' : 'Iniciar sesión'}</Button>
        </form>
        {status === 'error' && <Button variant="outline" onClick={() => { void retrySession(); }}>Reintentar sesión existente</Button>}
        <p>¿Aún no tienes una cuenta? <Link to="/registro">Crear cuenta</Link></p>
      </div>
    </section>
  );
}
