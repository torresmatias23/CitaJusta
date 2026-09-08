import { Link, Route, Routes } from 'react-router';
import { AppLayout } from '../app/app-layout';
import { AsyncState } from '../components/ui/async-state';
import { HomePage } from '../features/home/home-page';

export function AppRoutes() {
  return (
    <Routes>
      <Route element={<AppLayout preview />}>
        <Route index element={<HomePage />} />
      </Route>
      <Route element={<AppLayout />}>
        <Route path="*" element={
          <section className="page-container py-16 text-center">
            <AsyncState kind="empty" title="Esta página no está disponible" description="Por ahora puedes explorar la vista previa de Inicio." />
            <Link to="/" className="button button-outline mt-6">Volver al inicio</Link>
          </section>
        } />
      </Route>
    </Routes>
  );
}
