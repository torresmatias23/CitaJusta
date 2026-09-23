import { useState } from 'react';
import type { FormEvent } from 'react';
import { useAuth } from './auth-provider';

export function LoginScreen() {
  const auth = useAuth();
  const [pending, setPending] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const email = data.get('email');
    const password = data.get('password');
    if (typeof email !== 'string' || typeof password !== 'string') return;
    setPending(true);
    form.reset();
    try { await auth.login({ email, password }); }
    catch { /* El núcleo de sesión entrega el mensaje controlado. */ }
    finally { setPending(false); }
  }
  return (
    <main className="login-page">
      <section className="welcome-card login-card" aria-labelledby="login-title">
        <p className="brand">CitaJusta</p>
        <p className="subtitle">Gestión institucional · Desktop</p>
        <h1 id="login-title">Iniciar sesión</h1>
        <p>Utiliza tu cuenta de CitaJusta. La sesión se conserva sólo mientras esta aplicación permanece abierta.</p>
        {auth.error && <p role="alert">{auth.error}</p>}
        <form onSubmit={(event) => { void submit(event); }} aria-busy={pending}>
          <label htmlFor="email">Correo</label>
          <input id="email" name="email" type="email" autoComplete="username" required disabled={pending} />
          <label htmlFor="password">Contraseña</label>
          <input id="password" name="password" type="password" autoComplete="off" required disabled={pending} />
          <button className="primary-button" type="submit" disabled={pending}>{pending ? 'Iniciando sesión…' : 'Iniciar sesión'}</button>
        </form>
      </section>
    </main>
  );
}
