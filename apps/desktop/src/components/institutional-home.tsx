import type { ModuleName } from './institutional-navigation';

const shortcuts = [
  { title: 'Sedes y servicios', description: 'Administra el catálogo y selecciona tu contexto institucional.' },
  { title: 'Profesionales', description: 'Consulta y gestiona los profesionales vinculados a tu institución.' },
  { title: 'Agenda', description: 'Consulta citas, disponibilidades y bloqueos según tus permisos.' },
  { title: 'Asistencia', description: 'Consulta citas y registra los resultados de atención autorizados.' },
] as const;

export function InstitutionalHome({ firstName, hasContext, onSelect }: {
  firstName?: string; hasContext: boolean; onSelect: (module: ModuleName) => void;
}) {
  return <>
    <section className="home-welcome">
      <div className="home-decoration" aria-hidden="true"><span /><span /><span /></div>
      <p className="eyebrow">Tu espacio de trabajo</p>
      <h2>{firstName ? `Te damos la bienvenida, ${firstName}` : 'Te damos la bienvenida'}</h2>
      <p>Organiza la atención de tu institución desde un mismo lugar.</p>
      <p className="context-summary">{hasContext ? 'Contexto institucional seleccionado. Cada módulo verifica tus permisos.' : 'Selecciona tu contexto en Sedes y servicios para comenzar.'}</p>
    </section>
    <section aria-labelledby="shortcuts-title">
      <h2 id="shortcuts-title">Accesos directos</h2>
      <div className="shortcut-grid">{shortcuts.map(item => <button className="shortcut" type="button" key={item.title} onClick={() => onSelect(item.title)}>
        <strong>{item.title}</strong><span>{item.description}</span><span className="shortcut-link">Abrir módulo →</span>
      </button>)}</div>
    </section>
    <p className="architecture-note">La API conserva la autoridad sobre permisos y reglas de negocio. No se muestran indicadores sin datos reales.</p>
  </>;
}
