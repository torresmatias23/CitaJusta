import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Bell, Mail, ShieldCheck, UserRound } from 'lucide-react';
import { Link } from 'react-router';
import { Button } from '../../components/ui/button';
import { AsyncState } from '../../components/ui/async-state';
import { createAccountModel, type AccountModel, type AccountState } from './account-model';
import { useAuth } from './auth-provider';
import { GoogleButton } from './google-button';
import { googleClientId, googleErrorMessage } from './google-identity';

export function AccountPage() {
  const { user, status, api, refreshProfile } = useAuth();
  if (status !== 'authenticated' || !user) return null;
  return <AccountWorkspace key={user.id} api={api} refreshProfile={refreshProfile} userId={user.id} />;
}

function AccountWorkspace({ api, refreshProfile, userId }: { api: Parameters<typeof createAccountModel>[0]; refreshProfile: () => Promise<void>; userId: string }) {
  const [model] = useState(() => createAccountModel(api, refreshProfile, userId));
  const state = useSyncExternalStore(model.subscribe, model.getSnapshot, model.getSnapshot);
  useEffect(() => { void model.load(); return () => model.dispose(); }, [model]);
  return <AccountView state={state} model={model} google={<GoogleLink />} />;
}

function GoogleLink() {
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
  return <div className="account-google">
    {googleClientId(import.meta.env.VITE_GOOGLE_CLIENT_ID) ? <>
      <p>Vincula Google con el mismo correo para iniciar sesión. Tu contraseña y permisos actuales se conservan.</p>
      <GoogleButton disabled={pending} onCredential={(credential) => { void link(credential); }} />
    </> : <p>La vinculación con Google no está habilitada.</p>}
    {message && <p role="status" className="form-success">{message}</p>}
    {error && <p role="alert" className="form-error">{error}</p>}
  </div>;
}

export function AccountView({ state, model, google }: { state: AccountState; model: AccountModel; google: React.ReactNode }) {
  const data = state.data;
  if (state.status === 'loading') return <section className="page-container account-page"><AsyncState kind="loading" title="Cargando tu cuenta" /></section>;
  if (state.status === 'error' || !data) return <section className="page-container account-page"><AsyncState kind="error" title="No pudimos cargar tu cuenta" description={state.loadError} onRetry={() => { void model.load(); }} /></section>;
  const initials = `${data.firstName.trim().charAt(0)}${data.lastName.trim().charAt(0)}`.toUpperCase();
  return <section className="page-container account-page" aria-labelledby="account-title">
    <header className="account-heading"><div><p className="eyebrow">Tu espacio personal</p><h1 id="account-title">Mi cuenta</h1><p>Administra tus datos y elige los correos que quieres recibir.</p></div><span className="badge">Cuenta activa</span></header>
    <div className="account-identity"><span className="account-avatar" aria-hidden="true">{initials}</span><div><h2>{data.firstName} {data.lastName}</h2><p><Mail size={16} aria-hidden="true" /> {data.email}</p></div></div>
    <div className="account-grid"><div className="account-main">
      <section className="account-panel" aria-labelledby="personal-title"><div className="account-panel-heading"><UserRound aria-hidden="true" /><div><h2 id="personal-title">Información personal</h2><p>Estos datos te identifican en CitaJusta.</p></div></div>
        <form onSubmit={event => { event.preventDefault(); void model.savePersonal(); }} aria-busy={state.profilePending}>
          <fieldset disabled={state.profilePending} className="account-fields"><legend className="sr-only">Datos personales</legend>
            <div className="form-field"><label htmlFor="account-first-name">Nombres</label><input id="account-first-name" autoComplete="given-name" required maxLength={120} value={state.firstName} onChange={event => model.setPersonal('firstName', event.target.value)} aria-describedby={state.profileError ? 'account-profile-error' : undefined} /></div>
            <div className="form-field"><label htmlFor="account-last-name">Apellidos</label><input id="account-last-name" autoComplete="family-name" required maxLength={120} value={state.lastName} onChange={event => model.setPersonal('lastName', event.target.value)} aria-describedby={state.profileError ? 'account-profile-error' : undefined} /></div>
            <div className="form-field"><label htmlFor="account-phone">Teléfono <span className="account-optional">(opcional)</span></label><input id="account-phone" type="tel" autoComplete="tel" maxLength={30} value={state.phone} onChange={event => model.setPersonal('phone', event.target.value)} aria-describedby="account-phone-help" /><small id="account-phone-help">Hasta 30 caracteres. Deja vacío para quitarlo.</small></div>
            <div className="form-field"><label htmlFor="account-email">Correo electrónico</label><input id="account-email" type="email" value={data.email} readOnly aria-describedby="account-email-help" /><small id="account-email-help">El correo de acceso no se modifica desde esta página.</small></div>
          </fieldset>
          {state.profileError && <p id="account-profile-error" className="form-error" role="alert">{state.profileError}</p>}
          {state.profileMessage && <p className="form-success" role="status">{state.profileMessage}</p>}
          <div className="account-actions"><Button type="submit" disabled={state.profilePending}>{state.profilePending ? 'Guardando…' : 'Guardar información'}</Button></div>
        </form>
      </section>
      <section className="account-panel" aria-labelledby="preferences-title"><div className="account-panel-heading"><Bell aria-hidden="true" /><div><h2 id="preferences-title">Preferencias de correo</h2><p>Elige qué novedades recibir en tu correo electrónico.</p></div></div>
        <form onSubmit={event => { event.preventDefault(); void model.savePreferences(); }} aria-busy={state.preferencesPending}>
          <fieldset disabled={state.preferencesPending} className="account-preferences"><legend className="sr-only">Categorías de correo</legend>
            <label className="account-preference"><input type="checkbox" checked={state.preferences.appointmentEmailsEnabled} onChange={event => model.setPreference('appointmentEmailsEnabled', event.target.checked)} aria-describedby="appointment-emails-help" /><span><strong>Correos de citas</strong><span id="appointment-emails-help">Reservas y cancelaciones de tus citas.</span></span></label>
            <label className="account-preference"><input type="checkbox" checked={state.preferences.offerEmailsEnabled} onChange={event => model.setPreference('offerEmailsEnabled', event.target.checked)} aria-describedby="offer-emails-help" /><span><strong>Correos de ofertas de reasignación</strong><span id="offer-emails-help">Nuevas ofertas y su aceptación, rechazo o vencimiento.</span></span></label>
          </fieldset>
          <p className="account-note">Las notificaciones internas continúan disponibles. Los correos de recuperación de contraseña no se desactivan aquí.</p>
          {state.preferencesError && <p className="form-error" role="alert">{state.preferencesError}</p>}
          {state.preferencesMessage && <p className="form-success" role="status">{state.preferencesMessage}</p>}
          <div className="account-actions"><Button type="submit" disabled={state.preferencesPending}>{state.preferencesPending ? 'Guardando…' : 'Guardar preferencias'}</Button></div>
        </form>
      </section>
    </div><aside className="account-panel account-security" aria-labelledby="security-title"><div className="account-panel-heading"><ShieldCheck aria-hidden="true" /><h2 id="security-title">Seguridad y acceso</h2></div>
      <p>Tu cuenta está activa. Los roles y permisos se administran por separado y no cambian al editar tu perfil.</p>
      <h3>Acceso con Google</h3>{google}
      <h3>Recuperación de cuenta</h3><p>Si necesitas restablecer una contraseña local, solicita un enlace seguro.</p><Link to="/recuperar-cuenta" className="button button-outline">Recuperar cuenta</Link>
    </aside></div>
  </section>;
}
