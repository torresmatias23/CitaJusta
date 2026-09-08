import { ShieldCheck, Sparkles } from 'lucide-react';
import { Badge } from '../../components/ui/badge';
import { HomeWidgets } from './home-widgets';
import { SearchForm } from './search-form';

export function HomePage() {
  return (
    <div className="page-container home-page">
      <div className="preview-notice"><Badge tone="purple">Vista de demostración</Badge><span>Datos de ejemplo · sin sesión real</span></div>
      <section className="home-hero" aria-labelledby="home-title">
        <div className="hero-intro">
          <div className="hero-copy">
            <h1 id="home-title">Encuentra tu <span>próxima hora</span></h1>
            <p>CitaJusta conecta a las personas con instituciones, empresas y profesionales que gestionan atenciones mediante citas.</p>
          </div>
          <img src="/images/home-hero.png" className="hero-illustration" alt="" width="1536" height="1024" fetchPriority="high" />
        </div>
        <SearchForm />
        <p className="hero-footnote"><span><Sparkles size={18} aria-hidden="true" /></span>Tu próxima cita, <strong>más cerca de ti.</strong></p>
      </section>
      <HomeWidgets />
      <aside className="privacy-note" aria-label="Privacidad de la demostración">
        <ShieldCheck size={35} aria-hidden="true" />
        <div><h2>Tu información importa</h2><p>Esta vista utiliza datos ficticios. No ingreses información personal ni sensible en la demostración.</p></div>
        <span className="privacy-label">Sin conexión a tu cuenta</span>
      </aside>
    </div>
  );
}
