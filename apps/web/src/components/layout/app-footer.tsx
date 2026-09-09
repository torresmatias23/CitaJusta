import { Brand } from './brand';

export function AppFooter() {
  return (
    <footer className="app-footer">
      <div className="page-container footer-grid">
        <div><Brand compact /><p className="mt-3 max-w-xs">Una forma más simple de encontrar y organizar tus citas.</p></div>
        <div><h2>Para personas usuarias</h2><a href="/#buscar-horas">Buscar una hora</a><a href="/#como-funciona">Cómo funciona</a><span>Lista de espera · próximamente</span></div>
        <div><h2>CitaJusta</h2><p>Busca atenciones, reserva tu hora y consulta tus citas desde tu cuenta.</p></div>
      </div>
    </footer>
  );
}
