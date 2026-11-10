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

## RNF-008 — CORS explícito por ambiente

`CORS_ORIGINS` es una lista de orígenes HTTP(S) exactos, separados por comas.
Por defecto está vacía en **development, test y production**: no autoriza lecturas
cross-origin. El proxy del mismo origen `/api/v1`, las peticiones sin Origin y
el transporte nativo Desktop no necesitan una concesión CORS.

Ejemplos de configuración explícita (no se copian automáticamente):

```dotenv
# Desarrollo con Web en otro origen; localhost y 127.0.0.1 son distintos.
CORS_ORIGINS=http://127.0.0.1:5173,http://localhost:5173
# Despliegue público: sustituir por el origen HTTPS real, sin ruta ni slash final.
# CORS_ORIGINS=https://web.example.test
```

En Docker Compose, `DOCKER_CORS_ORIGINS` de `docker/.env` alimenta `CORS_ORIGINS`
de la API. Vacío mantiene el flujo de mismo origen Web/Nginx sin ampliar accesos.
No se cambia ningún `.env` real ni se agrega localhost por detectar un ambiente.
No reiniciar DEMO automáticamente para aplicar estas variables.

Zod rechaza comodines, orígenes opacos (`null`, `file:`, `tauri:`), credenciales,
rutas (incluido `/` final), query, fragmento, separadores vacíos y URLs inválidas.
Los orígenes deben estar en formato canónico: protocolo/host en minúsculas,
puertos no predeterminados explícitos y sin `:80`/`:443` redundantes. Se permiten
espacios alrededor de cada elemento y se eliminan duplicados. Los errores de
configuración no imprimen los valores recibidos.

La API devuelve `Access-Control-Allow-Origin` únicamente para el origen exacto
permitido, con `Vary: Origin`; nunca `*`. Usa `credentials: false` y no devuelve
`Access-Control-Allow-Credentials`. Métodos permitidos: GET, POST, PUT y PATCH.
Encabezados: Accept, Authorization, Content-Type, X-Institution-Id, X-Branch-Id y
X-Requested-With. Expone Retry-After para que el cliente pueda leer los límites.
OPTIONS devuelve 204 sin pasar por guards/cuotas. Un preflight no autorizado puede
responder 204, pero sin ACAO (o sin el método/encabezado solicitado): el navegador
no lo autoriza. No es una respuesta de autorización del dominio.

CORS se registra después de las cabeceras base y antes del parser; respuestas
normales, JSON malformado, 400/401/404/429/500 mantienen su política. Un origen
rechazado no recibe ACAO; la solicitud puede seguir siendo atendida por el servidor.
CORS **no sustituye JWT, sesión, RBAC, tenant, controles contra IDOR ni rate limiting**.

Google Calendar conserva su validación independiente de Origin y X-Requested-With:
autorizar un origen en CORS no autoriza el intercambio Calendar. Al usar otro origen
Web deben configurarse ambos controles explícitamente. Desktop con plugin-http no
depende de CORS; no se modifica su CSP ni se autoriza automáticamente su esquema.

## RNF-010 — Cabeceras y protección contra framing

API y Nginx añaden `X-Frame-Options: DENY` y
`Content-Security-Policy: frame-ancestors 'none'`. Se conservan nosniff,
`Referrer-Policy: strict-origin-when-cross-origin`, ausencia de X-Powered-By y
Cache-Control no-store para `/api/v1`. Health y recursos públicos conservan su
política de caché previa; el index/SPA de Nginx usa no-cache.

La CSP sólo impide que otros sitios enmarquen CitaJusta. No agrega default-src,
script-src, connect-src, frame-src ni políticas COOP/COEP que pudieran afectar
Google Identity Services, Calendar o mapas. No es una CSP integral contra XSS.
El handler HTML final de Express, fuera de las rutas API, conserva su propia CSP
`default-src 'none'`; allí X-Frame-Options DENY sigue impidiendo el framing.

Nginx oculta las copias upstream de las cabeceras que administra (incluidas CSP y
X-Frame-Options) y emite una sola copia con `add_header ... always` a nivel server,
sin redefinir add_header en locations. Conserva ACAO/Vary/Retry-After de la API;
no replica su lógica CORS. Cubre proxy, health, index, SPA, assets y errores propios.
Los errores generados por Nginx antes de llegar a Nest no tienen necesariamente
cabeceras CORS y un navegador cross-origin puede no leer su detalle.

No se habilita HSTS sobre HTTP local. Un despliegue público necesita HTTPS real,
certificados, redirección y una política HSTS revisada en su terminador TLS.
Estos controles no acreditan certificación, cumplimiento legal ni cierre de una
evaluación dedicada de seguridad.

Validación enfocada desde la raíz:

```powershell
npm run build -w @citajusta/api
node --test --test-isolation=none apps/api/test/environment.validation.test.mjs apps/api/test/http-security.test.mjs apps/api/test/cors-security.http.test.mjs docker/test/configuration.test.mjs
```

Prueba Nginx opcional, sin bases ni cambios en contenedores existentes:

```powershell
$env:CITAJUSTA_NGINX_TEST = '1'
# Una imagen Nginx ya almacenada; no descarga imágenes.
$env:CITAJUSTA_NGINX_TEST_IMAGE = 'citajusta-capstone-web:latest'
node --test docker/test/http-security.runtime.test.mjs
```

Usa el config real con un upstream simulado dentro de un contenedor temporal,
puerto publicado sólo en loopback y archivos públicos ficticios. Comprueba sintaxis
Nginx, errores 200/400/401/404/429/500, errores propios 413, cabeceras sin duplicados,
SPA/assets/health y elimina sólo su contenedor y directorio temporal. No sustituye
pruebas de navegador reales con Google/mapas ni del terminador HTTPS de producción.
