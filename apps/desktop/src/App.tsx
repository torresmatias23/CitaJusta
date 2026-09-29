import { useState } from "react";
import "./App.css";
import { useAuth } from "./auth/auth-provider";
import { LoginScreen } from "./auth/login-screen";
import { CatalogPage } from "./catalog/catalog-page";
import { ProfessionalPage } from "./professionals/professional-page";
import { AgendaSection } from "./agenda/agenda-section";
import { AttendancePage } from "./attendance/attendance-page";

import { InstitutionalNavigation } from './components/institutional-navigation';
import type { ModuleName } from './components/institutional-navigation';
import { InstitutionalHome } from './components/institutional-home';
import { Brand } from './components/brand';

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
  const [selected, setSelected] = useState<ModuleName>("Inicio");
  return (
    <div className="app-shell">
      <a className="skip-link" href="#content">Ir al contenido</a>
      <header className="app-header">
        <div className="header-brand"><Brand /><p className="subtitle">Gestión institucional</p></div>
        <span className="status">Desktop institucional</span>
        <div className="session-details">
          <strong>{auth.user?.firstName} {auth.user?.lastName}</strong>
          <details className="context-details"><summary>Contexto y cuenta</summary>
          <div><span>{auth.user?.email}</span>
          <span>Institución: {auth.user?.context.institutionId ?? 'Sin contexto institucional'}</span>
          <span>Sede: {auth.user?.context.branchId ?? 'Sin sede asignada'}</span>
          <span>Roles: {auth.user?.roles.join(', ') || 'Sin roles asignados'}</span>
          </div></details>
          <button type="button" onClick={() => { void auth.logout(); }}>Cerrar sesión</button>
        </div>
      </header>
      <div className="workspace">
        <InstitutionalNavigation selected={selected} onSelect={setSelected} />
        <main id="content" tabIndex={-1}>
          <p className="eyebrow">Gestión institucional</p>
          <h1>{selected}</h1>
          {selected === 'Sedes y servicios' ? <CatalogPage /> : selected === 'Profesionales' ? <ProfessionalPage /> : selected === 'Agenda' ? <AgendaSection /> : selected === 'Asistencia' ? <AttendancePage /> : selected === 'Inicio' ? <InstitutionalHome firstName={auth.user?.firstName} hasContext={Boolean(auth.user?.context.institutionId)} onSelect={setSelected} /> : <section className="welcome-card" aria-labelledby="welcome-title">
            <span className="stage">En preparación</span>
            <h2 id="welcome-title">Un espacio para la gestión de tu institución</h2>
            <p>Los módulos institucionales se incorporarán progresivamente.
              Sedes, servicios y profesionales permiten administrar el catálogo con los permisos de tu contexto.
              Agenda permite consultar citas institucionales en modo de sólo lectura.
              Asistencia permite registrar resultados con autorización institucional.
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
