export const navigation = [
  { label: 'Espacio institucional', items: ['Inicio'] },
  { label: 'Catálogo', items: ['Sedes y servicios', 'Profesionales'] },
  { label: 'Operación', items: ['Agenda', 'Asistencia', 'Reasignaciones'] },
  { label: 'Análisis', items: ['Reportes', 'Auditoría'] },
] as const;
export type ModuleName = typeof navigation[number]['items'][number] | 'Instituciones';

export function InstitutionalNavigation({ selected, onSelect, canRequestInstitutions = false }: { selected: ModuleName; onSelect: (module: ModuleName) => void; canRequestInstitutions?: boolean }) {
  return <nav className="sidebar" aria-label="Módulos institucionales">
    {canRequestInstitutions && <div className="nav-group"><p className="eyebrow">Administración general</p><ul><li>
      <button type="button" aria-pressed={selected === 'Instituciones'} onClick={() => onSelect('Instituciones')}>Instituciones</button>
    </li></ul></div>}
    {navigation.map(group => <div className="nav-group" key={group.label}>
      <p className="eyebrow">{group.label}</p>
      <ul>{group.items.map(module => <li key={module}>
        <button type="button" aria-pressed={selected === module} onClick={() => onSelect(module)}>
          <span>{module}</span>
        </button>
      </li>)}</ul>
    </div>)}
    <p className="nav-note">Acceso según los permisos de tu contexto institucional.</p>
  </nav>;
}
