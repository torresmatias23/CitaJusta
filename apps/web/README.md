# Web: integración con la API

CitaJusta es un sistema genérico de gestión de citas para instituciones, empresas y profesionales. El frontend utiliza la sesión y los datos de la API.

React + Vite + TypeScript estricto; Tailwind mediante su plugin Vite, React Router declarativo, Lucide e Inter autoalojada. Sin shadcn/ui por ahora: bastan controles HTML nativos y componentes pequeños. TypeScript se mantiene alineado con la versión del backend.

## Ejecución

Desde la raíz, después de `npm ci`:

Preparar API/PostgreSQL según [SETUP.md](../../docs/development/SETUP.md). Copiar `apps/web/.env.example` a `apps/web/.env` sólo si no existe, configurar el proxy y reiniciar Vite. Los `.env` no se versionan.

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
- `/lista-de-espera`: requiere sesión; listado propio, alta por servicio/sede opcional, preferencias completas y retiro confirmado. Contratos reales de HU-007/HU-008 sin identidad ni institución enviadas por el cliente.
- `/ofertas`: requiere sesión; ofertas propias, vigencia, aceptación/rechazo y estados históricos con contratos reales de reasignación (HU-022).
- `/notificaciones`: centro protegido de notificaciones persistentes, paginado y con lectura individual.

HU-021 (Lista de espera/preferencias) y HU-022 (ofertas) están implementadas. `GET /api/v1/reassignments/offers/me` consulta hasta 100 ofertas propias, `createdAt DESC, id DESC`, sin contexto institucional del cliente. Muestra servicio, sede, nombre público del profesional, horario y estados `PENDING`, `ACCEPTED`, `REJECTED`, `EXPIRED`, `INVALIDATED`, `CANCELLED`. No consulta el GET administrativo de supervisión.

La vigencia usa `expiresAt` real, no un TTL Web: contador local cada segundo, sin polling. Una oferta `PENDING` cuyo plazo terminó muestra “Plazo vencido” y deshabilita respuestas, conservando el estado persistido. El reloj del dispositivo es orientativo; el backend decide si una respuesta es válida. Los horarios se muestran en la zona horaria del dispositivo, indicada en la página.

Aceptar/rechazar usa POST sin body, bloqueo de doble envío y `retryAfterRefresh: false`. Se consulta nuevamente la lista tras la respuesta, también ante resultado incierto; nunca se reenvía automáticamente la escritura. Aceptar confirma el horario real de la cita transferida; Mis citas vuelve a consultar `/appointments/me` al entrar. Rechazar descarta `nextOffer`, que puede pertenecer a otra persona. No hay datos simulados, generación de ofertas ni reglas de ranking en Web.

El header muestra el usuario real y permite cerrar sesión. El Home no contiene reservas, perfiles ni notificaciones ficticias: ofrece acceso a Mis citas e información de las funciones disponibles. La API decide disponibilidad, reservas y transiciones de estado.

## Organización

```text
src/app/          # raíz y composición de layouts
src/components/   # header/footer, marca, controles y estados
src/features/home/# Home, buscador y tarjetas informativas
src/features/auth/# sesión, Login/Registro y protección de rutas
src/features/availability/ # catálogos, selección y resultados
src/features/appointments/ # reserva, comprobante, Mis citas y cancelación
src/features/offers/ # consulta propia, vigencia visual y respuesta a ofertas
src/lib/          # configuración pública y cliente HTTP
src/routes/       # rutas existentes; punto de extensión
src/styles/       # tokens y diseño responsive
test/             # node:test: configuración, HTTP y renderizado real
```

Inter, navy/teal, bordes suaves y tarjetas pastel forman el diseño compartido por Home, autenticación y citas. La cuadrícula pasa de cuatro a dos y una columna; el buscador se apila y el menú se colapsa. La ilustración decorativa se oculta en móvil.

## API y entorno

