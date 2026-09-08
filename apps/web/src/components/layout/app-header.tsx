import { Bell, ChevronDown, Menu, X } from 'lucide-react';
import { useState } from 'react';
import { NavLink } from 'react-router';
import { Brand } from './brand';

export function AppHeader({ profile }: { profile?: { name: string; initials: string } }) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <header className="app-header">
      <div className="page-container header-inner">
        <Brand />
        {profile && <>
          <button type="button" className="menu-toggle" aria-label={menuOpen ? 'Cerrar menú' : 'Abrir menú'} aria-expanded={menuOpen} aria-controls="main-navigation" onClick={() => setMenuOpen(!menuOpen)}>
            {menuOpen ? <X aria-hidden="true" /> : <Menu aria-hidden="true" />}
          </button>
          <nav id="main-navigation" aria-label="Navegación principal" className={`main-navigation ${menuOpen ? 'is-open' : ''}`} onKeyDown={(event) => {
            if (event.key === 'Escape') {
              setMenuOpen(false);
              document.querySelector<HTMLButtonElement>('.menu-toggle')?.focus();
            }
          }}>
            <NavLink to="/" end onClick={() => setMenuOpen(false)}>Inicio</NavLink>
            <button type="button" disabled title="Mis citas: próxima iteración">Mis citas</button>
            <button type="button" disabled title="Lista de espera: próximamente">Lista de espera</button>
            <button type="button" disabled title="Notificaciones: próximamente"><Bell size={21} aria-hidden="true" /> Notificaciones</button>
            <div className="preview-profile" aria-label={`${profile.name}, perfil de ejemplo`}>
              <span className="avatar" aria-hidden="true">{profile.initials}</span>
              <span>{profile.name}<small>Perfil de ejemplo</small></span>
              <ChevronDown size={16} aria-hidden="true" />
            </div>
          </nav>
        </>}
      </div>
    </header>
  );
}
