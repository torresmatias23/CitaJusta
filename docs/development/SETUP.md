# Entorno y preparación local

## RF-016: confirmación anticipada de asistencia

Sin migraciones, nuevas tablas ni dependencias; Prisma 7.10.0. Reutiliza `confirmaciones`.
La reserva/comprobante no confirma asistencia. HU-017 registra posteriormente atención
efectiva/inasistencia; RF-016 no cambia estados, libera cupos ni inicia reasignaciones.

- `POST /api/v1/appointments/:appointmentId/confirm-attendance`: sesión válida, contexto
  coherente y cita propia; sin body funcional ni query. 200 devuelve
  `{ data: { appointmentId, confirmed: true, confirmedAt: ISO_UTC } }`.
- `GET /api/v1/appointments/me` conserva los campos previos y añade
  `attendanceConfirmation: { required, confirmed, confirmedAt: ISO_UTC|null, canConfirm }`.
  Históricos propios siguen visibles aunque catálogos se inactiven; no se habilitan acciones.
- Exige `Service.requiresConfirmation=true`, estado activo/no final con
  `allowsConfirmation=true`, inicio futuro y relaciones activas/coherentes del slot RESERVED.
  CANCELADA/ATENDIDA/INASISTENCIA nunca permiten confirmar. No hay otra ventana horaria.
- Errores: 400 input/contexto inválido según guards; 401 sesión/cuenta no válida;
  404 cita inexistente, eliminada, ajena o fuera del contexto seleccionado; 409 no elegible,
  inicio alcanzado o conflicto reconocido persistente; 503 infraestructura y 500 inesperado,
  con mensajes sanitizados. No recibe userId, actor, institución, canal ni fecha del cliente.
- Repetir mientras la cita siga elegible devuelve el primer positivo del período sin
  nueva fila/auditoría. Después de inicio/cierre/cambio de política, responde 409 y conserva
  el registro histórico. No se implementa respuesta negativa, penalización ni recordatorio.

### Preparación de catálogos — requiere autorización por entorno

El default Prisma de allowsConfirmation sigue siendo false. Antes de RF-016 el bootstrap
omitía ese campo para AGENDADA. Desde RF-016 sólo una AGENDADA **inexistente** se provisiona
con true; `skipDuplicates` conserva IDs, nombres y toda configuración ya registrada.
Reejecutar el bootstrap no habilita una AGENDADA histórica con false.

Para una instalación existente, el procedimiento propuesto (no ejecutado en DEV/DEMO) es:

1. Solicitar autorización explícita sobre el destino y la fila AGENDADA. Verificar identidad
   de PostgreSQL, guardar evidencia de ID/flags previos y revisar que esté activa/no final.
2. En una transacción administrativa controlada, cambiar exclusivamente allowsConfirmation
   de false a true mediante comparación del ID y valores revisados. Verificar una sola
   fila y conservar la evidencia; ante discrepancia, rollback y revisión, no reparación automática.
3. Habilitar requiresConfirmation sólo en los servicios que lo requieran, mediante la
   administración existente. No habilitar otros estados ni modificar citas/historiales.
4. Validar con una cita propia futura, su confirmación repetida y HU-017 por separado.

DEMO necesita además catálogo/agenda preparados mediante procedimientos autorizados;
este trabajo no ejecuta bootstrap/seed ni cambia datos allí. No presentar RF-016 como
habilitado si ambas políticas no están configuradas. Antes de ejecutar esa preparación,
pedir autorización; no sustituirla por actualizaciones automáticas al arrancar la API.

### Pruebas aisladas y Web

```powershell
npm run e2e:docker -w @citajusta/api -- check
npm run test:e2e:attendance-confirmation -w @citajusta/api
```

El fixture crea sólo sus propios catálogos habilitados, no cambia AGENDADA global.
Incluye concurrencia, rollback, A→B→A y compatibilidad HU-017; la suite reassignments
verifica además que una aceptación real no hereda la confirmación del titular anterior.
Cleanup por IDs/namespace con verificación de identidad; no se usan DEV/DEMO ni correos reales.
Mis citas muestra la acción según canConfirm, carga/error/éxito, bloqueo de doble envío
y refetch tras guardar. La respuesta tardía de un componente desmontado no se aplica.
Validación manual pendiente: móvil/teclado y persistencia visible con otra sesión real.

## RF-004: perfil y preferencias de correo

Prisma permanece en 7.10.0. La migración
`20261019000000_user_profile_notification_preferences` agrega sólo dos booleanos NOT NULL
con DEFAULT true en `usuarios`, preservando las trece migraciones históricas y los datos.
No crea tablas, enums ni índices. No aplicar a DEV/DEMO en este incremento; esas bases
requieren revisión y autorización aparte. No usar reset, `db push` ni seeds para migrar.

Procedimiento exclusivamente sobre `citajusta_e2e` verificado (Docker Linux disponible):

```powershell
npm run e2e:docker -w @citajusta/api -- check
# Comprueba identidad, historial/checksums y sólo la migración aditiva aprobada:
npm run e2e:docker -w @citajusta/api -- migrate
npm run test:e2e:profile-notifications -w @citajusta/api
# Regresión una vez, después de las pruebas específicas:
npm run e2e:docker -w @citajusta/api -- test all
```

No se carga `.env` API, no se heredan secretos externos y Resend se simula. Si falla la
identidad/aislamiento, detenerse: no sustituir la conexión por DEV/DEMO. La migración
pendiente autorizada está fijada por checksum exacto antes del commit; las trece previas
deben coincidir con HEAD. `check` no demuestra por sí solo ausencia de drift manual.

Contrato autenticado bajo `/api/v1` (query adicional rechazada en escrituras):

- `GET /users/me`: campos existentes más `phone: string|null` y
  `notificationPreferences: { appointmentEmailsEnabled, offerEmailsEnabled }`.
- `PATCH /users/me`: objeto parcial no vacío con `firstName`, `lastName` (trim, 1–120)
  y/o `phone` (trim, 1–30 o null para eliminar). Respuesta
  `{ data: { firstName, lastName, phone } }`.
- `PUT /users/me/notification-preferences`: exactamente los dos booleanos obligatorios;
  respuesta `{ data: { appointmentEmailsEnabled, offerEmailsEnabled } }`.

No admite email, RUT, password, identidad, roles/permisos, estado ni tenant. Principal y
contexto deben coincidir y la cuenta continuar ACTIVE/no eliminada. Errores: 400 formato,
401 sesión/usuario, 409 conflicto reconocido persistente, 503 almacenamiento indisponible,
500 error inesperado sanitizado. Auditoría sólo ante cambio efectivo, sin datos personales.

`appointmentEmailsEnabled` controla APPOINTMENT_BOOKED/CANCELLED;
`offerEmailsEnabled` controla OFFER_CREATED/ACCEPTED/REJECTED/EXPIRED. Ambos parten true.
WAITLIST_ENTERED/WITHDRAWN siguen sólo internos. Notification siempre persiste; una
categoría apagada genera tombstone `FAILED / EMAIL_PREFERENCE_DISABLED`. Desactivar
retira payload, claim y lease de entregas PENDING/PROCESSING propias de esa categoría;
SENT e historia permanecen. Reactivar habilita sólo eventos nuevos, nunca replay antiguo.
Recuperación de cuenta no se desactiva aquí. El worker revalida antes de HTTP, sin
transacción abierta durante la red; no puede cancelar retroactivamente un correo que
Resend ya aceptó o una llamada iniciada después de la última autorización efectiva.

Web `/cuenta` carga datos reales y separa guardado personal/preferencias con loading,
errores y bloqueo de doble envío. Teléfono vacío se envía como null; correo es readonly.
El nombre guardado refresca el perfil compartido sin restaurar la sesión ni forzar
rotación de refresh token. La vinculación Google conserva su comportamiento; no se
infiere un estado de vinculación no confirmado. Validación manual pendiente por entorno:
móvil/teclado, cambios de nombre en header/Home y enlace Google con configuración real.

## RF-003: recuperación segura de cuenta

