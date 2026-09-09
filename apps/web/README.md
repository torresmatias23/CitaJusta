# Web: integración con la API

CitaJusta es un sistema genérico de gestión de citas para instituciones, empresas y profesionales. El frontend utiliza la sesión y los datos de la API.

React + Vite + TypeScript estricto; Tailwind mediante su plugin Vite, React Router declarativo, Lucide e Inter autoalojada. Sin shadcn/ui por ahora: bastan controles HTML nativos y componentes pequeños. TypeScript se mantiene alineado con la versión del backend.

## Ejecución

Desde la raíz, después de `npm ci`:

```powershell
npm run --workspace @citajusta/web dev
npm run --workspace @citajusta/web typecheck
npm run --workspace @citajusta/web test
npm run --workspace @citajusta/web build
```

Desarrollo: `http://127.0.0.1:5173`. El Home público no requiere sesión; los flujos autenticados requieren la API y PostgreSQL. No hay un linter/formatter configurado; los archivos respetan `.editorconfig` y se comprueban con `git diff --check`.

## Alcance y rutas

- `/`: Home público con acceso a Login/Registro. Sin sesión no consulta catálogos protegidos; con sesión carga instituciones → sedes → servicios.
- `/login` y `/registro`: autenticación y creación de cuenta.
- `/resultados`: disponibilidad y reserva de horas.
- `/mis-citas`: listado de reservas propias y diálogo de cancelación.
- `/citas/:appointmentId/confirmacion`: comprobante y estado actual de la reserva.
- `*`: estado de página no disponible con layout público y regreso a Inicio.
- Resultados, Mis citas y confirmación requieren sesión.
- Lista de espera, notificaciones y ofertas no están implementadas. Las funciones futuras se indican como “Próximamente”.

El header muestra el usuario real y permite cerrar sesión. El Home no contiene reservas, perfiles ni notificaciones ficticias: ofrece acceso a Mis citas e información de las funciones disponibles. La API decide disponibilidad, reservas y transiciones de estado.

## Organización

```text
src/app/          # raíz y composición de layouts
src/components/   # header/footer, marca, controles y estados
src/features/home/# Home, buscador y tarjetas informativas
src/features/auth/# sesión, Login/Registro y protección de rutas
src/features/availability/ # catálogos, selección y resultados
src/features/appointments/ # reserva, comprobante, Mis citas y cancelación
src/lib/          # configuración pública y cliente HTTP
src/routes/       # rutas existentes; punto de extensión
src/styles/       # tokens y diseño responsive
test/             # node:test: configuración, HTTP y renderizado real
```

Inter, navy/teal, bordes suaves y tarjetas pastel forman el diseño compartido por Home, autenticación y citas. La cuadrícula pasa de cuatro a dos y una columna; el buscador se apila y el menú se colapsa. La ilustración decorativa se oculta en móvil.

## API y entorno

`VITE_API_BASE_URL` es pública, default `/api/v1`; admite ese prefijo relativo o una URL HTTP(S) terminada en `/api/v1`, sin credenciales, query ni fragmento. Configuración inválida bloquea el arranque con un aviso genérico. Nunca colocar secretos en `VITE_*`.

`.env.example` incluye `API_PROXY_TARGET` para el proxy **sólo de desarrollo**. Puede configurarse en un `.env.local` no versionado o en la terminal. En producción se debe configurar un reverse proxy para `/api/v1` o una URL explícita con CORS permitido; Vite no provee ese proxy en producción.

`AuthProvider` proporciona el cliente autenticado a las features. El cliente HTTP devuelve `unknown` para exigir validación por feature; acepta paths relativos controlados, JSON y `AbortSignal`, y obtiene el Bearer mediante callback. La sesión administra los tokens y su renovación. Los errores HTTP no propagan cuerpos internos del servidor.

Los contratos contra NestJS/PostgreSQL se comprueban con `node --test apps/web/test/e2e/web-api.e2e.test.mjs` desde la raíz, con la API compilada y el entorno local preparado. Estos E2E no son pruebas de interacción en navegador.

## Evidencia visual

`public/images/logo-citajusta.png`: logo oficial provisto por el proyecto, utilizado sin modificaciones en header y footer. `Brand` mantiene texto alternativo y enlace accesible a Inicio. CSS encuadra los márgenes transparentes del original 2000×2000 sin deformar ni cortar el dibujo; si se reemplaza el recurso, revisar ese encuadre.

`public/images/home-hero.png`: ilustración decorativa generada con ImageGen integrado (no CLI), transparente y guardada en el workspace. Se conserva porque sus elementos visibles (persona, teléfono, calendario, reloj y planta) son genéricos. El prompt histórico se mantiene como trazabilidad del recurso, no como definición del alcance del producto:

> Use case: stylized-concept. Asset type: decorative illustration for a medical appointment web dashboard, displayed on the right of a pale icy-blue hero. Create a friendly editorial flat illustration of a young adult woman with long wavy navy hair, warm medium skin and a teal sweater, looking at a smartphone held naturally in her hands. Beside her is a large upright spiral desk calendar with simple blank square cells and one teal checkmark; a small round clock and a potted plant with soft blue leaves complete the scene. Wide landscape composition, all subjects fully contained, generous clean margins, no text or letters, no numbers, no logo, no watermark. Soft polished vector-like raster illustration, subtle shading, calm healthcare mood, navy #172b50, teal #009b9d and pale powder blues. Transparent background, with only a very pale blue organic shape behind the objects. No UI, no buttons, no page mockup.

Pendiente: revisión visual/interactiva en navegador a 1440, 768 y 375 px (incluyendo teclado/zoom), y optimización del PNG antes de publicación. Los tests de renderizado no sustituyen esta revisión.
