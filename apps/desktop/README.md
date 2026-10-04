# CitaJusta Desktop

## HU-036 — Supervisión de reasignaciones

Operación → Reasignaciones consulta exclusivamente `GET /api/v1/reassignments/:id`.
Requiere UUID conocido, contexto institucional y `reassignments.read`; la sede
contextual se conserva. No existe listado ni filtros de procesos. Consultar proceso
permite refrescar la observación. Cambiar UUID/contexto o salir descarta respuestas
obsoletas. Errores 404 no distinguen inexistencia de falta de acceso.

Presenta sólo campos permitidos: resumen, política (o legado), evaluación,
candidatos, ofertas y trazabilidad. Fechas ISO UTC explícitas; sin consulta de
nombres de actores. Mantiene el orden del backend, score como cadena y utiliza
`activeOfferId`/`pendingOfferId` sin temporizador ni inferencia de vigencia.
No genera, acepta, rechaza o expira ofertas ni modifica citas/cupos/políticas.

Validación manual: una cuenta ACTIVE existente debe tener `reassignments.read`
provisionado por el administrador en su contexto autorizado, y disponer de un UUID
real de proceso. No hay seed Desktop dedicado a este permiso; esta HU no otorga
roles automáticamente ni ejecuta tooling sobre la base. Aplicar contexto en Sedes
y servicios, abrir Reasignaciones y consultar el UUID. Verificar denegación sin
permiso, 404 genérico y PENDING persistida sin oferta activa. No usar fixtures como
datos locales.

## HU-034 — Sistema visual institucional

Tokens en `src/styles/tokens.css`; shell y formularios comparten superficies,
botones y estados. Tipografía de sistema: no se acoplan fuentes o iconos de Web.
Inicio ofrece accesos a módulos reales, sin estadísticas simuladas. La navegación
agrupa Catálogo, Operación y Análisis, con Reportes y Auditoría disponibles según permisos.
Contexto y cuenta despliega los identificadores reales y roles, sin consultas
decorativas. Permisos, formularios y operaciones conservan su comportamiento.
Los avisos de asistencia permanecen separados de los resultados durante la recarga.
Validar en Tauri navegación por teclado, ventana reducida y feedback tras guardar.

## HU-033 — Asistencia

El módulo principal **Asistencia** consulta `GET /api/v1/agenda` y registra resultados
con `POST /api/v1/appointments/:appointmentId/attendance`. Reutiliza el modelo,
decoder, catálogos, filtros y formato horario HU-031, sin cambiar su pantalla.
Todas las peticiones usan `session.api`; tenant/sede sólo viajan por el contexto
existente, nunca como identidad en body/query. El backend HU-017 permanece intacto.

- `agenda.read`: consultar. Sin este permiso no se carga agenda ni catálogos.
- `agenda.read` + `appointments.attendance`: mostrar acciones sólo para `AGENDADA`.
  No se deducen permisos por rol. La API revalida estado, autorización y relaciones.
- Body exacto: `{ "status": "ATENDIDA" }` o `{ "status": "INASISTENCIA" }`.
  No se envían actor, usuario, institución ni cita completa. No hay reintento
  automático de escritura; busy bloquea doble envío y deshabilita filtros/acciones.
- Éxito real: refresca Agenda y conserva filtros; si el nuevo estado no coincide
  con el filtro de estado elegido, la cita deja de aparecer en esa consulta.
  Si falla el refresco, se informa el registro confirmado y el error de consulta,
  sin conservar filas antiguas como si aún fuesen elegibles.
- `409`: mensaje controlado y botón Consultar citas disponible para revalidar.
  Fallo de escritura no informa éxito ni refresca automáticamente. Respuestas
  tardías se descartan al cambiar filtros, contexto o desmontar el módulo.
- Fecha institucional obligatoria; sede contextual fija. Horas en Institution.timeZone;
  si no se carga la zona, fallback **UTC explícito**, sin usar la zona del dispositivo.
  El backend determina qué citas pertenecen al día; se conserva su orden.
