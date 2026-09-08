import { Building2, CalendarDays, ChevronDown, Search, BriefcaseBusiness } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useState } from 'react';
import { Button } from '../../components/ui/button';
import { homePreview } from './home-preview';

function SearchField({ name, label, placeholder, options, icon: Icon }: {
  name: string;
  label: string;
  placeholder: string;
  options: readonly string[];
  icon: LucideIcon;
}) {
  return (
    <div className="search-field">
      <Icon className="search-field-icon" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <label htmlFor={name}>{label}</label>
        <div className="select-wrapper">
          <select id={name} name={name} defaultValue="" required aria-describedby="search-preview-note">
            <option value="" disabled>{placeholder}</option>
            {options.map((option) => <option key={option} value={option}>{option}</option>)}
          </select>
          <ChevronDown size={17} aria-hidden="true" />
        </div>
      </div>
    </div>
  );
}

export function SearchForm() {
  const [submitted, setSubmitted] = useState(false);
  return (
    <div>
      <form id="buscar-horas" className="search-form" aria-label="Buscar horas, demostración" onSubmit={(event) => {
        event.preventDefault();
        setSubmitted(true);
      }} onChange={() => setSubmitted(false)}>
        <SearchField name="service" label="Servicio o atención" placeholder="Ej: Asesoría general" options={homePreview.services} icon={BriefcaseBusiness} />
        <SearchField name="branch" label="Sede o sucursal" placeholder="Ej: Sucursal Centro" options={homePreview.branches} icon={Building2} />
        <SearchField name="preference" label="Fecha o preferencia" placeholder="Ej: Próximos 7 días" options={homePreview.preferences} icon={CalendarDays} />
        <Button type="submit" className="search-submit"><Search size={23} aria-hidden="true" />Buscar horas</Button>
      </form>
      <p id="search-preview-note" className="search-note" role="status">
        {submitted ? 'Búsqueda de demostración: la conexión con disponibilidad se incorporará en la próxima iteración. No se ha consultado ni reservado una hora.' : 'Buscador de demostración · opciones de ejemplo, sin consulta al backend.'}
      </p>
    </div>
  );
}
