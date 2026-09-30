import { CalendarDays, Check, Clock3, MapPin, RefreshCw, UserRound, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import { AsyncState } from '../../components/ui/async-state';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { useAuth } from '../auth/auth-provider';
import { createSubmissionLock } from '../appointments/appointments-api';
import { canRespondToOffer, createOffersApi, offerErrorMessage, type Offer, type OfferStatus } from './offers-api';

const labels: Record<OfferStatus, string> = {
  PENDING: 'Pendiente', ACCEPTED: 'Aceptada', REJECTED: 'Rechazada',
  EXPIRED: 'Vencida', INVALIDATED: 'Invalidada', CANCELLED: 'Cancelada',
};
type Action = 'accept' | 'reject';
type Resource = { status: 'loading' } | { status: 'ready'; data: Offer[] } | { status: 'error'; message: string };
const formatDate = (value: string) => new Date(value).toLocaleString('es-CL', { dateStyle: 'medium', timeStyle: 'short' });

export function OfferCard({ offer, now, busy, onRespond }: {
  offer: Offer; now: number; busy: boolean; onRespond: (offer: Offer, action: Action) => void;
}) {
  const elapsed = offer.status === 'PENDING' && !canRespondToOffer(offer, now);
  const remaining = Math.max(0, Math.ceil((Date.parse(offer.expiresAt) - now) / 1000));
  return <article className={`content-panel offer-card ${canRespondToOffer(offer, now) ? 'offer-current' : 'offer-closed'}`} aria-labelledby={`offer-${offer.id}`}>
    {canRespondToOffer(offer, now) && <div className="offer-invitation"><span className="offer-ribbon"><Check size={16} aria-hidden="true" /> Hora liberada</span><p>¡Tenemos <span>una hora para ti!</span></p></div>}
    <div className="offer-service flex flex-wrap items-start justify-between gap-3">
      <h2 id={`offer-${offer.id}`} className="min-w-0 break-words">{offer.service.name}</h2>
      <span className={`offer-state offer-state-${elapsed ? 'EXPIRED' : offer.status}`}><Badge tone={canRespondToOffer(offer, now) || offer.status === 'ACCEPTED' ? 'teal' : 'neutral'}>{elapsed ? 'Plazo vencido' : labels[offer.status]}</Badge></span>
    </div>
    {offer.status === 'PENDING' && !elapsed && <>
      <div className="offer-countdown" aria-label="Tiempo restante"><Clock3 size={22} aria-hidden="true" /><div><span>Expira en</span><strong>{Math.floor(remaining / 60)} min {remaining % 60} s</strong></div></div>
      <img className="offer-illustration" src="/images/home-hero.png" alt="" aria-hidden="true" width={1536} height={1024} />
    </>}
    <dl className="offer-details">
      {canRespondToOffer(offer, now) ? <>
        <div className="offer-date"><dt><CalendarDays size={18} aria-hidden="true" /> Fecha</dt><dd><time dateTime={offer.startsAt}>{new Date(offer.startsAt).toLocaleDateString('es-CL', { dateStyle: 'medium' })}</time></dd></div>
        <div className="offer-time"><dt><Clock3 size={18} aria-hidden="true" /> Horario</dt><dd><time dateTime={offer.startsAt}>{new Date(offer.startsAt).toLocaleTimeString('es-CL', { timeStyle: 'short' })}</time> — <time dateTime={offer.endsAt}>{formatDate(offer.endsAt)}</time></dd></div>
      </> : <div><dt className="flex items-center gap-2 text-sm text-muted"><CalendarDays size={18} aria-hidden="true" /> Atención ofrecida</dt><dd className="mt-1"><time dateTime={offer.startsAt}>{formatDate(offer.startsAt)}</time> — <time dateTime={offer.endsAt}>{formatDate(offer.endsAt)}</time></dd></div>}
      <div><dt className="flex items-center gap-2 text-sm text-muted"><MapPin size={18} aria-hidden="true" /> Sede o sucursal</dt><dd className="mt-1">{offer.branch.name}</dd></div>
      <div><dt className="flex items-center gap-2 text-sm text-muted"><UserRound size={18} aria-hidden="true" /> Profesional</dt><dd className="mt-1">{offer.professional.firstNames} {offer.professional.lastNames}</dd></div>
      <div><dt className="flex items-center gap-2 text-sm text-muted"><Clock3 size={18} aria-hidden="true" /> Vigencia hasta</dt><dd className="mt-1"><time dateTime={offer.expiresAt}>{formatDate(offer.expiresAt)}</time></dd></div>
    </dl>
    {offer.respondedAt && <p className="mb-4 text-sm">Respuesta registrada: <time dateTime={offer.respondedAt}>{formatDate(offer.respondedAt)}</time></p>}
    {offer.status === 'PENDING' && <>
      {elapsed && <p className="offer-expired-note">El plazo terminó según el reloj de tu dispositivo. El estado registrado sigue pendiente; actualiza para consultar el estado oficial.</p>}
      <div className="offer-actions" aria-label={`Responder oferta de ${offer.service.name}`} aria-busy={busy}>
        <Button disabled={busy || elapsed} onClick={() => onRespond(offer, 'accept')}><Check size={18} aria-hidden="true" /> Aceptar hora</Button>
        <Button variant="outline" disabled={busy || elapsed} onClick={() => onRespond(offer, 'reject')}><X size={18} aria-hidden="true" /> No puedo asistir</Button>
      </div>
    </>}
    {offer.status === 'ACCEPTED' && <Link className="button button-outline" to="/mis-citas">Ver mis citas</Link>}
    {canRespondToOffer(offer, now) && <p className="offer-authority">La institución confirmará la vigencia al responder.</p>}
  </article>;
}

export function OffersList({ offers, now, busy, onRespond }: {
  offers: Offer[]; now: number; busy: boolean; onRespond: (offer: Offer, action: Action) => void;
}) {
  const current = offers.filter(offer => canRespondToOffer(offer, now));
  const elapsed = offers.filter(offer => offer.status === 'PENDING' && !canRespondToOffer(offer, now));
  const history = offers.filter(offer => offer.status !== 'PENDING');
  const list = (items: Offer[], label: string) => <ul className="offer-list" aria-label={label}>
    {items.map(offer => <li key={offer.id}><OfferCard offer={offer} now={now} busy={busy} onRespond={onRespond} /></li>)}
  </ul>;
  return <div className="offers-groups">
    <section aria-labelledby="current-offers-title"><h2 id="current-offers-title">Ofertas disponibles</h2>
      {current.length ? list(current, 'Ofertas vigentes') : <AsyncState kind="empty" title="No tienes ofertas disponibles en este momento." />}
    </section>
    {!!elapsed.length && <section aria-labelledby="elapsed-offers-title"><h2 id="elapsed-offers-title">Ofertas con plazo terminado</h2>{list(elapsed, 'Pendientes de confirmar estado oficial')}</section>}
    <section className="offer-history" aria-labelledby="offer-history-title"><h2 id="offer-history-title">Historial de ofertas</h2>
      {history.length ? list(history, 'Ofertas cerradas') : <p className="offer-history-empty">Aún no tienes ofertas cerradas.</p>}
    </section>
  </div>;
}

export function OffersPage() {
  const { user } = useAuth();
  return user ? <OffersContent key={user.id} /> : null;
}

function OffersContent() {
  const { api } = useAuth();
  const offersApi = useMemo(() => createOffersApi(api), [api]);
  const [revision, setRevision] = useState(0);
  const [resource, setResource] = useState<{ revision: number; result: Resource }>({ revision: 0, result: { status: 'loading' } });
  const [now, setNow] = useState(Date.now);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'success' | 'error'; message: string } | null>(null);
  const lock = useRef(createSubmissionLock());
  const writing = useRef<AbortController | null>(null);
  const refresh = () => setRevision((value) => value + 1);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => { window.clearInterval(timer); writing.current?.abort(); };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    void offersApi.list(controller.signal).then(
      (data) => { if (!controller.signal.aborted) setResource({ revision, result: { status: 'ready', data } }); },
      (error: unknown) => { if (!controller.signal.aborted) setResource({ revision, result: { status: 'error', message: offerErrorMessage(error) } }); },
    );
    return () => controller.abort();
  }, [offersApi, revision]);

  async function respond(offer: Offer, action: Action) {
    await lock.current.run(async () => {
      if (!canRespondToOffer(offer, Date.now())) { setNow(Date.now()); return; }
      const controller = new AbortController(); writing.current = controller;
      setBusy(true); setNotice(null);
      try {
        if (action === 'accept') {
          const result = await offersApi.accept(offer.id, controller.signal);
          if (!controller.signal.aborted) setNotice({ kind: 'success', message: `Hora aceptada para ${formatDate(result.appointment.startsAt)}. Consulta la reserva en Mis citas.` });
        } else {
          await offersApi.reject(offer.id, controller.signal);
          if (!controller.signal.aborted) setNotice({ kind: 'success', message: 'Rechazaste esta oferta. Puedes revisar tus preferencias en Lista de espera.' });
        }
      } catch (error) {
        if (!controller.signal.aborted) setNotice({ kind: 'error', message: offerErrorMessage(error) });
      } finally {
        // Refetch even after an uncertain response; never assume a write failed or replay it.
        if (!controller.signal.aborted) { setBusy(false); refresh(); }
      }
    });
  }

  const result: Resource = resource.revision === revision ? resource.result : { status: 'loading' };
  return <section className="page-container route-page offers-page" aria-labelledby="offers-heading">
    <div className="page-heading">
      <div><h1 id="offers-heading">Mis ofertas de atención</h1><p>Revisa las horas que te han ofrecido y decide si puedes asistir.</p></div>
      <Button variant="outline" disabled={busy || result.status === 'loading'} onClick={refresh}><RefreshCw size={18} aria-hidden="true" /> Actualizar ofertas</Button>
    </div>
    <div className="mb-5 flex flex-wrap gap-4"><Link to="/lista-de-espera" className="font-semibold text-brand underline underline-offset-4">Lista de espera y preferencias</Link><Link to="/mis-citas" className="font-semibold text-brand underline underline-offset-4">Mis citas</Link></div>
    {notice && <p className={`content-panel offer-feedback offer-feedback-${notice.kind}`} role={notice.kind === 'error' ? 'alert' : 'status'}>{notice.message}</p>}
    {busy && <p role="status" className="offer-processing">Procesando respuesta…</p>}
    <p className="mb-5 text-sm text-muted">Hasta 100 ofertas recientes, de más nueva a más antigua. Horarios en {Intl.DateTimeFormat().resolvedOptions().timeZone}. La institución confirma la vigencia al responder.</p>
    {result.status === 'loading' && <AsyncState kind="loading" title="Cargando tus ofertas…" />}
    {result.status === 'error' && <AsyncState kind="error" title="No pudimos consultar las ofertas" description={result.message} onRetry={refresh} />}
    {result.status === 'ready' && <OffersList offers={result.data} now={now} busy={busy} onRespond={(item, action) => { void respond(item, action); }} />}
  </section>;
}
