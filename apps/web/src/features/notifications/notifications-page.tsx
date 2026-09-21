import { useEffect } from 'react';
import { Link } from 'react-router';
import { Bell, RefreshCw } from 'lucide-react';
import { AsyncState } from '../../components/ui/async-state';
import { Button } from '../../components/ui/button';
import { Badge } from '../../components/ui/badge';
import { useNotifications } from './notifications-provider';
import type { Notification } from './notifications-api';
import type { NotificationsSnapshot } from './notifications-store';

export function NotificationCount({ count }: { count: number | null }) {
  return count !== null && count > 0 ? <span className="badge badge-teal ml-1" aria-label={count === 1 ? '1 notificación sin leer' : `${count} notificaciones sin leer`}>{count > 99 ? '99+' : count}</span> : null;
}
export function NotificationCard({ item, busy, onRead }: { item: Notification; busy: boolean; onRead: (id: string) => void }) {
  return <article className={`content-panel ${item.readAt ? '' : 'border-l-4 border-l-brand'}`} aria-labelledby={`notification-${item.id}`}>
    <div className="flex flex-wrap items-start justify-between gap-3">
      <h2 id={`notification-${item.id}`}>{item.title}</h2><Badge tone={item.readAt ? 'neutral' : 'teal'}>{item.readAt ? 'Leída' : 'Sin leer'}</Badge>
    </div>
    <time className="mt-2 block text-sm text-muted" dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleString('es-CL', { dateStyle: 'medium', timeStyle: 'short' })}</time>
    <p className="my-4 leading-relaxed">{item.message}</p>
    <div className="flex flex-wrap gap-3">
      <Link className="button button-outline" to={item.path}>{item.path === '/ofertas' ? 'Ver ofertas' : item.path === '/mis-citas' ? 'Ver mis citas' : 'Ver lista de espera'}</Link>
      {!item.readAt && <Button disabled={busy} onClick={() => onRead(item.id)}>{busy ? 'Guardando…' : 'Marcar como leída'}</Button>}
    </div>
  </article>;
}
export function NotificationsView({ state, onLoad, onRead }: { state: NotificationsSnapshot; onLoad: (more?: boolean) => void; onRead: (id: string) => void }) {
  return <section className="page-container route-page" aria-labelledby="notifications-heading">
    <div className="page-heading"><div><h1 id="notifications-heading" className="flex items-center gap-3"><Bell aria-hidden="true" /> Notificaciones</h1>
      <p>Novedades sobre tus reservas, solicitudes y ofertas.</p></div>
      <Button variant="outline" disabled={state.status === 'loading' || state.loadingMore || state.reading.length > 0} onClick={() => onLoad()}><RefreshCw size={18} aria-hidden="true" /> Actualizar</Button>
    </div>
    {state.unreadCount !== null && <p role="status" className="mb-5 text-sm text-muted">{state.unreadCount === 0 ? 'No tienes notificaciones sin leer.' : state.unreadCount === 1 ? '1 notificación sin leer.' : `${state.unreadCount} notificaciones sin leer.`}</p>}
    {(state.status === 'loading' || state.status === 'idle') && <AsyncState kind="loading" title="Cargando notificaciones…" />}
    {state.status === 'error' && <AsyncState kind="error" title="No pudimos consultar tus notificaciones" description={state.error ?? ''} onRetry={() => onLoad()} />}
    {state.status === 'ready' && <>
      {state.error && <p role="alert" className="content-panel mb-5">{state.error} <Button variant="outline" onClick={() => onLoad()}>Reintentar</Button></p>}
      {state.items.length === 0 && <AsyncState kind="empty" title="Aún no tienes notificaciones" description="Aquí aparecerán las novedades de tus reservas, lista de espera y ofertas." />}
      <ul className="grid gap-5" aria-label="Notificaciones propias">{state.items.map((item) => <li key={item.id}><NotificationCard item={item} busy={state.reading.includes(item.id)} onRead={onRead} /></li>)}</ul>
      {state.nextCursor && <div className="mt-6"><Button variant="outline" disabled={state.loadingMore || state.reading.length > 0} onClick={() => onLoad(true)}>{state.loadingMore ? 'Cargando…' : 'Cargar más'}</Button></div>}
    </>}
  </section>;
}
export function NotificationsPage() {
  const notifications = useNotifications(); const { load, read } = notifications;
  useEffect(() => { void load(); }, [load]);
  return <NotificationsView state={notifications} onLoad={(more) => { void load(more); }} onRead={(id) => { void read(id); }} />;
}
