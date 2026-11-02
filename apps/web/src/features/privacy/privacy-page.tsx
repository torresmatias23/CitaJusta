import { Link, useLocation } from 'react-router';
import { Button } from '../../components/ui/button';
import type { PrivacyState } from './privacy-model';
import { usePrivacy } from './privacy-provider';

export function PrivacyLink() {
  return <p className="privacy-introduction">Conoce cómo se usan tus datos en <Link to="/privacidad">Información de privacidad</Link>. Crear una cuenta o acceder no confirma la lectura ni concede consentimientos adicionales.</p>;
}
export function PrivacyBanner() {
  const { state, authenticated, model } = usePrivacy();
  const { pathname } = useLocation();
  if (!authenticated || pathname === '/privacidad' || state.status === 'loading' || state.acknowledgedAt) return null;
  return <aside className="page-container privacy-banner" aria-label="Información de privacidad pendiente">
    <p>{state.status === 'error' ? state.error : 'Hay información de privacidad que aún no has confirmado haber visto. Puedes continuar usando CitaJusta.'}</p>
    <Link to="/privacidad" className="button button-outline">Consultar aviso</Link>
    {state.status === 'error' && <Button variant="outline" onClick={() => { void model.load(); }}>Reintentar</Button>}
  </aside>;
}
export function PrivacyPage() {
  const { state, authenticated, model } = usePrivacy();
  return <PrivacyNoticeView state={state} authenticated={authenticated}
    onRetry={() => { void model.load(); }} onAcknowledge={() => { void model.acknowledge(); }} />;
}
export function PrivacyNoticeView({ state, authenticated, onRetry, onAcknowledge }: {
  state: PrivacyState; authenticated: boolean; onRetry: () => void; onAcknowledge: () => void;
}) {
  return <section className="page-container privacy-page" aria-labelledby="privacy-title">
    <h1 id="privacy-title">{state.notice?.title ?? 'Información de privacidad'}</h1>
    {state.status === 'loading' && <p role="status">Cargando información…</p>}
    {state.notice && <>
      <p className="eyebrow">Versión {state.notice.version} · Publicada {state.notice.publishedOn}</p>
      <p>{state.notice.introduction}</p>
      {state.notice.sections.map((section, index) => <section key={index} className="privacy-section">
        <h2>{section.heading}</h2>{section.paragraphs.map((paragraph, index) => <p key={index}>{paragraph}</p>)}
      </section>)}
    </>}
    {state.error && <div role="alert"><p className="form-error">{state.error}</p><Button variant="outline" onClick={onRetry} disabled={state.pending}>Volver a cargar el aviso</Button></div>}
    {authenticated && state.status === 'ready' && state.notice && <div className="privacy-confirmation">
      {state.acknowledgedAt ? <p role="status">Confirmaste haber visto esta versión el {new Date(state.acknowledgedAt).toLocaleString()}. Esto no es un consentimiento de tratamiento.</p> : <>
        <p id="privacy-confirmation-help">Esta acción registra solamente que viste esta información. No autoriza tratamientos adicionales ni cambia tus preferencias.</p>
        <Button onClick={onAcknowledge} disabled={state.pending} aria-describedby="privacy-confirmation-help">{state.pending ? 'Registrando…' : 'Ya vi esta información'}</Button>
      </>}
    </div>}
    {!authenticated && <p>La consulta es pública. No se registra una confirmación antes de iniciar sesión.</p>}
    <nav className="privacy-navigation" aria-label="Continuar navegando"><Link to="/">Volver al inicio</Link>{authenticated && <Link to="/cuenta">Mi cuenta y preferencias</Link>}</nav>
  </section>;
}