Requiere la migración aditiva `20261018000000_account_recovery_foundation` (dos tablas,
sin cambios a las doce migraciones previas) y Prisma 7.10.0. En este incremento se aplica
exclusivamente sobre PostgreSQL E2E con identidad verificada. DEV/DEMO no se actualizan:
requieren revisión y autorización independientes; no ejecutar reset ni `db push`.

```powershell
npm run e2e:docker -w @citajusta/api -- check
# Sólo después de autorizar la migración E2E pendiente:
npm run e2e:docker -w @citajusta/api -- migrate
npm run test:e2e:account-recovery -w @citajusta/api
```

El runner mantiene checksums HEAD para migraciones previas; RF-004 fija el checksum exacto de
su nueva migración aprobada antes del commit. No admite SQL local arbitrario. Sus pruebas
generan claves efímeras, simulan Resend y limpian exclusivamente sus usuarios/filas propias.

Copiar las variables de `apps/api/.env.example` a la configuración privada del entorno,
sin publicar valores. RF-003 está deshabilitado por defecto (`ACCOUNT_RECOVERY_ENABLED=false`).
Para habilitarlo se exige `ACCOUNT_RECOVERY_WEB_ORIGIN` (origen Web exacto HTTPS;
HTTP sólo en loopback), `ACCOUNT_RECOVERY_KEY_ID` y dos claves independientes de 32 bytes
hexadecimales: `ACCOUNT_RECOVERY_ENCRYPTION_KEY` (AES-256-GCM) y
`ACCOUNT_RECOVERY_HMAC_KEY` (identificación de límites por email). Deben diferir entre sí
y de los secretos JWT. Generar cada una privadamente con un gestor de secretos o
`crypto.randomBytes(32)`; no pegarlas en issues, capturas ni historial compartido.
Además configurar `RESEND_API_KEY` y `RESEND_FROM` válidos. Variables sensibles sólo backend,
nunca `VITE_*`. Un componente habilitado con configuración incompleta falla al arrancar.

Políticas configurables, con valores iniciales:

| Variable | Default | Rango |
| --- | --- | --- |
| `ACCOUNT_RECOVERY_TTL_MINUTES` | 30 | 1–60 |
| `ACCOUNT_RECOVERY_WINDOW_MINUTES` | 60 | 1–1440 |
| `ACCOUNT_RECOVERY_MAX_REQUESTS` | 3 | 1–10 |
| `ACCOUNT_RECOVERY_MIN_INTERVAL_SECONDS` | 60 | 1–3600 |

`POST /api/v1/auth/forgot-password` recibe únicamente `{email}`: 202 con mensaje genérico
para cuentas existentes, inexistentes, inactivas, Google-only y solicitudes limitadas.
Errores de formato son 400; indisponibilidad operativa es 503 y fallos inesperados 500
sanitizados, nunca falsos éxitos. No se crea contraseña para Google-only ni identidades
técnicas. Una cuenta local vinculada a Google conserva su identidad externa y RBAC.
Cada solicitud admitida consume presupuesto persistente, incluso sin cuenta elegible.

El enlace apunta a `/restablecer-contrasena#token=...`, desde el origen configurado, no
desde Host/Origin del request. Web lo retira del historial visible y lo conserva sólo en
memoria: recargar puede requerir abrir de nuevo el correo. No guardar en storage ni
copiar enlaces reales en evidencia. El fragmento no viaja a Nginx/API ni por Referer.
`POST /api/v1/auth/reset-password` admite únicamente `{token,password}`; password de
12–128 caracteres, Argon2id vigente. Éxito 200; enlace inválido/vencido/consumido 400
genérico. No inicia sesión automáticamente. Revoca access y refresh anteriores y dirige
a `/login`; también Desktop deberá iniciar sesión nuevamente.

La entrega utiliza el ciclo de email existente: requiere `EMAIL_DELIVERY_ENABLED=true`
y `ACCOUNT_RECOVERY_ENABLED=true`.
Con recuperación habilitada y envío apagado, las solicitudes se encolan cifradas y pueden vencer; no se
promete entrega. El consumo siempre valida expiración en servidor. Se reutilizan timeout,
batch, lease y máximo de intentos `EMAIL_DELIVERY_*`. Resend recibe el mismo payload
congelado y clave de idempotencia estable por UUID. Timeout/respuesta incierta/429/5xx
admiten backoff exponencial acotado, sólo antes del vencimiento; errores definitivos o
intentos agotados eliminan el contenido cifrado. Un reinicio recupera leases vencidos.
El ciphertext se elimina también al enviar, consumir, invalidar o procesar expiración.
La limpieza se ejecuta separadamente al arrancar la API y en el único ciclo existente
(`EMAIL_DELIVERY_INTERVAL_MS`), aun con ambas banderas deshabilitadas y sin claves de
recuperación/proveedor. Cada pasada toma como máximo `EMAIL_DELIVERY_BATCH_SIZE`
recuperaciones vencidas y ese mismo máximo de límites vencidos cuyo cooldown terminó.
No borra filas de recuperación ni su hash/usuario/fechas de trazabilidad; tampoco envía
correos. La limpieza automática requiere que la API esté en ejecución.
Hashes/fechas/auditoría mínima permanecen para trazabilidad, no contienen el enlace.

Conservar la clave de cifrado entre reinicios. Esta versión admite un key ID activo:
no rotarlo con entregas pendientes sin plan de drenaje; un key ID desconocido o ciphertext
alterado falla cerrado y no envía. Rotar HMAC reinicia de hecho las identidades de los
límites, por lo que debe planificarse fuera de ventanas activas. No se acredita entrega real
hasta validar privadamente remitente/dominio Resend y configuración Web del entorno.
No hay garantía de entrega exactamente una vez ante fallos externos; un correo retrasado
puede contener un enlace ya inválido. El backend conserva uso único y vigencia.

## Administrador general de instituciones RF-005

Procedimiento manual para una cuenta ACTIVE previamente registrada y no eliminada. No se crean cuentas ni se cambian contraseñas. Requiere autorización explícita del propietario de la base y acceso administrativo al entorno; no se ejecuta automáticamente ni se invoca desde HTTP.

Este wrapper sólo acepta `NODE_ENV=development`, PostgreSQL 18 en loopback y base `citajusta_dev` o `citajusta_dev_<sufijo>`, según las protecciones existentes. Confirma el nombre real con una consulta antes de escribir. No admite `citajusta_docker`, E2E ni producción. Si desarrollo conserva la migración experimental retirada, **detenerse**: no usar este procedimiento para reconciliarla; revisar la decisión de reconciliación y preparar un destino limpio autorizado.

Después de comprobar el destino e historial compatible, configurar en una sesión PowerShell privada (valores reales sólo locales):

```powershell
$env:NODE_ENV = 'development'
# Configurar DATABASE_URL de la base local aprobada en esta sesión; no imprimirla.
$env:INSTITUTION_ADMIN_CONFIRM_DATABASE = '<nombre exacto de la base aprobada>'
$env:INSTITUTION_ADMIN_EMAIL = '<correo de la cuenta existente>'
$env:INSTITUTION_ADMIN_USER_ID = '<UUID verificado de esa misma cuenta>'
npm run provision:institution-admin -w @citajusta/api
```

El script exige DATABASE_URL y confirmación explícitas antes de abrir el cliente. El rol `INSTITUTION_PLATFORM_ADMINISTRATOR` es GLOBAL y contiene exactamente `institutions.read`, `institutions.create`, `institutions.update`; UserRole usa institutionId/branchId nulos. Reejecutar con configuración compatible no duplica filas, no cambia timestamps ni crea otro evento. Un registro incompatible se rechaza, no se repara ni reactiva. Una nueva asignación o reparación de enlaces ausentes se audita atómicamente como SYSTEM, referenciada por el UUID de la asignación mostrado en consola; puede verificarse mediante el mecanismo de auditoría con autorización independiente. No se imprimen credenciales.

Cerrar esa sesión PowerShell al terminar. Iniciar sesión nuevamente en Desktop y abrir **Administración general → Instituciones**. El listado administrativo devuelve capacidades verificadas; registro y edición requieren GLOBAL más su permiso específico. No se requiere seleccionar institución/sede para esta área. No asignar el rol a cuentas públicas automáticamente.

