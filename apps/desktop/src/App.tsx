import { useState } from "react";
import "./App.css";

const modules = ["Inicio", "Sedes y servicios", "Profesionales", "Agenda",
  "Asistencia", "Reasignaciones", "Reportes", "Auditoría"] as const;

function App() {
  const [selected, setSelected] = useState<typeof modules[number]>("Inicio");
  return (
    <div className="app-shell">
      <a className="skip-link" href="#content">Ir al contenido</a>
      <header className="app-header">
        <div><p className="brand">CitaJusta</p><p className="subtitle">Gestión institucional</p></div>
        <span className="status">Desktop institucional</span>
      </header>
      <div className="workspace">
        <nav className="sidebar" aria-label="Módulos institucionales">
          <p className="eyebrow">Espacio institucional</p>
          <ul>{modules.map((module) => (
            <li key={module}>
              <button type="button" aria-pressed={selected === module} onClick={() => setSelected(module)}>{module}</button>
            </li>
          ))}</ul>
          <p className="nav-note">Navegación preliminar · sin operaciones habilitadas</p>
        </nav>
        <main id="content" tabIndex={-1}>
          <p className="eyebrow">Fundación HU-027</p>
          <h1>{selected}</h1>
          <section className="welcome-card" aria-labelledby="welcome-title">
            <span className="stage">En preparación</span>
            <h2 id="welcome-title">Un espacio para la gestión de tu institución</h2>
            <p>Los módulos institucionales se incorporarán progresivamente.
              Esta versión establece la base de la aplicación de escritorio;
              todavía no permite iniciar sesión ni realizar operaciones.</p>
            <p className="architecture-note">CitaJusta Desktop consumirá la misma API que Web.
              Las reglas de negocio y el control de acceso permanecerán en el backend.</p>
          </section>
        </main>
      </div>
    </div>
  );
}

export default App;
