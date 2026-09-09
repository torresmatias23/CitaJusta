import { BrowserRouter } from 'react-router';
import { AuthProvider } from '../features/auth/auth-provider';
import { AppRoutes } from '../routes/app-routes';

export function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  );
}