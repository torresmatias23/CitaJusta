import { Link, Route, Routes } from 'react-router';
import { AppLayout } from '../app/app-layout';
import { AsyncState } from '../components/ui/async-state';
import { AppointmentConfirmationPage } from '../features/appointments/appointment-confirmation-page';
import { AppointmentsPage } from '../features/appointments/appointments-page';
import { LoginPage } from '../features/auth/login-page';
import { ProtectedRoute } from '../features/auth/protected-route';
import { RegisterPage } from '../features/auth/register-page';
import { ResultsPage } from '../features/availability/results-page';
import { HomePage } from '../features/home/home-page';
import { WaitlistPage } from '../features/waitlist/waitlist-page';
import { OffersPage } from '../features/offers/offers-page';

export function AppRoutes() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route index element={<HomePage />} />

        <Route path="login" element={<LoginPage />} />
        <Route path="registro" element={<RegisterPage />} />

        <Route element={<ProtectedRoute />}>
          <Route path="resultados" element={<ResultsPage />} />
          <Route path="mis-citas" element={<AppointmentsPage />} />
          <Route path="lista-de-espera" element={<WaitlistPage />} />
          <Route path="ofertas" element={<OffersPage />} />
          <Route
            path="citas/:appointmentId/confirmacion"
            element={<AppointmentConfirmationPage />}
          />
        </Route>

        <Route
          path="*"
          element={
            <section className="page-container py-16 text-center">
              <AsyncState
                kind="empty"
                title="Esta página no está disponible"
                description="Puedes volver al inicio para continuar."
              />
              <Link to="/" className="button button-outline mt-6">
                Volver al inicio
              </Link>
            </section>
          }
        />
      </Route>
    </Routes>
  );
}
