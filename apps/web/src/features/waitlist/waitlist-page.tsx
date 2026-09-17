import { useEffect, useRef, useState } from 'react';
import { CircleAlert, CircleCheck, ListOrdered, Plus, RefreshCw, Settings2, X } from 'lucide-react';
import { AsyncState } from '../../components/ui/async-state';
import { Button } from '../../components/ui/button';
import { useAuth } from '../auth/auth-provider';
import { createSubmissionLock } from '../appointments/appointments-api';
import { createWaitlistApi, waitlistErrorMessage, type WaitlistEntry } from './waitlist-api';
import { WaitlistPreferencesPanel } from './waitlist-preferences-panel';
import { useWaitlistResource } from './use-waitlist-resource';
import './waitlist.css';

export type WaitlistApi = ReturnType<typeof createWaitlistApi>;
export type WaitlistWrite = (operation: (signal: AbortSignal) => Promise<unknown>, message: string, done?: () => void) => Promise<void>;

export function WaitlistPage() {
  const { user } = useAuth();
  return user ? <WaitlistContent key={user.id} owner={user.id} /> : null;
}

function WaitlistContent({ owner }: { owner: string }) {
  const { api } = useAuth();
  const waitlist = createWaitlistApi(api);
  const entries = useWaitlistResource(`${owner}:waitlist`, (signal) => waitlist.list(signal));
  const [selected, setSelected] = useState<WaitlistEntry | null>(null);
  const [withdrawing, setWithdrawing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'success' | 'error'; message: string } | null>(null);
  const lock = useRef(createSubmissionLock());
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);

  const write: WaitlistWrite = async (operation, message, done) => {
    await lock.current.run(async () => {
      const controller = new AbortController();
      request.current = controller;
      setBusy(true);
      setNotice(null);
      try {
        await operation(controller.signal);
        if (!controller.signal.aborted) {
          setNotice({ kind: 'success', message });
          entries.reload();
          done?.();
        }
      } catch (error) {
        if (!controller.signal.aborted) setNotice({ kind: 'error', message: waitlistErrorMessage(error) });
      } finally {
        if (!controller.signal.aborted) setBusy(false);
      }
    });
  };

  return (
    <div className="page-container route-page waitlist-page">
      <div className="page-heading">
        <div><h1>Mi lista de espera</h1><p>Gestiona tus solicitudes y las preferencias de atención que guardaste.</p></div>
        <Button variant="outline" disabled={busy} onClick={entries.reload}><RefreshCw size={18} aria-hidden="true" /> Actualizar lista</Button>
      </div>
      {notice && <div className="content-panel mb-5 flex items-start gap-3" role={notice.kind === 'error' ? 'alert' : 'status'}>
        {notice.kind === 'error' ? <CircleAlert className="shrink-0" aria-hidden="true" /> : <CircleCheck className="shrink-0" aria-hidden="true" />}
        <p><strong>{notice.kind === 'error' ? 'No se pudo completar la operación. ' : 'Operación completada. '}</strong>{notice.message}</p>
      </div>}
      <Enrollment api={waitlist} owner={owner} busy={busy} write={write} />
      <section aria-labelledby="waitlist-heading" className="mt-8">
        <h2 id="waitlist-heading" className="mb-4 flex items-center gap-2"><ListOrdered aria-hidden="true" /> Tus solicitudes abiertas</h2>
        <p className="mb-4 text-sm">Ordenadas por fecha de ingreso. El estado mostrado es el registrado por la institución.</p>
        {entries.status === 'loading' && <AsyncState kind="loading" title="Cargando tu lista de espera…" />}
        {entries.status === 'error' && <AsyncState kind="error" title="No pudimos cargar la lista" description={entries.message} onRetry={entries.reload} />}
        {entries.status === 'ready' && entries.data.length === 0 && <AsyncState kind="empty" title="No tienes solicitudes abiertas" description="Selecciona un servicio para ingresar a su lista de espera." />}
        {entries.status === 'ready' && <ul className="appointment-list" aria-label="Solicitudes de lista de espera">
          {entries.data.map((entry) => <li key={entry.id} className="content-panel">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div><h3>{entry.service.name}</h3><p>{entry.branch?.name ?? 'Sin sede asociada'}</p><p className="mt-2 text-sm">Ingreso: <time dateTime={entry.enteredAt}>{new Date(entry.enteredAt).toLocaleString('es-CL')}</time></p></div>
              <span className="rounded-full border px-3 py-1 text-sm">Estado: {entry.status}</span>
            </div>
            <div className="mt-5 flex flex-wrap gap-3">
              <Button variant="outline" disabled={busy} onClick={() => { setSelected(entry); setWithdrawing(null); }} aria-expanded={selected?.id === entry.id} aria-controls={selected?.id === entry.id ? 'waitlist-preferences' : undefined}><Settings2 size={18} aria-hidden="true" /> Preferencias de {entry.service.name}</Button>
              <Button variant="danger" disabled={busy} onClick={() => setWithdrawing(entry.id)}>Retirarme de {entry.service.name}</Button>
            </div>
            {withdrawing === entry.id && <div className="mt-4 rounded-lg border p-4">
              <p>¿Quieres retirarte de esta solicitud de {entry.service.name}?</p>
              <div className="mt-3 flex flex-wrap gap-3">
                <Button variant="danger" disabled={busy} onClick={() => { void write((signal) => waitlist.withdraw(entry.id, signal), 'Te retiraste de la lista de espera.', () => { setWithdrawing(null); if (selected?.id === entry.id) setSelected(null); }); }}>{busy ? 'Procesando…' : 'Confirmar retiro'}</Button>
                <Button variant="outline" disabled={busy} onClick={() => setWithdrawing(null)}>Volver</Button>
              </div>
            </div>}
          </li>)}
        </ul>}
      </section>
      {selected && <section id="waitlist-preferences" className="content-panel mt-8" aria-labelledby="preferences-heading">
        <div className="flex flex-wrap items-center justify-between gap-3"><h2 id="preferences-heading">Preferencias · {selected.service.name}</h2><Button variant="outline" disabled={busy} onClick={() => setSelected(null)}><X size={18} aria-hidden="true" /> Cerrar preferencias</Button></div>
        <WaitlistPreferencesPanel key={selected.id} entry={selected} owner={owner} api={waitlist} busy={busy} write={write} />
      </section>}
    </div>
  );
}