- No reabre estados finales, no transiciona CANCELADA, no cancela citas ni edita
  historial. No añade cortes horarios o reglas temporales que HU-017 no defina.

### Tooling y prueba manual HU-033

Preparación optativa, **no automática**: institución demo compatible y cuenta ACTIVE
existente, sin crear usuarios ni cambiar credenciales. API con DATABASE_URL local:

```powershell
$env:NODE_ENV = 'development'
$env:DESKTOP_ATTENDANCE_OPERATOR_EMAIL = 'matias.desktop.test@example.test'
npm run seed:desktop-attendance-operator -w @citajusta/api
```

Provisiona únicamente `agenda.read` y `appointments.attendance` en el rol dedicado
`DEMO_DESKTOP_ATTENDANCE_OPERATOR`, scope INSTITUTION, para la institución demo
`d1000000-0000-4000-8000-000000000001`. Idempotente; verifica destino PostgreSQL
local, identidad DB/institución, cuenta y compatibilidad de RBAC. Conserva otros
roles/grants/permisos, no reasigna destinatarios ni sobrescribe incompatibilidades.
Serializable con un único reintento ante conflicto reconocido. No prepara citas.

1. Con PostgreSQL disponible y API configurada, preparar permisos con el comando
   anterior sólo si faltan. Los catálogos ATENDIDA/INASISTENCIA deben estar
   provisionados mediante el bootstrap existente `bootstrap:appointment-status`.
2. Iniciar desde raíz: `npm run start -w @citajusta/api` y, en otra terminal,
   `npm run tauri -w @citajusta/desktop -- dev` (URL API Desktop ya configurada).
3. Iniciar sesión y aplicar institución autorizada en Sedes y servicios. Abrir
   **Asistencia**, elegir fecha con citas reales AGENDADA y consultar.
4. Registrar ATENDIDA en una cita e INASISTENCIA en otra; comprobar estados tras
   refrescar. No deben quedar acciones sobre estados finales o CANCELADA.
5. Probar sólo lectura, cuenta sin permisos y contexto de sede: selector fijo y
   sin citas ajenas. Comprobar errores de conexión y cambios rápidos de filtros.
   Estas acciones modifican citas reales: usar exclusivamente citas de prueba.

Validaciones desde raíz:

```powershell
npm run build -w @citajusta/api
node --test apps/api/test/attendance.test.mjs apps/api/test/desktop-attendance-operator.test.mjs
npm run test:e2e:attendance -w @citajusta/api
npm test -w @citajusta/desktop
npm run build -w @citajusta/desktop
```

## HU-032 — Disponibilidad y bloqueos

En **Agenda → Disponibilidad y bloqueos**, sin reemplazar la consulta de citas
HU-031. Usa `session.api`, contexto institucional verificado y permisos independientes:
`availability.read`, `availability.create`, `availability.update`, `availability.block`.
No se infieren permisos por nombre de rol. Una sede contextual queda fija.

- Lecturas: `GET /api/v1/availability/administration?date=YYYY-MM-DD` (sede,
  servicio, profesional opcionales) y `GET /api/v1/availability/blocks/administration`
  (fecha requerida, sede/profesional opcionales; no servicio).
- Availability incluye activas/inactivas, orden hora/id; los bloqueos intersectan
  el día institucional, orden inicio/id. No se ocultan históricos por catálogos
  inactivos. Para localizarlos, consultar la fecha sin filtros opcionales.
- Escrituras HU-014 reutilizadas: POST availability, PATCH availability/:id y
  POST availability/blocks. El PATCH envía sólo el intervalo cambiado; desactivar
  envía `{ active: false }`; reactivar exige intervalo explícito y `active: true`.
  La identidad sede/servicio/profesional/punto permanece inmutable.
- Sede/servicio y profesionales compatibles se obtienen de los catálogos reales,
  incluyendo `branches/:id/services/:id/professionals`. No hay datos ficticios.
- Fecha/hora se interpreta en `Institution.timeZone`, nunca en la zona del equipo.
  La conversión Intl valida round-trip y rechaza horas inexistentes/ambiguas; envía
  ISO UTC con precisión de minuto. Sin zona válida no permite escribir.
