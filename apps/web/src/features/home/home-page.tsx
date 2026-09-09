import { ShieldCheck, Sparkles } from 'lucide-react';
import { useAuth } from '../auth/auth-provider';
import { HomeWidgets } from './home-widgets';
import { SearchForm } from './search-form';

export function HomePage() {
  const { user } = useAuth();
  return (
    <div className="page-container home-page">
      <section className="home-hero" aria-labelledby="home-title">
        <div className="hero-intro">
          <div className="hero-copy">
            <h1 id="home-title">Encuentra tu <span>próxima hora</span></h1>
            <p>CitaJusta conecta a las personas con instituciones, empresas y profesionales que gestionan atenciones mediante citas.</p>
          </div>
          <img src="/images/home-hero.png" className="hero-illustration" alt="" width="1536" height="1024" fetchPriority="high" />
        </div>
        <SearchForm key={user?.id ?? 'anonymous'} />
        <p className="hero-footnote"><span><Sparkles size={18} aria-hidden="true" /></span>Tu próxima cita, <strong>más cerca de ti.</strong></p>
      </section>
      <HomeWidgets />
      <aside className="privacy-note" aria-label="Tu cuenta">
        <ShieldCheck size={35} aria-hidden="true" />
        <div><h2>Tus citas, en tu cuenta</h2><p>Inicia sesión para consultar tus reservas. Si compartes este dispositivo, recuerda cerrar sesión al terminar.</p></div>
      </aside>
    </div>
  );
}
