import { Outlet } from 'react-router';
import { AppFooter } from '../components/layout/app-footer';
import { AppHeader } from '../components/layout/app-header';
import { NotificationsProvider } from '../features/notifications/notifications-provider';

export function AppLayout() {
  return (
    <NotificationsProvider><div className="flex min-h-screen flex-col">
      <a href="#main-content" className="skip-link">Saltar al contenido</a>
      <AppHeader />
      <main id="main-content" tabIndex={-1} className="flex-1">
        <Outlet />
      </main>
      <AppFooter />
    </div></NotificationsProvider>
  );
}
