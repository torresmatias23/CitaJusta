import { CalendarDays, Clock3, MapPin, Search } from 'lucide-react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { AsyncState } from '../../components/ui/async-state';
import { useResource } from '../../lib/use-resource';
import { useAuth } from '../auth/auth-provider';
import { BookingButton } from '../appointments/booking-button';
import { createAvailabilityApi, parseSearchQuery } from './availability-api';
import { createCatalogApi } from './catalog-api';

export function ResultsPage() {
  const { api, user } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const query = parseSearchQuery(params);
  const resource = useResource(query ? `${user?.id}:${params.toString()}` : null, async (signal) => {
    if (!query) throw new Error('Búsqueda inválida.');
    const catalogs = createCatalogApi(api);
    const [institutions, branches, services] = await Promise.all([catalogs.institutions(signal), catalogs.branches(query.institutionId, signal), catalogs.services(query.branchId, signal)]);
    const institution = institutions.find((item) => item.id === query.institutionId);
    const branch = branches.find((item) => item.id === query.branchId);
    const service = services.find((item) => item.id === query.serviceId && item.institution.id === query.institutionId);
    if (!institution || !branch || !service) throw new Error('Selección no disponible.');
    const slots = await createAvailabilityApi(api).find(query, signal);
    return { institution, branch, service, slots };
  });

  return (
    <section className="page-container route-page">
      <p className="breadcrumb"><Link to="/">Inicio</Link> / Resultados de búsqueda</p>
      <div className="page-heading"><h1>Horas para tu búsqueda</h1><Link className="button button-outline" to="/#buscar-horas">Editar búsqueda</Link></div>
      {!query ? <AsyncState kind="error" title="Revisa tu búsqueda" description="Selecciona institución, sede, servicio y un rango válido desde Inicio." /> : resource.status === 'loading' ? <AsyncState kind="loading" title="Buscando horas disponibles…" /> : resource.status === 'error' ? <AsyncState kind="error" title="No pudimos consultar la disponibilidad" description="La selección puede haber dejado de estar disponible. Reintenta o vuelve a buscar." onRetry={resource.reload} /> : <>
        <div className="search-summary"><span><Search size={17} aria-hidden="true" />{resource.data.service.name}</span><span><MapPin size={17} aria-hidden="true" />{resource.data.branch.name}</span><span>{resource.data.institution.name}</span><span>Hora local: {Intl.DateTimeFormat().resolvedOptions().timeZone}</span></div>
        {resource.data.slots.length === 0 ? <div className="content-panel empty-availability">
          <AsyncState kind="empty" title="No encontramos horas en este rango" description="Prueba otra sede, servicio o un rango de fechas más amplio." />
          <Link to="/#buscar-horas" className="button button-primary">Cambiar búsqueda</Link>
          <div className="coming-soon"><h2>Lista de espera</h2><p>¿No encontraste una hora? Ingresa a la lista de espera y configura tus preferencias de atención.</p><Link to="/lista-de-espera" className="button button-outline">Ir a lista de espera</Link>
</div>
        </div> : <ul className="results-list" aria-label="Horas disponibles">
          {resource.data.slots.map((slot) => <li className="result-card" key={slot.id}>
            <span className="avatar" aria-hidden="true">{slot.professional.firstNames.slice(0, 1)}{slot.professional.lastNames.slice(0, 1)}</span>
            <div className="result-professional"><h2>{slot.professional.firstNames} {slot.professional.lastNames}</h2>{slot.professional.titleOrFunction && <p>{slot.professional.titleOrFunction}</p>}<p className="text-brand">{resource.data.service.name}</p><p><MapPin size={14} aria-hidden="true" /> {resource.data.branch.name}</p></div>
            <div className="result-time"><p><CalendarDays size={17} aria-hidden="true" />{new Date(slot.startsAt).toLocaleDateString('es-CL', { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' })}</p><p><Clock3 size={17} aria-hidden="true" />{new Date(slot.startsAt).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })} – {new Date(slot.endsAt).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })}</p></div>
            <BookingButton agendaSlotId={slot.id} onBooked={(appointment) => navigate(`/citas/${appointment.id}/confirmacion`)} onConflict={resource.reload} />
          </li>)}
        </ul>}
      </>}
    </section>
  );
}
