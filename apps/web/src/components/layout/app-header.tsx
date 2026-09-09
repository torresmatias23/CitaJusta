import { Bell, LogIn, LogOut, Menu, UserPlus, X } from 'lucide-react';
import { useState } from 'react';
import { NavLink } from 'react-router';
import { useAuth } from '../../features/auth/auth-provider';
import { Brand } from './brand';

export function AppHeader({
  profile: _profile,
}: {
  profile?: { name: string; initials: string };
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const { status, user, logout } = useAuth();

  const authenticated = status === 'authenticated' && user;

  const name = authenticated
    ? `${user.firstName} ${user.lastName}`.trim()
    : '';

  const initials = authenticated
    ? `${user.firstName?.[0] ?? ''}${user.lastName?.[0] ?? ''}`.toUpperCase()
    : '';

  async function handleLogout() {
    setMenuOpen(false);
    await logout();
  }

  return (
    <header className="app-header">
      <div className="page-container header-inner">
        <Brand />

        <button
          type="button"
          className="menu-toggle"
          aria-label={menuOpen ? 'Cerrar menú' : 'Abrir menú'}
          aria-expanded={menuOpen}
          aria-controls="main-navigation"
          onClick={() => setMenuOpen((current) => !current)}
        >
          {menuOpen ? <X aria-hidden="true" /> : <Menu aria-hidden="true" />}
        </button>

        <nav
          id="main-navigation"
          aria-label="Navegación principal"
          className={`main-navigation ${menuOpen ? 'is-open' : ''}`}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              setMenuOpen(false);
              document
                .querySelector<HTMLButtonElement>('.menu-toggle')
                ?.focus();
            }
          }}
        >
          <NavLink to="/" end onClick={() => setMenuOpen(false)}>
            Inicio
          </NavLink>

          {authenticated ? (
            <>
              <NavLink
                to="/mis-citas"
                onClick={() => setMenuOpen(false)}
              >
                Mis citas
              </NavLink>

              <button
                type="button"
                disabled
                title="Lista de espera: próximamente"
              >
                Lista de espera
              </button>

              <button
                type="button"
                disabled
                title="Notificaciones: próximamente"
              >
                <Bell size={20} aria-hidden="true" />
                Notificaciones
              </button>

              <div
                className="preview-profile"
                aria-label={`${name}, usuario autenticado`}
              >
                <span className="avatar" aria-hidden="true">
                  {initials}
                </span>

                <span>
                  {name}
                  <small>{user.email}</small>
                </span>
              </div>

              <button
                type="button"
                className="header-logout"
                onClick={() => {
                  void handleLogout();
                }}
              >
                <LogOut size={18} aria-hidden="true" />
                Cerrar sesión
              </button>
            </>
          ) : (
            <>
              <NavLink
                to="/login"
                onClick={() => setMenuOpen(false)}
              >
                <LogIn size={18} aria-hidden="true" />
                Iniciar sesión
              </NavLink>

              <NavLink
                to="/registro"
                onClick={() => setMenuOpen(false)}
                className="header-register"
              >
                <UserPlus size={18} aria-hidden="true" />
                Crear cuenta
              </NavLink>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}