- No hay selector de AttentionPoint: falta un catálogo HTTP reutilizable. Se omite
  en nuevas escrituras y se muestra nombre de puntos existentes en lecturas.
- Sin recurrencia, Holiday/AttentionPoint CRUD, edición/eliminación de bloqueos ni
  borrado físico de disponibilidades. Sin cambios a citas, reasignaciones o HU-014.
- Solicitudes obsoletas se abortan/invalidan; una escritura no se reintenta
  automáticamente. `409` conserva el formulario y exige revisar/reconsultar.

### Preparación local y validación manual HU-032

Tooling optativo, **no ejecutado automáticamente**, sólo sobre PostgreSQL local de
desarrollo y una cuenta ACTIVE existente. Institución demo ya preparada:

```powershell
$env:NODE_ENV = 'development'
$env:DESKTOP_AVAILABILITY_ADMIN_EMAIL = 'matias.desktop.test@example.test'
npm run seed:desktop-availability-admin -w @citajusta/api
```

Crea únicamente el RBAC faltante del rol `DEMO_DESKTOP_AVAILABILITY_ADMIN`,
scope INSTITUTION, los cuatro permisos anteriores y grant para la institución
`d1000000-0000-4000-8000-000000000001`. Verifica identidad DB/institución,
rechaza colisiones, es idempotente y no toca usuarios/passwords/roles ajenos.
Conserva los permisos HU-029/HU-030/HU-031 existentes; no los concede.

1. Iniciar API: `npm run start -w @citajusta/api`; Desktop:
   `npm run tauri -w @citajusta/desktop -- dev` (URL API local ya configurada).
2. Iniciar sesión, aplicar institución autorizada en Sedes y servicios y abrir
   Agenda → Disponibilidad y bloqueos. Deben existir profesional/asociaciones
   activas; prepararlos mediante los flujos existentes si falta el catálogo.
3. Consultar una fecha futura; crear intervalo divisible por duración del servicio,
   comprobar listado y zona. Editar horario, desactivar y reactivar explícitamente.
4. En otro intervalo futuro sin citas, crear bloqueo MANUAL y comprobar listado.
   Verificar que no aparecen acciones editar/eliminar bloqueo y que un intervalo
   protegido responde con conflicto sin cambios parciales.
5. Probar sólo lectura, ausencia de permisos, sede contextual fija y cambios rápidos
   de filtros. La consulta de citas HU-031 continúa disponible con `agenda.read`.

Validación enfocada desde raíz (E2E requiere PostgreSQL y fixtures protegidos):

```powershell
npm run build -w @citajusta/api
node --test apps/api/test/availability-administration-read.test.mjs apps/api/test/availability-administration.test.mjs apps/api/test/desktop-availability-admin.test.mjs
npm run test:e2e:availability-admin -w @citajusta/api
npm test -w @citajusta/desktop
npm run build -w @citajusta/desktop
```

## HU-031 — Agenda institucional (sólo lectura)

Agenda consume `GET /api/v1/agenda` con `agenda.read` y contexto institucional
verificado. Fecha obligatoria `YYYY-MM-DD`; sede, servicio, profesional y estado
opcionales. El estado es un **código exacto libre**, no un catálogo cerrado.
No crea/modifica citas, disponibilidad, bloqueos ni asistencia.

El contexto de sesión se transmite mediante los headers existentes del cliente;
no hay institución/usuario/actor en query ni body. Con sede contextual, el selector
queda fijo. Sin sede contextual permite elegir una sede de la institución.

Las ayudas usan catálogos públicos autenticados existentes:
`institutions/:id`, `institutions/:id/branches`, `branches/:id/services` y
`branches/:id/professionals`; no requieren permisos administrativos adicionales.
Sólo proponen catálogos activos del contexto. Las opciones históricas se incorporan
desde las citas consultadas y no se filtran resultados por actividad de catálogos.
Para localizar un recurso inactivo, consultar primero la fecha sin filtros opcionales.

