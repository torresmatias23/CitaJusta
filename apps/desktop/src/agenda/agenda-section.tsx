import { useState } from 'react';
import { AgendaPage } from './agenda-page';
import { AvailabilityPage } from '../availability/availability-page';

export function AgendaSection() {
  const [section, setSection] = useState<'appointments' | 'availability'>('appointments');
  return <>
    <nav className="catalog-actions agenda-tabs" aria-label="Secciones de Agenda">
      <button aria-pressed={section === 'appointments'} onClick={() => setSection('appointments')}>Consulta de citas</button>
      <button aria-pressed={section === 'availability'} onClick={() => setSection('availability')}>Disponibilidad y bloqueos</button>
    </nav>
    {section === 'appointments' ? <AgendaPage /> : <AvailabilityPage />}
  </>;
}
