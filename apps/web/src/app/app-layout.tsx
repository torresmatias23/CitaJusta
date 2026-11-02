import { Outlet } from 'react-router';
import { AppFooter } from '../components/layout/app-footer';
import { AppHeader } from '../components/layout/app-header';
import { NotificationsProvider } from '../features/notifications/notifications-provider';
import { PrivacyProvider } from '../features/privacy/privacy-provider';
import { PrivacyBanner } from '../features/privacy/privacy-page';

export function AppLayout() {
  return (
    <PrivacyProvider><NotificationsProvider><div className="flex min-h-screen flex-col">
      <a href="#main-content" className="skip-link">Saltar al contenido</a>
      <AppHeader />
      <PrivacyBanner />
      <main id="main-content" tabIndex={-1} className="flex-1">
        <Outlet />
      </main>
      <AppFooter />
    </div></NotificationsProvider></PrivacyProvider>
  );
}