La API define el día con su zona institucional; Desktop envía la fecha sin calcular
rangos UTC. Presenta los ISO con `Intl.DateTimeFormat` y la zona obtenida de la
institución. Si no está disponible, muestra **UTC explícito**, sin adivinar una zona.
Los errores de ayudas no impiden consultar por fecha. Cambiar filtros limpia
resultados anteriores y aborta/invalida respuestas obsoletas; cada consulta conserva
el orden recibido del backend.

Prueba manual (API/PostgreSQL ya preparados):

1. Terminal 1, raíz: `npm run start -w @citajusta/api` (build API existente).
2. Terminal 2, raíz: `npm run tauri -w @citajusta/desktop -- dev`.
3. Iniciar sesión con cuenta controlada ACTIVE y `agenda.read` provisionado por
   el administrador. En Sedes y servicios, aplicar el contexto autorizado.
4. Abrir Agenda, elegir la fecha de citas reales y consultar. Comprobar nombres,
   horas/zona, estado, sede y orden; probar cada filtro y una fecha sin citas.
5. Con contexto de sede, comprobar selector fijo. Sin `agenda.read`, comprobar
   denegación. Probar error de conexión, reintento y cambios rápidos de filtros.

Esta HU no provisiona usuarios/permisos ni datos. Se requieren citas previamente
creadas; sin ellas la respuesta vacía es válida. La verificación interactiva en
Tauri complementa los tests de modelo/API y render estático de Desktop.

### Tooling local de validación de Agenda

Para una cuenta **ya existente, ACTIVE y no eliminada**, con la institución demo
compatible previamente preparada y `DATABASE_URL` local configurada en la API:

```powershell
$env:NODE_ENV = 'development'
$env:DESKTOP_AGENDA_READER_EMAIL = 'matias.desktop.test@example.test'
npm run seed:desktop-agenda-reader -w @citajusta/api
```

Inserta sólo el RBAC faltante: rol dedicado `DEMO_DESKTOP_AGENDA_READER`, scope
`INSTITUTION`, permiso exacto `agenda.read`, asignado únicamente a la institución
`d1000000-0000-4000-8000-000000000001`, sin sede. No crea usuarios, credenciales ni
citas; no modifica passwords, otros roles/grants ni los tooling HU-029/HU-030.
Exige development explícito, PostgreSQL local `citajusta_dev` o sufijo permitido,
verifica la base conectada y la identidad demo. Es idempotente, rechaza colisiones
y configuraciones incompatibles, y revierte escrituras ante fallo. El rol queda
vinculado a una única cuenta controlada; cambiar de destinatario requiere revisión,
no reasignación automática. Usa Serializable y un solo reintento por conflicto
transaccional reconocido.

Después, vuelve a iniciar sesión en Desktop y aplica esa institución sin sede en
Sedes y servicios para refrescar el contexto/permisos; abre Agenda y consulta una
fecha con citas existentes. Los demás permisos de la cuenta permanecen intactos.

Cliente institucional del monorepo npm, construido con Tauri 2, React,
TypeScript, Vite y Rust. HU-028 incorpora login real mediante el núcleo compartido
`@citajusta/client-core`: HTTP, sesión, rotación de refresh y protección frente a
respuestas tardías. Web conserva sus adaptadores de almacenamiento y navegación.

Tauri/Rust actúa como host nativo. Desktop consume la misma API REST que Web;
el backend conserva la autoridad de autenticación, autorización, aislamiento
tenant, disponibilidad, reasignaciones y auditoría. Desktop no accede
directamente a PostgreSQL ni Prisma.

## Desarrollo

Desde la raíz, con las dependencias del workspace y los prerrequisitos locales
de Tauri/Rust disponibles:

```powershell
if (-not (Test-Path apps/desktop/.env)) { Copy-Item apps/desktop/.env.example apps/desktop/.env }
npm run build -w @citajusta/api
npm run start -w @citajusta/api
```

Con PostgreSQL y el entorno API ya preparados, mantener la API en la primera
terminal. En una segunda terminal, desde la raíz:

```powershell
npm run build -w @citajusta/desktop
npm run tauri -w @citajusta/desktop -- dev
```

