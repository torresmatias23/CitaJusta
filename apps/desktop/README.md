# CitaJusta Desktop

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
