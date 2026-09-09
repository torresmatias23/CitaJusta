import { Navigate, Outlet, useLocation } from 'react-router';
import { AsyncState } from '../../components/ui/async-state';
import { Button } from '../../components/ui/button';
import { useAuth } from './auth-provider';

export function ProtectedRoute() {
  const { status, error, retrySession, logout } = useAuth();
  const location = useLocation();
  if (status === 'loading') return <AsyncState kind="loading" title="Verificando tu sesión" />;
  if (status === 'error') return <section className="auth-page"><AsyncState kind="error" title="No pudimos verificar tu sesión" description={error ?? 'Revisa tu conexión y vuelve a intentar.'} onRetry={() => { void retrySession(); }} /><Button variant="outline" onClick={() => { void logout(); }}>Volver a iniciar sesión</Button></section>;
  if (status !== 'authenticated') return <Navigate to="/login" replace state={{ returnTo: `${location.pathname}${location.search}${location.hash}` }} />;
  return <Outlet />;
}
