# Web: fundación visual

CitaJusta es un sistema genérico de gestión de citas para instituciones, empresas y profesionales. El Home utiliza ejemplos transversales de servicios y sucursales, sin limitar el producto a un sector.

React + Vite + TypeScript estricto; Tailwind mediante su plugin Vite, React Router declarativo, Lucide e Inter autoalojada. Sin shadcn/ui por ahora: bastan controles HTML nativos y componentes pequeños. TypeScript se mantiene alineado con la versión del backend.

## Ejecución

Desde la raíz, después de `npm ci`:

```powershell
npm run --workspace @citajusta/web dev
npm run --workspace @citajusta/web typecheck
npm run --workspace @citajusta/web test
npm run --workspace @citajusta/web build
```

Desarrollo: `http://127.0.0.1:5173`. No requiere PostgreSQL ni sesión. No hay un linter/formatter configurado; los archivos respetan `.editorconfig` y se comprueban con `git diff --check`.

## Alcance y rutas

- `/`: shell visual autenticado y Home de demostración. **No existe autenticación frontend ni protección de sesión todavía.**
- `*`: estado de página no disponible con layout público y regreso a Inicio.
- Buscar/resultados, reserva/confirmación y Mis citas/cancelación se integrarán posteriormente; no se registran rutas ficticias.
- Lista de espera, notificaciones y ofertas no están implementadas. `SINHORAS` y `CONHORAS` son futuros estados de Inicio, nunca rutas independientes.

El formulario valida selecciones localmente y muestra un aviso; no consulta ni reserva. Navegación y acciones futuras están deshabilitadas. Perfil, catálogos y tarjetas usan únicamente `src/features/home/home-preview.ts`, sin IDs del backend ni lógica de dominio. Se muestra `Agendada`, no una confirmación funcional inexistente.

## Organización

```text
src/app/          # raíz y composición de layouts
src/components/   # header/footer, marca, controles y estados
src/features/home/# Home, buscador, tarjetas y datos sintéticos
src/lib/          # configuración pública y cliente HTTP
src/routes/       # rutas existentes; punto de extensión
src/styles/       # tokens y diseño responsive
test/             # node:test: configuración, HTTP y renderizado real
```

Inter, navy/teal, bordes suaves y tarjetas pastel provienen de los nueve bocetos adjuntos. `HOME` es la referencia principal; se conservan los patrones de header/footer, filtros, badges y tarjetas de las demás vistas sin implementarlas. La cuadrícula pasa de cuatro a dos y una columna; el buscador se apila y el menú se colapsa. La ilustración decorativa se oculta en móvil. No se publican métricas, contactos, notificaciones ni garantías de seguridad ficticias del boceto.

## API y entorno

`VITE_API_BASE_URL` es pública, default `/api/v1`; admite ese prefijo relativo o una URL HTTP(S) terminada en `/api/v1`, sin credenciales, query ni fragmento. Configuración inválida bloquea el arranque con un aviso genérico. Nunca colocar secretos en `VITE_*`.

`.env.example` incluye `API_PROXY_TARGET` para el proxy **sólo de desarrollo**. Para conectar posteriormente, el propietario puede copiarlo a un `.env.local` no versionado o configurar las variables en su terminal. Esta iteración no crea ningún `.env` real ni necesita el proxy para mostrar Home. En producción se deberá configurar un reverse proxy para `/api/v1` o una URL explícita con CORS permitido; Vite no provee ese proxy en producción.

`src/lib/api.ts` es el punto central futuro. El cliente devuelve `unknown` para exigir validación por feature; sólo acepta paths relativos controlados, permite JSON y `AbortSignal`, obtiene el Bearer mediante callback y no almacena tokens. No hace refresh, reintentos automáticos ni sigue redirecciones. Omite cookies; la estrategia de sesión web se definirá al conectar Auth. Los errores HTTP no propagan cuerpos internos del servidor. El Home no importa ni llama este cliente.

## Evidencia visual

`public/images/logo-citajusta.png`: logo oficial provisto por el proyecto, utilizado sin modificaciones en header y footer. `Brand` mantiene texto alternativo y enlace accesible a Inicio. CSS encuadra los márgenes transparentes del original 2000×2000 sin deformar ni cortar el dibujo; si se reemplaza el recurso, revisar ese encuadre.

`public/images/home-hero.png`: ilustración decorativa generada con ImageGen integrado (no CLI), transparente y guardada en el workspace. Se conserva porque sus elementos visibles (persona, teléfono, calendario, reloj y planta) son genéricos. El prompt histórico se mantiene como trazabilidad del recurso, no como definición del alcance del producto:

> Use case: stylized-concept. Asset type: decorative illustration for a medical appointment web dashboard, displayed on the right of a pale icy-blue hero. Create a friendly editorial flat illustration of a young adult woman with long wavy navy hair, warm medium skin and a teal sweater, looking at a smartphone held naturally in her hands. Beside her is a large upright spiral desk calendar with simple blank square cells and one teal checkmark; a small round clock and a potted plant with soft blue leaves complete the scene. Wide landscape composition, all subjects fully contained, generous clean margins, no text or letters, no numbers, no logo, no watermark. Soft polished vector-like raster illustration, subtle shading, calm healthcare mood, navy #172b50, teal #009b9d and pale powder blues. Transparent background, with only a very pale blue organic shape behind the objects. No UI, no buttons, no page mockup.

Pendiente: revisión visual/interactiva en navegador a 1440, 768 y 375 px (incluyendo teclado/zoom), y optimización del PNG antes de publicación. Los tests de renderizado no sustituyen esta revisión.