Configurar `VITE_API_BASE_URL=http://localhost:3000/api/v1`. Debe ser una URL
absoluta HTTP(S), sin credenciales, query ni hash, con ruta `/api/v1`. Una
configuración ausente/inválida muestra un error controlado, sin exponer su valor.
Vite utiliza el puerto 1420. La capability conserva `core:default` y añade sólo
`http:default` con scope `http://localhost:3000/api/v1/**`. El fetch de Tauri HTTP
se inyecta al cliente compartido, sin proxy WebView ni cambios CORS en el backend.
No sigue redirecciones (`maxRedirections: 0`); el plugin también verifica el scope
de redirects. Rust utiliza TLS sin habilitar cookies, proxy de sistema ni opciones
inseguras. Otro host requerirá revisar explícitamente el scope antes de distribuir.
`src-tauri/Cargo.lock` debe versionarse por ser una aplicación ejecutable;
`target/` y `gen/schemas` son generados e ignorados. npm utiliza el lock de la raíz.

## Alcance actual

Access y refresh tokens viven únicamente en memoria; no hay persistencia segura
implementada ni almacenamiento en archivos, preferencias o almacenamiento Web.
Cerrar/reabrir la aplicación exige login nuevamente. Logout limpia inmediatamente
la sesión local e intenta revocar el refresh en la API. Un fallo de red no impide
el cierre local, aunque la revocación remota no pueda confirmarse.

La shell sólo se muestra tras login y `GET users/me` exitosos. Muestra nombre,
correo, contexto y roles reales. No tener institución/sede se representa como tal:
el cliente no inventa permisos. HU-029 habilita Sedes y servicios y HU-030 habilita
Profesionales; HU-031 habilita la consulta de Agenda. Asistencia, reasignaciones,
reportes y auditoría siguen en preparación.
No hay registro Desktop.

### HU-029: catálogo administrativo

Sedes y servicios permite seleccionar el UUID de institución y, opcionalmente,
de sede facilitados por el administrador. `session.selectContext` consulta
`users/me` con headers institucionales y actualiza el perfil/permisos sólo con la
respuesta validada. El catálogo usa exclusivamente `session.api` y el transporte
existente de `@citajusta/client-core`; no descarga el catálogo global.

| Lectura bajo `/api/v1` | Permiso | Alcance |
| --- | --- | --- |
| `GET /branches/administration` | `branches.read` | Institución seleccionada; contexto BRANCH sólo su sede |
| `GET /services/administration` | `services.read` | GLOBAL/INSTITUTION con institución seleccionada, sin contexto BRANCH |
| `GET /services/categories` | `services.read` | Mismo alcance institucional; categorías activas |

Las rutas estáticas preceden a `:serviceId`; los GET públicos existentes no
cambian. Las lecturas administrativas incluyen sedes/servicios inactivos y excluyen
eliminados; reutilizan autorización y DTO del catálogo. Categorías sólo devuelve
`id`/`name`: el modelo no tiene `code` ni `deletedAt`. Crear/editar/activar/inactivar
usa los POST/PATCH HU-012 existentes, sin `institutionId` en body. La API sigue
validando tenant, permisos, relaciones, auditoría y concurrencia.

Provisionamiento explícito por el administrador: crear/reutilizar Permission
`branches.read` (`module=branches`, `action=read`) y `services.read`
(`module=services`, `action=read`), vincular mediante RolePermission al rol
autorizado y asignar UserRole vigente al usuario y ámbito correctos. Para escritura
se requieren además `branches.create/update` y/o `services.create/update`.
No se conceden permisos por nombre de rol ni al registro público; no hay migración
ni cambio en `seed:dev`, que no provisiona operadores. Los E2E añaden estos permisos
sólo a sus roles fixture y conservan permisos preexistentes al limpiar.

Para validar HU-029 localmente con una cuenta **ACTIVE existente**, hay un tooling
optativo que asigna exactamente los seis permisos de catálogo anteriores en la
institución demo existente (`seed:dev` debe estar preparado):