function Enrollment({ api, owner, busy, write }: { api: WaitlistApi; owner: string; busy: boolean; write: WaitlistWrite }) {
  const services = useWaitlistResource(`${owner}:waitlist-services`, (signal) => api.services(signal));
  const [serviceId, setServiceId] = useState('');
  const [branchId, setBranchId] = useState('');
  const branches = useWaitlistResource(serviceId ? `${owner}:service:${serviceId}` : null, (signal) => api.branches(serviceId, signal));
  return <section className="content-panel" aria-labelledby="enrollment-heading">
    <h2 id="enrollment-heading" className="mb-4">Ingresar a una lista de espera</h2>
    {services.status === 'loading' && <AsyncState kind="loading" title="Cargando servicios…" />}
    {services.status === 'error' && <AsyncState kind="error" title="No pudimos cargar los servicios" description={services.message} onRetry={services.reload} />}
    {services.status === 'ready' && (services.data.length === 0 ? <AsyncState kind="empty" title="No hay servicios disponibles" /> : <form onSubmit={(event) => {
      event.preventDefault();
      if (!serviceId) return;
      void write((signal) => api.enter({ serviceId, ...(branchId ? { branchId } : {}) }, signal), 'Solicitud registrada. Ya puedes configurar tus preferencias.', () => { setServiceId(''); setBranchId(''); });
    }}>
      <fieldset disabled={busy} className="grid gap-4 md:grid-cols-2">
        <label className="waitlist-field">Servicio o atención<select required value={serviceId} onChange={(event) => { setServiceId(event.target.value); setBranchId(''); }}><option value="">Selecciona un servicio</option>{services.data.map((service) => <option key={service.id} value={service.id}>{service.name} · {service.institution.name}</option>)}</select></label>
        <label className="waitlist-field">Sede o sucursal (opcional)<select value={branchId} disabled={!serviceId || branches.status !== 'ready'} onChange={(event) => setBranchId(event.target.value)}><option value="">Sin sede asociada</option>{branches.status === 'ready' && branches.data.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label>
        {serviceId && branches.status === 'loading' && <p role="status">Cargando sedes…</p>}
        {serviceId && branches.status === 'error' && <AsyncState kind="error" title="No pudimos cargar las sedes" description={branches.message} onRetry={branches.reload} />}
        <p className="text-sm md:col-span-2">No asociar una sede no significa aceptar cualquier sede. Podrás configurar tus preferencias después. La institución confirma si el servicio admite lista de espera.</p>
        <Button type="submit" disabled={busy || !serviceId}><Plus size={18} aria-hidden="true" />{busy ? 'Procesando…' : 'Ingresar a lista de espera'}</Button>
      </fieldset>
    </form>)}
  </section>;
}
