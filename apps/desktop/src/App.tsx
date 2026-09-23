import { useState } from "react";
import "./App.css";
import { useAuth } from "./auth/auth-provider";
import { LoginScreen } from "./auth/login-screen";
import { CatalogPage } from "./catalog/catalog-page";

const modules = ["Inicio", "Sedes y servicios", "Profesionales", "Agenda",
  "Asistencia", "Reasignaciones", "Reportes", "Auditoría"] as const;

function App() {
  const auth = useAuth();
  if (auth.status === 'anonymous') return <LoginScreen />;
  if (auth.status === 'loading') return <main><p role="status">Verificando sesión…</p></main>;
  if (auth.status === 'error') return <main>
    <h1>CitaJusta</h1><p role="alert">{auth.error}</p>
    <button type="button" onClick={() => { void auth.retrySession(); }}>Reintentar conexión</button>
    <button type="button" onClick={() => { void auth.logout(); }}>Volver al inicio de sesión</button>
  </main>;
  return <InstitutionalShell />;
}

function InstitutionalShell() {
  const auth = useAuth();
  const [selected, setSelected] = useState<typeof modules[number]>("Inicio");
  return (
    <div className="app-shell">
      <a className="skip-link" href="#content">Ir al contenido</a>
      <header className="app-header">
        <div><p className="brand">CitaJusta</p><p className="subtitle">Gestión institucional</p></div>
        <span className="status">Desktop institucional</span>
        <div className="session-details">
          <strong>{auth.user?.firstName} {auth.user?.lastName}</strong>
          <span>{auth.user?.email}</span>
          <span>Institución: {auth.user?.context.institutionId ?? 'Sin contexto institucional'}</span>
          <span>Sede: {auth.user?.context.branchId ?? 'Sin sede asignada'}</span>
          <span>Roles: {auth.user?.roles.join(', ') || 'Sin roles asignados'}</span>
          <button type="button" onClick={() => { void auth.logout(); }}>Cerrar sesión</button>
        </div>
      </header>
      <div className="workspace">
        <nav className="sidebar" aria-label="Módulos institucionales">
          <p className="eyebrow">Espacio institucional</p>
          <ul>{modules.map((module) => (
            <li key={module}>
              <button type="button" aria-pressed={selected === module} onClick={() => setSelected(module)}>{module}</button>
            </li>
          ))}</ul>
          <p className="nav-note">Sedes y servicios disponibles según tus permisos.</p>
        </nav>
        <main id="content" tabIndex={-1}>
          <p className="eyebrow">Gestión institucional</p>
          <h1>{selected}</h1>
          {selected === 'Sedes y servicios' ? <CatalogPage /> : <section className="welcome-card" aria-labelledby="welcome-title">
            <span className="stage">En preparación</span>
            <h2 id="welcome-title">Un espacio para la gestión de tu institución</h2>
            <p>Los módulos institucionales se incorporarán progresivamente.
              Sedes y servicios permite administrar el catálogo con los permisos de tu contexto.
              Las demás secciones siguen en preparación.</p>
            <p className="architecture-note">CitaJusta Desktop consume la misma API que Web.
              Las reglas de negocio y el control de acceso permanecerán en el backend.</p>
          </section>}
        </main>
      </div>
    </div>
  );
}

export default App;