Validación automatizada aislada: `npm run e2e:docker -w @citajusta/api -- check` y después `npm run test:e2e:institutions -w @citajusta/api`. La suite verifica identidad Docker antes de crear fixtures y sólo limpia sus registros. No ejecutar este procedimiento de provisión sobre bases de uso normal como parte de las pruebas.

## Provisión administrativa Docker DEMO — TASK-199

Procedimiento **preparado, NO ejecutado** en esta tarea. Requiere revisión y autorización
independiente del propietario de DEMO. No constituye el cierre de TASK-199 ni acredita
la validación manual de RF-016. Prisma permanece en 7.10.0; sin nuevas migraciones.

### Destino y garantías

- Sólo Compose DEMO: `NODE_ENV=development`, `CITAJUSTA_DOCKER=development` y la URL exacta
  del proyecto hacia `db:5432/citajusta_docker`, usuario técnico `citajusta`, schema public.
- Preflight **sólo lectura** reutiliza `docker/api/migrate.mjs`: nombre/usuario reales,
  PostgreSQL 18, marcador `citajusta-capstone-docker-v1`, migraciones/checksums compatibles
  y cero pendientes. Nunca aplica migraciones. No certifica ausencia de todo drift manual.
- La transacción de provisión vuelve a comprobar identidad real en su propia conexión,
  usa Serializable, lock administrativo no bloqueante y un único reintento completo
  sólo ante conflictos transaccionales reconocidos. Espera/ejecución acotadas.
- UUID y correo deben identificar la misma cuenta ACTIVE/no eliminada. No crea cuentas,
  cambia passwords, asigna roles al registrarse ni altera grants ajenos. No registra
  correo, UUID de cuenta, URL, tokens ni detalles SQL en consola.
- Inserta sólo RBAC compatible faltante. Colisiones, roles con permisos adicionales,
  grants incompatibles/inactivos o instituciones no elegibles provocan rechazo, no reparación.
  Repetir una provisión completa compatible no cambia filas ni repite auditoría.
- Usa el evento existente `INSTITUTION_ADMINISTRATOR_PROVISIONED`, actor SYSTEM y recurso
  USER_ROLE, dentro de la misma transacción. El grant referenciado identifica el rol;
  la provisión institucional incluye institutionId, la general no. Si falla la auditoría,
  se revierte toda la provisión de esa ejecución.

`provision:institution-admin`, `seed:dev` y toolings Desktop siguen restringidos a DEV.
El runner E2E sigue admitiendo exclusivamente su base aislada; sus fixtures no preparan DEMO.
Este comando no carga `.env` API, no lanza procesos hijos ni se ejecuta al iniciar Docker/API.

### Ejecución manual posterior en Windows — NO EJECUTADA

Prerrequisitos: respaldo DEMO verificado, `db` DEMO ya healthy, esquema al día e identidades
de las cuentas aprobadas. No iniciar, migrar ni reparar una base como efecto de estos comandos.
Construir la imagen tooling con este cambio no escribe PostgreSQL:

```powershell
docker compose --env-file docker/.env --profile tools build migrate
```

En una sesión PowerShell privada, establecer parámetros de la cuenta administrativa
**expresamente designada**, no de un usuario público elegido automáticamente:

```powershell
$env:DEMO_ADMIN_EMAIL = '<correo de la cuenta ACTIVE aprobada>'
$env:DEMO_ADMIN_USER_ID = '<UUID verificado de esa misma cuenta>'
$env:DEMO_PROVISION_CONFIRM = "citajusta_docker:platform:$($env:DEMO_ADMIN_USER_ID)"
docker compose --env-file docker/.env --profile tools run --rm --no-deps -e DEMO_ADMIN_EMAIL -e DEMO_ADMIN_USER_ID -e DEMO_PROVISION_CONFIRM migrate npm run provision:docker-demo -w @citajusta/api -- platform
```

`platform` reutiliza `provisionInstitutionAdministrator()`: rol GLOBAL existente
`INSTITUTION_PLATFORM_ADMINISTRATOR`, exclusivamente institutions.read/create/update;
grant sin institución/sede. No concede poderes sobre los demás módulos.

Con sesión administrativa válida, crear la institución mediante `POST /api/v1/institutions`
sin headers de contexto institucional; conservar el UUID devuelto. No repetir altas por
nombre: Institution.name no es una clave única. Para habilitar al operador institucional,
autorizar por separado la cuenta (puede ser otra cuenta existente) y el UUID institucional:

```powershell
$env:DEMO_ADMIN_EMAIL = '<correo del operador ACTIVE aprobado>'
$env:DEMO_ADMIN_USER_ID = '<UUID verificado del operador>'
$env:DEMO_INSTITUTION_ID = '<UUID de la institución existente aprobada>'
$env:DEMO_PROVISION_CONFIRM = "citajusta_docker:institution:$($env:DEMO_ADMIN_USER_ID):$($env:DEMO_INSTITUTION_ID)"
docker compose --env-file docker/.env --profile tools run --rm --no-deps -e DEMO_ADMIN_EMAIL -e DEMO_ADMIN_USER_ID -e DEMO_INSTITUTION_ID -e DEMO_PROVISION_CONFIRM migrate npm run provision:docker-demo -w @citajusta/api -- institution
```

El servicio `migrate` se usa sólo como contenedor tooling: el comando explícito anterior
**sustituye** su CMD de migraciones. `--no-deps` evita iniciar dependencias. No pasar secretos
en argumentos, no imprimir el entorno expandido y cerrar la sesión privada al terminar.
No ejecutar el script directamente en Windows con credenciales DEV.

`institution` exige institución ACTIVE/no eliminada y crea/reutiliza el rol dedicado
`DEMO_INSTITUTION_SETUP_OPERATOR`, scope INSTITUTION, grant ligado al UUID confirmado y
branchId=null. Permisos exactos: branches.read/create, services.read/create,
professionals.read/create, availability.read/create. No incluye update/block, GLOBAL,
institutions.*, appointments.attendance, audit.* ni reassignments.*. Los otros roles del
operador se conservan; por tanto no es un procedimiento de reducción de privilegios previos.
Como los toolings Desktop, este rol técnico tiene una única pareja cuenta/institución
aprobada: rechaza grants propios para otros destinatarios antes de completar permisos.
Cambiar esa pareja requiere revisión independiente; no la sustituye ni amplía automáticamente.

### Escenario posterior mediante funcionalidades existentes

Conservar los UUID de todos los recursos creados; no adoptar recursos ajenos por nombre.
Usar Bearer privado y `x-institution-id` de la institución aprobada, sin x-branch-id:

1. Institución: nombre ficticio `Institución Demo CitaJusta`, zona `America/Santiago`,
   creada con el administrador general. No necesita datos legales/personales inventados.
2. `POST /api/v1/branches`: código propio y `Sede Centro Demo`, activa.
3. `POST /api/v1/services`: código propio, `Atención General Demo`, durationMinutes=30,
   active=true, requiresConfirmation=true, branchIds=[sede]. Para esta comprobación no
   se requiere Waitlist; allowsWaitlist=false evita añadir preparación de sus catálogos.
4. `POST /api/v1/professionals`: cuenta ACTIVE existente previamente aprobada, internalCode
   propio, branchIds=[sede], serviceIds=[servicio]. Si falta esa identidad, registrarla
   mediante Auth con credencial privada; el tooling no la crea ni le concede roles.
5. `POST /api/v1/availability`: branchId, serviceId, professionalId y startsAt/endsAt futuros
   ISO con offset, alineados a minuto; por ejemplo dos horas divisibles en 30 minutos,
   dentro de una fecha institucional y de la ventana visible de búsqueda Web. El servicio
   existente valida asociaciones/solapamientos y materializa los slots; no insertarlos
   con Prisma/SQL. Bloqueos/feriados pueden producir BLOCKED: verificar los AVAILABLE.
6. Reutilizar cupos futuros AVAILABLE compatibles. Si se consumieron o quedaron históricos,
   crear un intervalo futuro distinto; no revivir RESERVED/RELEASED ni citas canceladas.