```powershell
$env:NODE_ENV = "development"
$env:DESKTOP_CATALOG_ADMIN_EMAIL = "matias.desktop.test@example.test"
npm run seed:desktop-catalog-admin -w @citajusta/api
```

Sólo admite PostgreSQL loopback `citajusta_dev` o `citajusta_dev_<sufijo>` y exige
`NODE_ENV=development` explícito. Verifica también el nombre real de la base y la
identidad de la institución demo. No crea usuarios, credenciales ni sesiones, ni
modifica datos de la cuenta. Reutiliza permisos compatibles y el rol institucional
`DEMO_DESKTOP_CATALOG_ADMIN`, con UUID determinísticos y transacción `Serializable`.
La repetición no modifica registros ni timestamps compatibles. Este rol dedicado
se vincula a una sola cuenta: si ya tiene asignaciones a otra cuenta, institución,
sede, vigencia o permisos ajenos, aborta sin sobrescribir. Otros roles de la cuenta
no se modifican. En Desktop aplica la institución indicada por el comando sin sede;
si ya tenías sesión, vuelve a aplicar el contexto para actualizar los permisos.

Sin permiso de lectura se muestra acceso no disponible. En BRANCH sólo se permite
editar la sede propia con `branches.update`; crear sedes y administrar servicios
requiere ámbito institucional. Asociar sedes requiere también lectura de sedes;
sin ella se conservan las asociaciones actuales. Las escrituras no se reenvían tras
refresh, bloquean doble envío y recargan el catálogo al guardar. Cambiar de contexto
o cerrar sesión desmonta el módulo y descarta respuestas tardías.

## Validación manual

### HU-030: profesionales

Profesionales consulta `GET /api/v1/professionals/administration` con
`professionals.read`, contexto institucional sin sede y grants GLOBAL/INSTITUTION.
Incluye ACTIVE/INACTIVE/SUSPENDED, excluye profesionales eliminados y otros tenants,
y devuelve identidad mínima (nombre/email) y asociaciones activas ordenadas.
Los GET públicos conservan su contrato de catálogo disponible.

Crear requiere `professionals.create` y una búsqueda exacta mediante
`GET /api/v1/professionals/eligible-users?email=<email>`; no hay listado de cuentas
ni búsqueda parcial. Reutiliza validación/normalización Auth. La cuenta debe existir,
estar ACTIVE/no eliminada y no tener un Professional en la institución, incluso
inactivo/eliminado, por la unicidad vigente. Las causas de no elegibilidad usan el
mismo 404. User sigue siendo global: un perfil en otra institución no impide el alta.

El alta utiliza POST HU-013; edición y cambios de estado usan PATCH HU-013 con
`professionals.update`. `userId` se obtiene de la cuenta encontrada y queda inmutable.
Desktop no crea cuentas, modifica credenciales ni otorga roles/permisos. La API
revalida elegibilidad, permisos y relaciones al escribir; una búsqueda exitosa no
garantiza que el alta siga siendo válida si el estado cambia concurrentemente.

Provisionar explícitamente Permission `professionals.read` (`module=professionals`,
`action=read`), RolePermission y UserRole en el ámbito autorizado. La lectura no
reutiliza permisos de escritura. Para formularios se necesitan además `branches.read`
y `services.read`; si faltan, la UI informa acceso no disponible, sin fallback público.
El tooling `seed:desktop-catalog-admin` de HU-029 conserva sus seis permisos exactos:
no concede permisos de profesionales ni debe ampliarse silenciosamente.

Para validación local de HU-030, el tooling dedicado asigna a una cuenta ACTIVE
existente exactamente `professionals.read/create/update`, `branches.read` y
`services.read`, mediante el rol `DEMO_DESKTOP_PROFESSIONAL_ADMIN` de scope
INSTITUTION, sólo en la institución demo `d1000000-0000-4000-8000-000000000001`:

```powershell
$env:NODE_ENV = "development"
$env:DESKTOP_PROFESSIONAL_ADMIN_EMAIL = "matias.desktop.test@example.test"
npm run seed:desktop-professional-admin -w @citajusta/api
```

