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

## RNF-024 — Límites de consultas públicas de disponibilidad

Aplican a ambos GET bajo `/api/v1`:

- `/branches/:branchId/services/:serviceId/availability`
- `/branches/:branchId/services/:serviceId/professionals/:professionalId/availability`

El rango `from`/`to` requiere timestamps con zona y `from < to`. Se admite como
máximo **31 × 24 horas reales (744 horas)**, calculadas entre instantes UTC después
de interpretar sus offsets. Una diferencia mayor, incluso de un milisegundo,
devuelve **400** antes de las consultas de contexto/cupos. También se comprueba
al entrar al servicio para impedir que una llamada interna omita la validación.
El rango solicitado se valida antes de recortar la parte pasada.

Las búsquedas Web de 7/14/30 días siguen siendo compatibles, al igual que fechas
específicas de 23/24/25 horas por horario de verano. Treinta y un días civiles
que sumen 745 horas por un cambio de offset exceden el máximo: se evalúan instantes,
no meses ni etiquetas del calendario.

El techo inicial es **5.000 candidatos** tras los filtros SQL existentes, con
`take: 5001` para detectar exceso. Al recibir el candidato 5.001 se devuelve
**400**, sin `data` parcial, con el mensaje:
`Availability query too broad. Reduce the date range or select a professional.`
Reducir el rango o consultar por profesional permite acotar la búsqueda.

Este límite se comprueba **antes de los filtros defensivos en memoria**. Con
hasta 5.000 candidatos se evalúan todos y se devuelven todos los válidos, incluso
si están después de registros descartados. Con más candidatos se rechaza toda
la consulta: puede ocurrir aunque el número final de cupos válidos fuese menor
por datos incoherentes. No se continúa leyendo páginas ilimitadas ni se devuelve
un listado truncado que aparente ser completo. No hay paginación en este contrato.

Ambos valores son decisiones operativas ajustables en
`src/availability/availability-query.limits.ts`, no umbrales académicos aprobados.
El techo limita filas materializadas; no garantiza un coste máximo de escaneo,
latencia o capacidad bajo carga. Medir rendimiento y revisar índices/umbral
requiere evidencia adicional.

El DTO `{ data: [...] }` y el orden `startsAt ASC, id ASC` se conservan para
consultas normales. No cambia el aislamiento por institución/sede/servicio/
profesional ni la política compartida `availability.policy.ts`. Las lecturas no
materializan cupos ni modifican estado o `lockVersion`. Las consultas administrativas
Desktop y las reglas de reservas/cancelación/reasignación quedan fuera del cambio.

Validación desde la raíz:

```powershell
npm run build -w @citajusta/api
node --test apps/api/test/availability.catalog.test.mjs
npm run e2e:docker -w @citajusta/api -- check
npm run e2e:docker -w @citajusta/api -- test checkpoint
```

El checkpoint verifica límites por HTTP/PostgreSQL en ambas rutas, orden con
empates, ausencia de escrituras de las consultas y limpieza de su fixture de
capacidad. Sólo se ejecuta contra `citajusta_e2e` verificada por el runner.
