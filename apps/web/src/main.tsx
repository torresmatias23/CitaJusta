import '@fontsource-variable/inter';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/app';
import { AsyncState } from './components/ui/async-state';
import { readApiBaseUrl } from './lib/env';
import './styles/index.css';

const container = document.getElementById('root');
if (!container) throw new Error('No se encontró el contenedor de la aplicación.');
const root = createRoot(container);

try {
  readApiBaseUrl(import.meta.env['VITE_API_BASE_URL']);
  root.render(<StrictMode><App /></StrictMode>);
} catch {
  root.render(
    <main className="page-container py-16">
      <AsyncState kind="error" title="No podemos iniciar la aplicación" description="Revisa la configuración pública de la URL de la API." />
    </main>,
  );
}