Requiere la institución de `seed:dev` existente y PostgreSQL local `citajusta_dev`
o `citajusta_dev_<sufijo>`; verifica también el nombre real de la base. No crea
usuarios ni cambia credenciales o datos de la cuenta. Reutiliza permisos compatibles
y crea sólo registros RBAC faltantes dentro de una transacción Serializable.
El rol dedicado admite una sola cuenta: permisos ajenos, colisiones de identidad
o grants incompatibles hacen abortar sin sobrescribir. Otros roles/grants no se
modifican; repetir el comando conserva registros compatibles. En Desktop vuelve
a aplicar la institución demo **sin sede** para actualizar los permisos y abre
Profesionales. El tooling HU-029 permanece independiente y sin cambios.

Las asociaciones no editadas se omiten del PATCH, conservando incluso inactivas.
Al modificar una selección se retiran las asociaciones inactivas/no disponibles y
sólo se envían recursos activos; `[]` retira todas en edición. El alta exige al menos
una sede y un servicio. Las filas históricas se conservan según HU-013. El módulo
aborta/invalida respuestas tardías, bloquea doble envío y no reenvía escrituras tras
refresh. No usa optimistic success ni almacena tokens.

Prueba manual en Tauri:

1. Iniciar API y Desktop con los comandos de Desarrollo; usar una cuenta controlada
   con los permisos anteriores provisionados por el administrador.
2. En Sedes y servicios, aplicar el contexto institucional **sin sede**; abrir Profesionales.
3. Crear: buscar email exacto de otra cuenta ACTIVE existente, seleccionar sede/servicio
   activos y guardar. Comprobar nombre/email, estado y asociaciones en el listado.
4. Editar código/función, reemplazar asociaciones y cambiar ACTIVE → INACTIVE →
   SUSPENDED → ACTIVE. La identidad vinculada no debe ser editable.
5. Repetir con cuenta sólo lectura, sin permisos y contexto BRANCH; verificar denegación.
   Buscar email inexistente/inactivo o ya profesional debe mostrar un error controlado.

```powershell
npm run build -w @citajusta/api
node --test apps/api/test/professional-administration-read.test.mjs apps/api/test/professional-administration.test.mjs apps/api/test/professionals.catalog.test.mjs
npm run test:e2e:professionals -w @citajusta/api
npm test -w @citajusta/desktop
npm run build -w @citajusta/desktop
```

Usar una cuenta controlada ACTIVE ya creada por los mecanismos existentes, con
su contraseña conocida por el propietario. No usar usuarios técnicos demo sin
login ni inventar credenciales. Antes del login debe verse el formulario; después,
la shell y el perfil devuelto por la API. Sin contexto institucional debe indicarse
su ausencia. Cerrar sesión debe volver al formulario. Volver a iniciar sesión,
cerrar la ventana nativa y abrirla nuevamente debe exigir las credenciales.

```powershell
npm run typecheck -w @citajusta/client-core
npm test -w @citajusta/client-core
npm test -w @citajusta/desktop
cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml
```

Validación HU-029 con cuenta controlada y permisos provisionados explícitamente:
abrir Sedes y servicios, aplicar contexto, crear/editar e inactivar/reactivar una
sede y un servicio; comprobar categoría y asociaciones reales. Repetir con permiso
de sólo lectura, sin permisos y con contexto BRANCH. Las categorías existentes se
consultan desde la API; esta HU no añade administración de categorías.

Pruebas enfocadas desde la raíz (E2E requiere PostgreSQL local preparado):

```powershell
npm run build -w @citajusta/api
node --test apps/api/test/catalog-administration-read.test.mjs apps/api/test/catalog-administration.test.mjs apps/api/test/services.catalog.test.mjs apps/api/test/institutions.catalog.test.mjs
npm run test:e2e:catalog -w @citajusta/api
npm test -w @citajusta/desktop
npm run build -w @citajusta/desktop
npm test -w @citajusta/client-core
```

## Auditoría institucional (HU-038)