7. Con una cuenta de usuario Web **sin nuevos roles administrativos**: iniciar sesión en
   `http://127.0.0.1:8080`, buscar, reservar y abrir Mis citas. Verificar servicio con
   requiresConfirmation=true y AGENDADA activa/no final con allowsConfirmation=true.
   Esta última configuración ya fue confirmada en DEMO; no modificarla ni reejecutar
   bootstrap para intentar sobrescribirla.
8. Confirmar asistencia, F5 y comprobar persistencia. La cita continúa AGENDADA y el cupo
   RESERVED; la confirmación no registra atención efectiva. No requiere Resend/Google.

Las altas de dominio y la reserva/confirmación son escrituras posteriores que también
requieren autorización. No se ejecutan en TASK-199 como parte de sus pruebas con mocks.
No resetear, borrar volúmenes, ejecutar db push ni usar fixtures E2E contra DEMO.

## Estado actual

Al 04-10-2026, el MVP Web permanece funcional y `apps/desktop` está implementado con Tauri 2 + React/Vite/TypeScript hasta HU-038. Sprint 7 está cerrado. Sprint 8 corresponde a integraciones externas HU-039 a HU-043; Docker/Compose, OpenAPI y hardening siguen pendientes para Sprint 9.

Actualización de alcance del 15-10-2026: HU-043 (WhatsApp Cloud API) fue descartada; no configurar ese proveedor. Si la base local aplicó `20261012193504_whatsapp_notifications_consent`, conserva objetos experimentales y una migración ausente del árbol limpio. Suspender migraciones/E2E en ella y seguir la [reconciliación pendiente de autorización](DECISIONS.md#retiro-hu-043-y-reconciliación-local-pendiente); no resetearla ni borrar historial. Una instalación nueva utiliza sólo las migraciones conservadas, sin WhatsApp.

| Componente | Versión verificada |
| --- | --- |
| Sistema operativo | Windows |
| Node.js | 24.11.0 |
| npm | 11.6.1 |
| Git | 2.49.0.windows.1 |
| Rust | 1.91.0 |
| Cargo | 1.91.0 |
| PostgreSQL (`psql`) | 18.0 |

`.nvmrc` contiene `24.11.0`. PostgreSQL está instalado, pero su directorio `bin` todavía no está agregado a `PATH`.

## Comprobación de versiones

Ejecutar desde PowerShell en la raíz del repositorio:

```powershell
Get-Content .nvmrc
node --version
npm --version
git --version
rustc --version
cargo --version
& 'C:\Program Files\PostgreSQL\18\bin\psql.exe' --version
```

La última ruta corresponde a la instalación actualmente verificada. `Get-Command psql -ErrorAction SilentlyContinue` no devuelve un comando mientras `psql` permanezca fuera de `PATH`.

El monorepo contiene API NestJS, Web React/Vite y Desktop Tauri 2 + React/Vite, con npm workspaces. Prisma permanece fijado en 7.10.0.

## Docker local para Capstone Fase 2

Alternativa aislada al entorno Windows descrito después. Requiere Docker Desktop con engine Linux (WSL 2) o Docker Engine, y Compose v2 reciente con `up --wait`. No necesita ejecutar Desktop Tauri en un contenedor ni instalar PostgreSQL en el host. No es una configuración de producción.

Estado de validación: Docker CLI/Desktop no está disponible en el entorno donde se incorporaron estos archivos. Pruebas unitarias de protección/configuración y builds locales no sustituyen build/arranque de imágenes, `nginx -t`, conectividad y persistencia reales; esas comprobaciones siguen pendientes.

### Configuración

Desde la raíz en PowerShell:

```powershell
docker --version
docker compose version
docker info
if (-not (Test-Path docker/.env)) { Copy-Item docker/.env.example docker/.env }
```

Completar **localmente** `DOCKER_DB_PASSWORD`, `DOCKER_JWT_ACCESS_SECRET` y `DOCKER_JWT_REFRESH_SECRET` con tres valores aleatorios diferentes, de 64 caracteres hexadecimales cada uno. Usar un generador criptográfico/gestor de contraseñas; no compartirlos en capturas, logs o Git. Las entradas vacías de la plantilla impiden iniciar Compose. `docker/.env` ya queda ignorado por la regla existente; no se crea ni copia automáticamente. No copiar credenciales de `apps/api/.env`.

`DOCKER_API_PORT=3000` y `DOCKER_WEB_PORT=8080` son puertos del host configurables; internamente API escucha 3000 y Nginx 8080. Se publican sólo en `127.0.0.1`. PostgreSQL **no publica puertos**, por lo que no compite con el PostgreSQL Windows en 5432. Si otra API ocupa 3000, cambiar `DOCKER_API_PORT` antes de iniciar. Desktop conserva su URL/capability actual `http://localhost:3000/api/v1`; usar ese puerto para probarlo, sin ampliar sus permisos aquí.

Compose construye `DATABASE_URL` únicamente hacia `db:5432/citajusta_docker`, usuario técnico `citajusta`; nunca hereda `DATABASE_URL` del host. `SHADOW_DATABASE_URL` es un destino ficticio no accesible en puerto 1: Prisma config exige la variable, pero `generate`, `validate` y `migrate deploy` no necesitan conectar una shadow DB. No utilizar `migrate dev` en este entorno.

La API usa `NODE_ENV=development` explícito para esta demostración, JWT propios y validación existente. Resend, Google Auth y Calendar quedan deshabilitados en API y build Web; no requiere credenciales externas. El runner de expiración conserva su default del backend, después de preparar el esquema. Habilitar integraciones posteriormente exige configurar tanto el backend como las opciones públicas de build Web y los orígenes autorizados reales; no colocar secretos en `VITE_*`.

### Construcción e inicialización explícita

```powershell
# Validar sin imprimir el modelo expandido, que contiene secretos:
docker compose --env-file docker/.env --profile tools config --quiet
docker compose --env-file docker/.env --profile tools build
docker compose --env-file docker/.env up -d --wait db
docker compose --env-file docker/.env exec -T db pg_isready -h 127.0.0.1 -U citajusta -d citajusta_docker
docker compose --env-file docker/.env exec -T db psql -U citajusta -d citajusta_docker -c "SELECT current_database(), current_user, shobj_description(oid, 'pg_database') AS marker FROM pg_database WHERE datname = current_database();"
```

Revisar que el destino es `citajusta_docker` y el marcador `citajusta-capstone-docker-v1`. El proyecto Compose `citajusta-capstone` crea red propia y volumen `citajusta-capstone_postgres_data`. No es un volumen externo ni un montaje de datos del host. Para PostgreSQL 18 se monta `/var/lib/postgresql`, conforme a la [imagen oficial](https://hub.docker.com/_/postgres). El único bind mount es el SQL de identificación, de sólo lectura: añade un comentario a la base nueva, no tablas ni datos de negocio. Sólo se ejecuta en el primer inicio de un volumen vacío.

En una preparación DEMO autorizada independientemente, aplicar **únicamente en esta instancia Docker verificada** las migraciones del corte aprobado. RF-003 sólo se aplicó en E2E: antes de actualizar una DEMO existente con esa nueva migración, detenerse y obtener autorización específica para estos comandos:

```powershell
docker compose --env-file docker/.env --profile tools run --rm migrate
docker compose --env-file docker/.env --profile tools run --rm --workdir /workspace/apps/api migrate node /workspace/node_modules/prisma/build/index.js migrate status
docker compose --env-file docker/.env up -d --wait api web
```

El helper exige modo development, URL exacta de Compose, contraseña URL-safe, identidad PostgreSQL 18 y marcador real de la base. Comprueba en una transacción `READ ONLY` que el esquema está vacío o tiene historial Prisma compatible con nombres/checksums locales y migraciones finalizadas. Rechaza bases ajenas, historial experimental/desconocido, migraciones fallidas o alteradas; no las repara. Sólo después ejecuta el Prisma instalado (`migrate deploy`), sin descargar otro CLI, y revalida el historial. No certifica ausencia de todo posible drift SQL manual.

No hay migraciones automáticas en `up`, ni en reinicios ni al iniciar NestJS. El entrypoint API hace la misma comprobación en **modo sólo lectura**, exige cero pendientes y ejecuta `node dist/main.js`; con esquema pendiente falla y pide la inicialización explícita. El servicio `migrate` tiene perfil `tools` y no se ejecuta con el arranque habitual. `citajusta_dev` y su migración experimental de WhatsApp quedan intactos. `.dockerignore` excluye también el directorio local vacío de esa migración retirada; no elimina ni modifica el original.

Bootstrap y seed permanecen separados de migraciones. No se crean instituciones, cuentas, contraseñas, roles ni agenda de negocio automáticamente. Si se necesitan estados de citas en esta base ya inicializada:

```powershell
docker compose --env-file docker/.env --profile tools run --rm migrate node apps/api/scripts/bootstrap-appointment-status.mjs
# Después de configurar instituciones reales mediante los flujos autorizados:
docker compose --env-file docker/.env --profile tools run --rm migrate node apps/api/scripts/bootstrap-waitlist.mjs
```

Estos comandos son explícitos e idempotentes; Waitlist sin instituciones sólo prepara estados, no inventa STANDARD global. `seed:dev`, `check:dev` y toolings Windows conservan sus restricciones de loopback/nombre de base: **no** se relajan para Docker ni se documentan como compatibles. Los fixtures E2E tampoco se reutilizan como seed ni se apuntan a `citajusta_dev`.

### Comprobación y operación

```powershell
docker compose --env-file docker/.env ps
Invoke-RestMethod http://localhost:3000/health
Invoke-RestMethod http://127.0.0.1:8080/health
curl.exe -I http://127.0.0.1:8080/
curl.exe -I http://127.0.0.1:8080/mis-citas
curl.exe -i http://127.0.0.1:8080/api/v1/users/me
docker compose --env-file docker/.env exec -T web nginx -t
docker compose --env-file docker/.env logs --tail=100 api web db
```

Con puertos distintos, adaptar las URLs. Esperado: ambos `/health` devuelven `{ "status": "ok" }`; HTML/SPA responde 200; `users/me` sin token devuelve **401 del backend**, no HTML. La ruta protegida `/mis-citas` sirve el shell y la autenticación se mantiene en React/API. La Web usa `/api/v1` del mismo origen mediante Nginx; preserva ruta, Authorization y Origin. No usa el proxy de Vite dev ni requiere CORS nuevo. `/health` sigue sin prefijo. El healthcheck HTTP es de vida del proceso; no sustituye las comprobaciones de DB/esquema del arranque.

API y Web esperan healthchecks reales con [`service_healthy`](https://docs.docker.com/compose/how-tos/startup-order/). La API ejecuta como `node`; Nginx como `nginx`, con archivos temporales en `/tmp`. Ambos tienen filesystem de sólo lectura, capacidades retiradas y `no-new-privileges`. El runtime API contiene dependencias productivas, salida ESM/Prisma compilada y `apps/api/assets/logo-citajusta.png` en la ruta relativa utilizada por Resend V2. No se incluyen `.env`, dependencias de Windows ni cliente generado en el host.

Prueba manual pendiente: registrar una cuenta controlada desde Web, comprobar acceso a los endpoints reales y volver a entrar después de detener/recrear contenedores con el mismo volumen. No registrar credenciales en evidencias. Para detener **conservando datos**:

```powershell
docker compose --env-file docker/.env stop
# O retirar sólo contenedores/red del proyecto, conservando el volumen:
docker compose --env-file docker/.env down
docker compose --env-file docker/.env up -d --wait
docker compose --env-file docker/.env --profile tools run --rm --workdir /workspace/apps/api migrate node /workspace/node_modules/prisma/build/index.js migrate status
```

Nunca añadir `-v`, borrar volúmenes, montar directorios de PostgreSQL Windows, usar `db push` o resetear. Si ya existía un volumen sin marcador/historial compatible, detenerse y revisarlo; no marcarlo manualmente ni hacerlo pasar por nuevo. Cambiar la contraseña en `.env` no cambia una contraseña ya inicializada en el volumen: restaurar la configuración local correcta o planificar una rotación explícita, sin borrar datos.

Problemas comunes: daemon apagado/engine Windows en lugar de Linux; variables vacías; puerto ocupado; schema pendiente; historial/checksum incompatible; contraseña del volumen distinta; descarga de imágenes/npm sin red. Para `502` de Nginx comprobar salud API; después de recrear sólo API reiniciar Web para renovar la resolución del upstream. No compartir salida de `docker compose config` sin `--quiet` ni `docker inspect`, porque pueden incluir secretos.

Validaciones locales sin Docker (dependencias del monorepo ya instaladas):

```powershell
node --test docker/test/*.test.mjs
npm run build -w @citajusta/api
npm run build -w @citajusta/web
npm run prisma:validate -w @citajusta/api
git diff --check
```

Las pruebas de `docker/test` usan filesystem/mocks de cliente y proceso: **no prueban PostgreSQL o Compose reales**. No ejecutar E2E destructivos sobre desarrollo. Limitaciones: sin TLS/despliegue productivo, secretos sólo en archivo local ignorado, usuario DB técnico con privilegios de inicialización de la imagen oficial, imágenes PG/Nginx sin digest fijado y hardening/escaneo de vulnerabilidades pendiente. Node/npm se fijan al entorno acordado (24.11.0/11.6.1); revisar actualizaciones de seguridad en una tarea autorizada. Esta entrega aporta configuración al requisito Docker de Capstone, no acredita despliegue ni cumplimiento final.


## PostgreSQL Docker exclusivo para E2E

Preparación incorporada el 17-10-2026, **pendiente de autorización para arrancar PostgreSQL, aplicar migraciones/bootstrap y ejecutar E2E con escrituras**. Docker CLI 29.8.2 y Compose v5.6.0 están disponibles; `config --quiet` pasó sin iniciar servicios (con advertencia de acceso restringido a la configuración Docker del usuario). Las validaciones estáticas/mocks no acreditan todavía conectividad, migraciones ni limpieza reales.

### Aislamiento y credenciales

`docker/e2e/compose.yaml` es independiente del Compose de demostración: proyecto `citajusta-e2e`, PostgreSQL 18, usuario/base `citajusta_e2e`, red propia y volumen persistente `citajusta-e2e_postgres_data` montado en `/var/lib/postgresql`. Publica **sólo `127.0.0.1:15432`** hacia el puerto interno 5432. No comparte el volumen `citajusta-capstone_postgres_data`, no usa `citajusta_dev`, `citajusta_shadow` ni `citajusta_docker`. No alterar el nombre del proyecto, puerto o volumen mediante overrides.

Desde la raíz, PowerShell:

```powershell
if (-not (Test-Path docker/e2e/.env)) { Copy-Item docker/e2e/.env.example docker/e2e/.env }
```

Completar localmente `E2E_DB_PASSWORD` con **64 caracteres hexadecimales aleatorios**, exclusivos para E2E. El archivo está ignorado; no copiar credenciales API/demo ni compartirlo en capturas. La plantilla no contiene una contraseña utilizable. El runner sólo lee esa clave de ese archivo, no hereda `DATABASE_URL`, `NODE_OPTIONS`, variables `PG*` ni credenciales de proveedores. Evitar overrides de `E2E_DB_PASSWORD` en la sesión de Compose. Cambiar el archivo después de inicializar el volumen no rota la contraseña: detenerse ante una discrepancia, no borrar el volumen.

### Procedimiento Windows (sólo después de autorización)

Los siguientes comandos **no forman parte de las validaciones sin base**. Iniciar únicamente el servicio dedicado:

```powershell
docker compose --project-name citajusta-e2e -f docker/e2e/compose.yaml --env-file docker/e2e/.env config --quiet
docker compose --project-name citajusta-e2e -f docker/e2e/compose.yaml --env-file docker/e2e/.env up -d --wait db
npm run e2e:docker -w @citajusta/api -- check
```

`check` sólo lee identidad e historial. Exige URL exacta `127.0.0.1:15432/citajusta_e2e?schema=public`, usuario E2E, `NODE_ENV=test`, PostgreSQL 18, puerto real del servidor 5432 y comentario **`citajusta-e2e-docker-v1`** obtenido mediante `shobj_description`. El comentario se crea exclusivamente al inicializar el volumen vacío. No marcar manualmente una base preexistente para eludir el guard. Un error de conexión, identidad o historial detiene la operación sin revelar la URL/contraseña.

Revisar el destino y las pendientes informadas antes de autorizar cada operación de escritura:

```powershell
# Sólo migrate deploy; nunca migrate dev, reset o db push:
npm run e2e:docker -w @citajusta/api -- migrate
npm run e2e:docker -w @citajusta/api -- check
# Estados de citas y Waitlist; sin instituciones, cuentas ni seed demo:
npm run e2e:docker -w @citajusta/api -- bootstrap
# Elegir una suite; los aliases históricos usan el mismo runner:
npm run test:e2e:checkpoint -w @citajusta/api
npm run test:e2e:appointments -w @citajusta/api
npm run test:e2e:waitlist -w @citajusta/api
# Todas las 22 suites backend (incluidos RF-005, RF-003, RF-004 y RF-016), secuencialmente:
npm run e2e:docker -w @citajusta/api -- test all
```

Suites disponibles: `attendance-confirmation`, `profile-notifications`, `account-recovery`, `institutions`, `checkpoint`, `agenda`, `reports`, `expiration`, `notifications`, `email-delivery`, `google`, `google-calendar`, `audit`, `attendance`, `catalog`, `professionals`, `availability-admin`, `appointments`, `waitlist`, `automatic-start`, `reassignments`, `reassignment-policy`.

### Protecciones y responsabilidades

- Antes de cualquier acción se verifica la identidad con consultas `READ ONLY`; el historial debe coincidir con nombres/checksums versionados, sin fallidas, revertidas, desconocidas ni huecos. Se rechaza un esquema no vacío sin historial. No es una certificación exhaustiva de ausencia de drift manual.
- `migrate` exige migraciones previas **versionadas y sin cambios respecto de HEAD**, con Prisma **7.10.0** instalado; RF-004 permite además únicamente los bytes de la nueva migración aprobada, fijados por checksum antes de commit. Se copian a un directorio temporal propio junto al lockfile; el schema original no cambia. Así se excluye el directorio local vacío de WhatsApp sin borrarlo. La configuración temporal referencia la URL del entorno, no escribe credenciales ni carga dotenv. No se descarga otro CLI.
- `bootstrap` reutiliza las funciones existentes de AppointmentStatus y Waitlist; prepara `AGENDADA`, `CANCELADA`, `ATENDIDA`, `INASISTENCIA`, `ACTIVE`, `WITHDRAWN`, `FULFILLED`. STANDARD sigue siendo institucional; los fixtures preparan sus propias instituciones/prioridades. No se ejecuta `seed:dev` ni se crean usuarios de desarrollo.
- `bootstrap` y `test` requieren cero migraciones pendientes; generan Prisma y compilan API. Los procesos trabajan en un directorio temporal sin `.env`, con JWT efímeros diferentes. El helper E2E ya no carga `apps/api/.env`. Cada proceso de tests repite preflight antes de iniciar Nest; un cambio posterior de URL/modo se rechaza. Se mantienen intactos `assertSafeLocalDatabaseUrl()` y `assertFixtureOwnership()`; el fixture checkpoint verifica además la identidad del cliente Prisma recibido antes de crear/limpiar.
- Los runners mantienen un advisory lock de sesión común durante migraciones/bootstrap/tests para evitar carreras entre ejecuciones que comparten fixtures. El cleanup conserva sus namespaces/IDs y verificaciones de residuos; no hay limpieza global. Ante un fallo de cleanup, detenerse y revisar sólo los IDs propios, nunca resetear.
- Email, Google Auth/Calendar y expiración automática parten deshabilitados; no se heredan credenciales reales. Las suites específicas pueden activar configuración ficticia con transporte mock o controlar el runner de expiración como ya hacían. El preload bloquea `fetch` externo y redirects; las llamadas HTTP reales de pruebas sólo van a `127.0.0.1`. No equivale a un firewall de todos los sockets del host.
- Sólo se muestran resúmenes PASS/FAIL, contadores TAP y diagnósticos acotados de fallo: índice/nivel, archivo conocido y ubicación, códigos permitidos y escalares expresamente allowlisted. No se imprimen títulos del TAP, mensajes libres, stacks, payloads ni stdout/stderr arbitrarios de Prisma/Nest. Un fallo requiere diagnóstico controlado dentro de E2E, no repetir contra desarrollo. Nunca publicar `.env`, URLs completas, tokens, passwords, `docker inspect` ni `compose config` sin `--quiet`.

Para detener, conservando datos, usar únicamente:

```powershell
docker compose --project-name citajusta-e2e -f docker/e2e/compose.yaml --env-file docker/e2e/.env stop
```

No usar `down -v`, borrar volúmenes ni reutilizar el proyecto/volumen de demostración. El tooling E2E de desarrollo `reassignment-demo.e2e.test.mjs` no integra estas 22 suites: exige `development` y queda bloqueado antes de abrir su cliente, pendiente de una adaptación aislada compatible con `test`; no relajar sus guards. El E2E Web directo tampoco queda validado por esta preparación backend.

### Validación sin PostgreSQL y evidencia Capstone

```powershell
node --test apps/api/test/docker-e2e-environment.test.mjs apps/api/test/docker-e2e-runner.test.mjs
npm run build -w @citajusta/api
npm run prisma:validate -w @citajusta/api
git diff --check
```

Para `compose config --quiet` sin credenciales reales puede usarse una contraseña sintética sólo en el entorno del proceso, sin iniciar servicios ni crear `.env`. Mantener separados en la evidencia: validación estática, mocks, build/Prisma Validate y, **después de autorización**, salud Docker, resultado de `check`, migraciones aplicadas, contadores por suite y comprobaciones de cleanup. Registrar fecha, rama y comandos, sin secretos. No marcar E2E real ni cumplimiento Capstone final como PASS antes de ejecutarlos.

## Desktop

La aplicación institucional reside en `apps/desktop`. Requiere Rust/Cargo y WebView2 además de Node/npm. Los módulos habilitados dependen del perfil, permisos y contexto autenticado; no se conectan directamente a PostgreSQL. Para validaciones manuales existen scripts de seed de desarrollo específicos (`seed:desktop-*`) que sólo deben utilizarse contra bases locales permitidas y con cuentas ACTIVE existentes cuando corresponda.

## Primera preparación

1. Desde la raíz: `npm ci`.
2. Comprobar `Get-Service postgresql-x64-18`. Si está detenido, iniciar desde Servicios o con permisos adecuados: `Start-Service postgresql-x64-18`.
3. Preparar las bases locales `citajusta_dev` y `citajusta_shadow` y su usuario mediante las herramientas de PostgreSQL. No reutilizar producción.
4. Copiar las plantillas sin sobrescribir archivos locales:

```powershell
if (-not (Test-Path apps/api/.env)) { Copy-Item apps/api/.env.example apps/api/.env }
if (-not (Test-Path apps/web/.env)) { Copy-Item apps/web/.env.example apps/web/.env }
```

5. Editar `apps/api/.env`: `NODE_ENV=development`, conexión local `DATABASE_URL`, `SHADOW_DATABASE_URL` separada y secretos JWT propios, distintos y aleatorios. Los valores de plantilla no son credenciales utilizables. No versionar secretos.
6. Generar cliente y comprobar/aplicar las migraciones existentes:

```powershell
npm run prisma:generate -w @citajusta/api
npm exec -w @citajusta/api -- prisma migrate status
npm exec -w @citajusta/api -- prisma migrate deploy
npm exec -w @citajusta/api -- prisma migrate status
npm run prisma:validate -w @citajusta/api
```

`status` puede devolver código no exitoso si faltan migraciones. Revisar el destino antes de `deploy`; no generar migraciones ni resetear la base.

7. Preparar catálogos y demo:

```powershell
npm run bootstrap:appointment-status -w @citajusta/api
npm run seed:dev -w @citajusta/api
npm run check:dev -w @citajusta/api
```

8. En `apps/web/.env`, mantener `VITE_API_BASE_URL=/api/v1` y configurar `API_PROXY_TARGET=http://localhost:3000`. Ajustar el puerto si corresponde. Reiniciar Vite al cambiar variables.
9. Arrancar API y Web en terminales separadas:

```powershell
npm run build -w @citajusta/api
npm run start -w @citajusta/api
# Otra terminal:
npm run dev -w @citajusta/web
```

10. Comprobar `http://localhost:3000/health`, abrir `http://127.0.0.1:5173`, registrar un usuario y probar Lista de espera con Atención General Demo / Sede Centro Demo: alta, preferencias y retiro. No se asignan roles institucionales al registro público.

## Migraciones, bootstrap, seed y fixtures

- **Migraciones:** estructura versionada; no sustituyen catálogos ni seed.
- **Bootstrap:** estados de citas; `bootstrap:waitlist` provisiona `ACTIVE`, `WITHDRAWN`, `FULFILLED` y `STANDARD` para instituciones activas existentes. Repetirlo después de añadir instituciones.
- **Seed:** crea sólo Institución Demo CitaJusta, Sede Centro Demo, Atención General Demo (30 minutos, Waitlist habilitada), vínculo activo y reutiliza el bootstrap Waitlist para esa institución. Conserva IDs `d1000000-...-0001/0002/0003` y códigos `DEMO-CENTRO` / `DEMO-ATENCION`. No crea usuarios, roles ni agenda.
- **Check:** transacción PostgreSQL `READ ONLY`; comprueba conexión, migraciones/checksums, catálogo demo, estados y STANDARD. Devuelve código 1 si falta preparación; no repara nada ni certifica ausencia completa de drift SQL.
- **Fixtures E2E:** datos temporales identificados, con limpieza propia; no son seed. Las 22 suites backend usan exclusivamente el [runner Docker E2E verificado](#postgresql-docker-exclusivo-para-e2e), no la conexión del `.env` API. Ejecutar secuencialmente; nunca contra desarrollo/demo.

Seed/check aceptan únicamente `NODE_ENV=development` (o ausente), host loopback y base `citajusta_dev` o `citajusta_dev_<sufijo alfanumérico>`. Rechazan producción, shadow y parámetros alternativos de conexión (sólo se admite `schema=public`). Verifican el nombre real de la base conectada.

El seed es transaccional e idempotente: no actualiza registros compatibles ni sus timestamps. Si un ID demo tiene otra identidad, relación o configuración incompatible, falla sin sobrescribir. Colisiones de códigos/nivel también provocan rollback. Revisar la colisión; no sortearla con SQL manual.

`seed:dev` no prepara booking. Los toolings opcionales siguientes tienen responsabilidades separadas.

## Agenda local para reserva manual Web

Después de `seed:dev` y `bootstrap:appointment-status` (preparación inicial), ejecutar:

```powershell
npm run seed:booking-demo -w @citajusta/api
```

Usa Institución Demo CitaJusta → Sede Centro Demo → Atención General Demo y crea **Profesional Demo Booking** mediante el servicio administrativo. Un intervalo futuro de dos horas produce cuatro cupos de 30 minutos mediante `AvailabilityAdministrationService`, nunca insertando agenda/cupos directamente. El comando imprime horarios institucionales y UTC; buscar desde Web con **Soy flexible → Próximos 30 días** o **Fecha específica**, seleccionando la fecha correspondiente en el calendario local del dispositivo.

Reutiliza cupos futuros AVAILABLE sin cita, reasignación ni bloqueo. Si no quedan, busca otra fecha dentro de los próximos 28 días, evitando agenda existente, bloqueos y feriados. No reactiva, borra ni modifica cupos anteriores. Conserva incluso un único cupo disponible, sin rellenar lo consumido. Sin fechas utilizables, falla de forma explícita.

Sólo acepta el destino local de desarrollo validado por `seed:dev`, comprueba el nombre real de la base y serializa ejecuciones del tooling mediante advisory lock. Las dos identidades técnicas no tienen contraseña utilizable; sólo el operador recibe `professionals.create` y `availability.create` en la institución demo. Colisiones/configuraciones ajenas fallan sin sobrescribir. Las transacciones de dominio son independientes: una preparación interrumpida puede dejar recursos propios y la próxima ejecución los reutiliza.

No crea usuarios públicos, reservas, cancelaciones, entradas Waitlist, ofertas, reasignaciones ni notificaciones. Los servicios administrativos conservan su auditoría normal. No altera catálogos existentes: si faltan, indica la preparación requerida.

## Escenario local de reasignación para HU-022

Tooling opcional; `check:dev` no exige tener un escenario preparado. Reutiliza las protecciones de `seed:dev`: sólo NODE_ENV development (o ausente), loopback y base `citajusta_dev`/sufijo permitido, verificando además el nombre real de la base. No modifica `.env`, contraseñas, sesiones ni roles del destinatario. No hay cleanup global ni reset.

Desde la raíz, con PostgreSQL y configuración API preparados:

```powershell
npm run check:dev -w @citajusta/api
$env:REASSIGNMENT_DEMO_RECIPIENT_EMAIL = 'Usuario1test@test.com'
npm run seed:reassignment-demo -w @citajusta/api -- --scenario=reject
# Repetir antes de responder debe mostrar el mismo offerId/expiresAt:
npm run seed:reassignment-demo -w @citajusta/api -- --scenario=reject
```

El email se normaliza igual que en Auth. La cuenta debe existir, estar ACTIVE y no estar eliminada; no se registra una cuenta ni se obtiene su password/token. Las identidades técnicas tienen un marcador no verificable como password hash: no hay contraseña utilizable ni login emitido. El rol técnico se asigna sólo al operador demo, con permisos mínimos en la institución demo.

Se reutilizan Institución Demo CitaJusta y Sede Centro Demo. Cada combinación destinatario/escenario tiene códigos `DEMO-REASSIGN-*`, servicio de 30 minutos, usuario origen, usuario profesional y profesional propios. Así no cambia una espera/preferencia previa en Atención General Demo ni compite con otra persona en ese servicio. Servicio/relaciones, profesional/relaciones y agenda se crean mediante los servicios administrativos reales; éstos materializan un único cupo para una semana después. Sólo usuarios técnicos, rol y asignaciones/permisos fundacionales se crean directamente mediante Prisma.

La secuencia usa servicios reales de reserva y entrada/preferencias Waitlist antes de cancelar. La cancelación (`RELEASED`) inicia automáticamente la reasignación HU-025 en la misma transacción `Serializable`, con actor `SYSTEM` para inicio/oferta y `USER` para cancelación. No inserta ofertas/procesos ni acepta/rechaza por fuera del dominio. El destinatario recibe preferencias compatibles sólo para el nuevo servicio demo; si fueron modificadas, el tooling falla sin sobrescribirlas.

Si la institución demo no tiene política ni historial, HU-018 configura explícitamente `PRIORITY_THEN_WAITING` y **30 minutos** para pruebas locales. Si ya tiene política, se conserva intacta y HU-009 utiliza su TTL real. Nunca se fija `expiresAt` en el tooling. La política demo afecta futuros procesos de esa institución; no modifica políticas de otras instituciones.

La preparación se serializa mediante un advisory lock PostgreSQL propio del tooling; las transacciones de dominio no se sustituyen. Un fallo puede dejar recursos DEMO intermedios: la siguiente ejecución reanuda lo compatible, sin deshacer historia. Detecta colisiones por códigos, identidad, relaciones y auditoría de creación. Si la oferta ya existe, muestra esa misma; si está finalizada o venció, informa que fue consumida, sin renovar su plazo. No crea una segunda oferta ni desplaza una agenda que ya pasó.

Prueba manual de REJECT: iniciar API/Web, entrar con el destinatario en `/ofertas`, localizar **Atención Demo Reasignación REJECT**, comprobar horario/vigencia y pulsar **No puedo asistir**. Debe mostrarse Rechazada después de consultar el backend; no debe aparecer una cita transferida. No hay siguiente candidato en este servicio aislado.

Después de rechazar manualmente, preparar el escenario separado:

```powershell
npm run seed:reassignment-demo -w @citajusta/api -- --scenario=accept
```

En `/ofertas`, aceptar **Atención Demo Reasignación ACCEPT** y comprobar su cita real en `/mis-citas`. El comando nunca responde automáticamente ninguna oferta. Si el TTL venció, no lo revive: detener la prueba y revisar antes de preparar otra iteración.

Pruebas unitarias del tooling: `node --test apps/api/test/reassignment-demo.test.mjs` después del build. El E2E histórico `reassignment-demo.e2e.test.mjs` es específico de tooling `development`, fuera de las 22 suites backend del runner Docker: no ejecutarlo hasta adaptar su aislamiento en una tarea separada. No relajar sus guards ni usarlo contra la base manual.

## Validación del flujo

HU-021 Web (lista de espera/preferencias) y HU-022 Web (ofertas) están implementadas. Para probar `/ofertas` con API/PostgreSQL:

1. Preparar entorno con `seed:dev` / `check:dev` como arriba. El seed no crea profesionales, agenda ni ofertas; no basta por sí solo para este escenario.
2. Con un operador autorizado, preparar profesional, relaciones y disponibilidad futura mediante los flujos institucionales existentes. No insertar cupos manualmente ni asignar roles a usuarios públicos automáticamente.
3. Registrar dos cuentas controladas de prueba. Una reserva una cita; la otra ingresa a la lista del servicio y guarda preferencias compatibles (incluida aceptación de cualquier profesional) **antes de la cancelación**.
4. Cancelar la cita: si el cupo es reutilizable, HU-025 inicia automáticamente el proceso y su primera oferta; sin candidatos elegibles queda `EXHAUSTED`. Repetir la cancelación no duplica efectos. La generación manual con `reassignments.generate` y `POST /api/v1/reassignments/:agendaSlotId/offers` queda para casos históricos/administrativos con contexto autorizado.
5. El destinatario abre `/ofertas`: consulta `GET /api/v1/reassignments/offers/me` sin permisos institucionales. Aceptar debe reflejar la cita transferida en Mis citas; rechazar sólo debe actualizar sus ofertas, nunca mostrar la siguiente oferta de otra persona. Para probar ambas acciones, preparar escenarios distintos.
6. Comprobar aislamiento con la otra cuenta y plazo vencido según `expiresAt`. Web no cambia estados; el runner/provider interno HU-023 expira las ofertas en el backend y continúa al siguiente candidato. El TTL lo resuelve backend desde la política institucional o el fallback global.

La consulta de ofertas es de sólo lectura, limitada a 100 recientes. HU-024 agrega notificaciones internas persistentes; no se envían mensajes externos ni se simulan ofertas. La prueba manual de interacción en navegador queda separada de los tests de contrato y renderizado.

HU-026: comprobar “Fecha específica” (calendario desde hoy) y “Soy flexible” (7/14/30 días). Ambos mantienen `from`/`to`; la fecha específica usa el calendario local del dispositivo y respeta DST, con `from=ahora` si se elige hoy.

Verificaciones conservadas del cierre Web (22-09-2026, no sustituyen una ejecución local): HU-025 API **390/390**, E2E **8/8**; HU-026 fechas **10/10**, UI **16/16**, suite Web completa **95/95**. Cierre HU-038 (04-10-2026): Auditoría Desktop **34/34 PASS**, API tooling + Auditoría **24/24 PASS**, suite Desktop **163/163 PASS**, API build, Desktop build, `cargo check` y `git diff --check` **PASS**.

```powershell
npm test -w @citajusta/web
npm run build -w @citajusta/web
npm run test:e2e:waitlist -w @citajusta/api
npm run test:e2e:reassignments -w @citajusta/api
git diff --check
```

Vite dev exige el proxy. Build/preview no lo usan: producción requiere reverse proxy para `/api/v1` o una URL API explícita con CORS autorizado. Nunca incluir secretos en variables `VITE_*`.

## HU-023: expiración automática de ofertas

El backend procesa ofertas `PENDING` con `expiresAt <= now`. Los GET de ofertas y supervisión siguen siendo de sólo lectura; el frontend no persiste expiraciones.

| Variable | Default | Valores |
| --- | --- | --- |
| `OFFER_EXPIRATION_ENABLED` | `true`, excepto `NODE_ENV=test` | `true` / `false` explícitos |
| `OFFER_EXPIRATION_INTERVAL_MS` | `30000` | Entero entre 1 y 2147483647 |
| `OFFER_EXPIRATION_BATCH_SIZE` | `50` | Entero entre 1 y 1000 |

Cuando está habilitado, el provider procesa un lote al arrancar y programa el siguiente ciclo después de terminar el anterior. Busca por vencimiento e ID ascendente; cada oferta se procesa secuencialmente en su propia transacción. Un error se registra sin payload privado y permite continuar con las demás ofertas; la pendiente vuelve a ser elegible en otro ciclo. La demora de resolución depende del intervalo y del backlog, no cambia `expiresAt`.

El runner sólo dispara la operación de dominio. La seguridad multi-instancia e idempotencia descansan en transacciones `Serializable`, actualizaciones condicionales por estado/versión y constraints PostgreSQL. Un conflicto reconocido reintenta la transacción una vez; un error transitorio persistente hace rollback y se reintentará en una ejecución posterior. No hay nuevas dependencias ni migración.

La expiración guarda `EXPIRED`, `resolvedAt` y auditoría `SYSTEM`, sin simular respuesta humana. Continúa usando ranking y política del proceso. Sin candidatos elegibles cierra `EXHAUSTED`; si el cupo/contexto ya no es utilizable cierra `CANCELLED`; una relación incoherente en un proceso activo cierra `FAILED`, sin reparar datos. Los motivos son códigos controlados. Una oferta pendiente ligada a un proceso ya terminal se considera inconsistente: rollback y aviso operativo, sin sobrescribir ese proceso.

Al cerrar NestJS se cancela el temporizador y se espera la operación en curso; Prisma se desconecta en `onApplicationShutdown`, después del drenaje. Para pruebas manuales que necesiten mantener una oferta vencida pendiente, configurar `OFFER_EXPIRATION_ENABLED=false` antes de arrancar la API. El helper de entorno E2E lo deshabilita explícitamente, incluso si `.env` lo habilita; las pruebas específicas del runner controlan su activación.

```powershell
npm run test:e2e:expiration -w @citajusta/api
```

Este E2E usa un namespace propio con UUID aleatorios, verifica carreras con PostgreSQL real y limpia sus datos y auditoría. No utiliza escenarios manuales ni IDs checkpoint.

## HU-024: notificaciones internas

Migración aditiva `20260921000000_internal_notifications`: dos enums, tabla `notificaciones`, índices de destinatario/fecha/lectura y clave única destinatario + evento. En entornos nuevos aplicar las migraciones existentes con `prisma migrate deploy`; no usar `db push` ni reset. No editar una migración ya aplicada. No agrega variables ni dependencias.

API autenticada: `GET /api/v1/notifications/me` (cursor opcional, limit 50 por defecto, máximo 100), `GET /api/v1/notifications/me/unread-count`, `POST /api/v1/notifications/:notificationId/read` (sin body funcional). La identidad proviene del token, sin contexto institucional requerido. Lectura ajena/inexistente devuelve el mismo 404; replay conserva el primer readAt. El listado es histórico e incluye unreadCount; las fechas de las notificaciones usan el timezone institucional y UTC sólo como fallback.

Los ocho eventos se escriben dentro de la transacción de reserva, cancelación, ingreso/retiro de lista de espera, creación/aceptación/rechazo/expiración de oferta. La clave es `TIPO:ID_EVENTO`; cancelación utiliza cancellationId, los demás appointmentId, waitlistEntryId u offerId. Un fallo de persistencia revierte el dominio; el replay no modifica una notificación preexistente. El E2E usa un namespace propio y limpia notificaciones antes de usuarios; los fixtures históricos conservan su propio scope.

```powershell
npm run test:e2e:notifications -w @citajusta/api
Push-Location apps/web
node --test test/notifications.test.mjs test/ui.test.mjs
Pop-Location
```

No se incluyen envío externo, mark-all-read, WebSocket, polling ni retención/borrado automático.