`VITE_API_BASE_URL` es pública, default `/api/v1`; admite ese prefijo relativo o una URL HTTP(S) terminada en `/api/v1`, sin credenciales, query ni fragmento. Configuración inválida bloquea el arranque con un aviso genérico. Nunca colocar secretos en `VITE_*`.

`.env.example` incluye `API_PROXY_TARGET=http://localhost:3000` para el proxy **sólo de desarrollo**. Copiarla a `.env`; también puede configurarse en `.env.local` o terminal. Vite dev falla con un mensaje accionable si falta el target o contiene credenciales/ruta/query/fragmento. Build y preview no dependen ni usan ese proxy. En producción configurar reverse proxy para `/api/v1` o una URL explícita con CORS permitido.

Waitlist requiere `seed:dev` o catálogo institucional preparado y `bootstrap:waitlist` ejecutado después de crear la institución. Ante `503`, revisar `check:dev`, especialmente STANDARD institucional. Las escrituras Waitlist no se reenvían tras renovar la sesión; ante resultado incierto, recargar antes de repetir.

`AuthProvider` proporciona el cliente autenticado a las features. El cliente HTTP devuelve `unknown` para exigir validación por feature; acepta paths relativos controlados, JSON y `AbortSignal`, y obtiene el Bearer mediante callback. La sesión administra los tokens y su renovación. Los errores HTTP no propagan cuerpos internos del servidor.

Los contratos contra NestJS/PostgreSQL se comprueban con `node --test apps/web/test/e2e/web-api.e2e.test.mjs` desde la raíz, con la API compilada y el entorno local preparado. Estos E2E no son pruebas de interacción en navegador.

## Evidencia visual

`public/images/logo-citajusta.png`: logo oficial provisto por el proyecto, utilizado sin modificaciones en header y footer. `Brand` mantiene texto alternativo y enlace accesible a Inicio. CSS encuadra los márgenes transparentes del original 2000×2000 sin deformar ni cortar el dibujo; si se reemplaza el recurso, revisar ese encuadre.

`public/images/home-hero.png`: ilustración decorativa generada con ImageGen integrado (no CLI), transparente y guardada en el workspace. Se conserva porque sus elementos visibles (persona, teléfono, calendario, reloj y planta) son genéricos. El prompt histórico se mantiene como trazabilidad del recurso, no como definición del alcance del producto:

> Use case: stylized-concept. Asset type: decorative illustration for a medical appointment web dashboard, displayed on the right of a pale icy-blue hero. Create a friendly editorial flat illustration of a young adult woman with long wavy navy hair, warm medium skin and a teal sweater, looking at a smartphone held naturally in her hands. Beside her is a large upright spiral desk calendar with simple blank square cells and one teal checkmark; a small round clock and a potted plant with soft blue leaves complete the scene. Wide landscape composition, all subjects fully contained, generous clean margins, no text or letters, no numbers, no logo, no watermark. Soft polished vector-like raster illustration, subtle shading, calm healthcare mood, navy #172b50, teal #009b9d and pale powder blues. Transparent background, with only a very pale blue organic shape behind the objects. No UI, no buttons, no page mockup.

Pendiente: revisión visual/interactiva en navegador a 1440, 768 y 375 px (incluyendo teclado/zoom), y optimización del PNG antes de publicación. Los tests de renderizado no sustituyen esta revisión.

## HU-024: notificaciones internas

Header y página comparten contador y estado por identidad autenticada. Se consulta al iniciar/restaurar sesión, entrar al centro, recuperar foco y marcar una notificación como leída; no hay polling ni WebSocket. Al cerrar o invalidar sesión y cambiar de cuenta se descartan los datos y respuestas pendientes. El Home anónimo no consulta estos endpoints.

La página muestra contenido controlado e histórico, fecha, estado y enlaces a Mis citas, Lista de espera u Ofertas. Incluye carga, vacío, error/reintento y cargar más mediante cursor. El POST de lectura es idempotente y admite el reintento del cliente tras renovar sesión. Los tests de estado/contrato y renderizado no sustituyen una prueba de interacción en navegador.