Análisis → Auditoría consulta `GET /api/v1/audit/events` con `audit.read` y el
contexto institucional autenticado. La pantalla es de sólo lectura. La sede del
contexto permanece fija; sin ella puede seleccionarse una sede del catálogo
autenticado existente. El fallo de ese catálogo auxiliar no bloquea la consulta.

Filtros opcionales: `from`, `to` (fechas civiles YYYY-MM-DD), `branchId`,
`actorUserId` (UUID), `action` y `resourceType` (códigos cerrados de HU-020).
Se permite una, ambas o ninguna fecha; si hay ambas, Desde debe ser anterior o
igual a Hasta. Auditoría no impone el límite de 366 días de Reportes. El backend
interpreta los días mediante la zona horaria institucional.

Cada consulta pide 50 eventos (default backend: 50; máximo backend: 100), ordenados
por `occurredAt DESC, id DESC`. «Cargar más» usa el cursor opaco `page.nextCursor`
con los mismos filtros y anexa sin duplicados; no hay offset ni totales inventados.
Cambiar filtros limpia resultados/cursor e invalida respuestas anteriores. Un fallo
al cargar otra página conserva los eventos obtenidos y permite reintentar.

`occurredAt` se presenta como instante ISO UTC. Se muestran actor USER/SYSTEM,
acción, recurso, resultado y transición/motivo cuando existen, conservando los
códigos reales. No se añaden nombres/emails de actores o recursos ni payloads,
secretos o mensajes internos. La vista exige contexto institucional como los
otros módulos Desktop; no expone consulta global sin institución.

Tooling opcional desde la raíz, con institución demo preparada por `seed:dev`
y una cuenta ACTIVE existente:

```powershell
$env:NODE_ENV = 'development'
$env:DESKTOP_AUDIT_READER_EMAIL = 'cuenta-controlada@example.test'
npm run seed:desktop-audit-reader -w @citajusta/api
```

Sólo admite PostgreSQL local `citajusta_dev` (o sufijo de desarrollo permitido).
Provisiona exclusivamente `audit.read` (`module=audit`, `action=read`) mediante
`DEMO_DESKTOP_AUDIT_READER`, scope INSTITUTION, sede nula, en la institución demo.
Es idempotente y transaccional; conserva roles ajenos y timestamps existentes,
rechaza configuraciones incompatibles y sólo reintenta conflictos reconocidos.
No crea/modifica usuarios, credenciales ni eventos. Tras ejecutarlo, iniciar
sesión y aplicar el contexto demo en Sedes y servicios. No se ejecuta automáticamente.

## Reportes institucionales (HU-037)

Análisis → Reportes consulta `GET /api/v1/reports/indicators` con `reports.read`
y el contexto autenticado. Desde/Hasta son fechas civiles inclusivas (1–366 días);
la API aplica la zona horaria institucional. Sede, servicio y profesional son
filtros opcionales asistidos por los catálogos públicos autenticados existentes.
Si éstos fallan, la consulta por período sigue disponible. Un contexto con sede
la mantiene fija, sin ampliar su alcance.

Se muestran los diez valores de Citas, Recuperación de cupos y Ofertas tal como
los entrega la API, incluido `recoveryRatePct`. «Citas del período» incluye todos
los estados, no sólo AGENDADA. Los ceros se conservan; no hay series, tendencias
ni cálculos de métricas en Desktop.

Tooling opcional, desde la raíz, sólo para PostgreSQL local de desarrollo y una
cuenta ACTIVE existente (preparar primero la institución mediante `seed:dev`):

```powershell
$env:NODE_ENV = 'development'
$env:DESKTOP_REPORTS_READER_EMAIL = 'cuenta-controlada@example.test'
npm run seed:desktop-reports-reader -w @citajusta/api
```

Provisiona exclusivamente `reports.read` (`module=reports`, `action=read`) mediante
`DEMO_DESKTOP_REPORTS_READER`, scope INSTITUTION, sede nula, en la institución demo.
Es idempotente, conserva roles ajenos y rechaza colisiones incompatibles. No crea
usuarios, credenciales ni actividad de reportes. Tras ejecutarlo, iniciar sesión
y aplicar el contexto demo en Sedes y servicios. No se ejecuta automáticamente.
