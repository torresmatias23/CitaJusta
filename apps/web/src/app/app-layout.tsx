import { Outlet } from 'react-router';
import { AppFooter } from '../components/layout/app-footer';
import { AppHeader } from '../components/layout/app-header';
import { homePreview } from '../features/home/home-preview';

// Composición visual del shell autenticado. No representa una sesión ni un guard.
export function AppLayout({ preview = false }: { preview?: boolean }) {
  return (
    <div className="flex min-h-screen flex-col">
      <a href="#main-content" className="skip-link">Saltar al contenido</a>
      <AppHeader {...(preview ? { profile: homePreview.profile } : {})} />
      <main id="main-content" tabIndex={-1} className="flex-1">
        <Outlet />
      </main>
      <AppFooter />
    </div>
  );
}
