# CitaJusta API

Backend NestJS del monorepo; conserva las reglas de negocio, autorización y
transacciones PostgreSQL. Preparación general: [SETUP](../../docs/development/SETUP.md).

## RNF-009 — Limitación de creación de reservas

Sólo `POST /api/v1/appointments` admite inicialmente **10 solicitudes cada 60 segundos
por usuario autenticado**. Es una cuota operativa ajustable en
`src/appointments/booking-rate-limit.policy.ts`, no un valor académico aprobado.
Revisarla con evidencia de carga y uso legítimo; no sustituye controles de red.
Las políticas de autenticación existentes permanecen intactas: registro y login
tienen ventanas más restrictivas por origen, según `auth-rate-limit.policy.ts`.
Las cuotas de autenticación y reserva usan identidades distintas y no se comparan
sólo por el número de solicitudes.

El guard de clase `AccessTokenGuard` valida token, usuario ACTIVE y sesión vigente
antes del guard de método `BookingRateLimitGuard`. La identidad proviene únicamente
de `AuthenticatedPrincipal.userId`; otra sesión, IP, body o contexto institucional
no reinicia ni selecciona la cuota. Se cuentan los intentos autenticados que llegan
al guard, incluidos los que luego terminan en 400/404/409/500. Fallos del parser
HTTP anteriores a los guards no consumen esta cuota. GET `/appointments/me`,
cancelación, confirmación y exportación al calendario no usan este limitador.

Al superar la cuota: **429**, mensaje genérico,
`Retry-After` (segundos enteros restantes, mínimo 1) y `Cache-Control: no-store`.
La reserva no se ejecuta: no modifica citas, cupos, historiales ni notificaciones.
El intento rechazado actualiza sólo su contador acotado. No se alteran
`Appointment.agendaSlotId UNIQUE`, `AgendaSlot.lockVersion` ni sus transacciones.

Reutiliza `AccountRecoveryLimit` (`limites_recuperacion_cuenta`) y la misma operación
SQL atómica de autenticación, extraída a `src/common/postgres-rate-limit.ts`.
PostgreSQL decide admisión y tiempo con `INSERT ... ON CONFLICT DO UPDATE`;
no hay locks ni contadores en memoria. La ventana empieza con el primer intento;
los rechazos no prolongan su expiración y el contador se satura en 11. Una ventana
fija admite ráfagas cerca del límite temporal; no es una ventana deslizante.

La columna histórica `email_hmac` almacena sólo HMAC del usuario con subclave y
dominio exclusivos de reservas, separados de autenticación y recuperación. No se
persisten UUID, correos, IP ni tokens en texto claro en los contadores. Las instancias
deben compartir base, `JWT_ACCESS_SECRET` y política; rotar el secreto reinicia las
cuotas derivadas. Reutiliza la limpieza acotada de ventanas vencidas ya existente,
incluso con correo/recuperación deshabilitados; no agrega tareas periódicas.

Un error reconocido de Prisma devuelve **503**; un fallo inesperado, **500**
sanitizado. Nunca se admite una reserva sin contabilizar por un fallo de almacenamiento
ni se presenta ese fallo como 429. Los logs no incluyen la excepción original,
identificadores, cuerpos ni secretos. Persisten riesgos de volumen distribuido,
contención/indisponibilidad PostgreSQL y crecimiento superior a la limpieza.

## Validación enfocada

Desde la raíz:

```powershell
npm run build -w @citajusta/api
node --test --test-isolation=none apps/api/test/booking-rate-limit.test.mjs apps/api/test/booking-rate-limit.http.test.mjs
```

Las pruebas HTTP usan Nest y guards reales con persistencia simulada; no prueban
atomicidad PostgreSQL. Para comprobar cuota y concurrencia entre dos clientes reales,
reinicio de ventana y separación de contadores, la suite protegida `auth-rate-limit`
incluye los escenarios de reservas. La suite `appointments` verifica también 429
sin efectos de dominio y mantiene las regresiones de reserva/consulta/cancelación.
Su fixture reinicia sólo los contadores HMAC de sus cuentas propias entre escenarios
independientes y comprueba su limpieza final; nunca deshabilita el guard.

```powershell
npm run e2e:docker -w @citajusta/api -- check
npm run e2e:docker -w @citajusta/api -- test auth-rate-limit
npm run e2e:docker -w @citajusta/api -- test appointments
```

Exigen identidad Docker E2E verificada (`citajusta_e2e`), migraciones compatibles y
las protecciones existentes. No usan `.env` de DEV ni preparan automáticamente la
base. Si Docker no está disponible, registrar E2E como pendiente/SKIP, nunca PASS.
