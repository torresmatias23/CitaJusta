# CitaJusta

CitaJusta es una plataforma de gestión de citas y listas de espera activa desarrollada como proyecto Capstone APT122.

## Problema

La disponibilidad de citas cambia cuando se producen reservas, cancelaciones y expiraciones. Sin una coordinación central, un cupo liberado puede quedar desaprovechado o asignarse de forma inconsistente.

## Usuarios objetivo

- Personas que necesitan buscar, reservar y gestionar citas.
- Profesionales que prestan los servicios agendados.
- Personal administrador de instituciones y sedes.

## Propuesta de valor

Centralizar el catálogo y la disponibilidad, y preparar una reasignación segura de cupos mediante lista de espera, compatibilidad, priorización y ofertas temporales. El backend es la autoridad de las reglas críticas y debe impedir la doble asignación.

## Estado actual

| Componente | Estado verificable |
| --- | --- |
| API backend | En desarrollo: salud, autenticación/sesiones, base RBAC, catálogos, disponibilidad, reserva transaccional (HU-004), consulta propia (HU-005) y cancelación (HU-006) |
| Persistencia | PostgreSQL y Prisma; 37 modelos y migraciones versionadas |
| Aplicación web | Fundación React/Vite en `apps/web`: Home responsive de demostración, todavía sin sesión ni conexión al backend |
| Aplicación de escritorio | Pendiente; `apps/desktop` aún no existe |
| Docker | Obligatorio para Capstone, pendiente de implementación |
| Funciones críticas de citas, lista de espera y reasignación | Modelado de base presente; implementación funcional incompleta |
| Documentación académica | Seis DOCX reales incorporados; revisión, trazabilidad y actualización pendientes |

## Tecnologías

- Monorepo con npm workspaces.
- NestJS y TypeScript para la API REST.
- PostgreSQL con Prisma ORM.
- JWT Access Token y Refresh Token; base de autorización RBAC.
- React, Vite, TypeScript, Tailwind CSS, Lucide e Inter para web.
- Tauri, React y TypeScript planificados para escritorio.
- Git y GitHub.

## Arquitectura resumida

```text
Web React/Vite (base visual) -------\
                                      > API REST NestJS -> Prisma -> PostgreSQL
Desktop Tauri/React (pendiente) ----/
```

Web y escritorio consumirán el mismo backend. La autenticación, autorización, aislamiento institucional, disponibilidad y futuras transiciones de reservas, ofertas y reasignaciones deben resolverse en el backend.

La API funcional usa el prefijo `/api/v1`; el endpoint técnico `GET /health` permanece sin prefijo.

HU-004: `POST /api/v1/appointments` requiere Bearer token y recibe únicamente `{ "agendaSlotId": "UUID" }`. Devuelve `201` con `{ data: { id, agendaSlotId, institutionId, branchId, serviceId, professionalId, startsAt, endsAt, origin, status } }`. El backend fija usuario, origen `WEB` y estado `AGENDADA`; un conflicto de disponibilidad/concurrencia devuelve `409`.

HU-005: `GET /api/v1/appointments/me` requiere Bearer token. No admite campos de query ni body (`400`); el usuario se obtiene exclusivamente del principal autenticado (`401` sin autenticación válida). Devuelve `200` con `{ data: [{ id, institutionId, status, startsAt, endsAt, origin, branch: { id, name }, service: { id, name }, professional: { id, firstNames, lastNames } }] }`, o `{ data: [] }`. `status` es el código almacenado; fechas ISO 8601 UTC. Orden: `startsAt ASC, id ASC`, sin paginación ni filtro temporal. Incluye citas propias pasadas y futuras sin cambiar estados; excluye citas eliminadas lógicamente y relaciones institucionales incoherentes. Conserva el historial aunque los catálogos estén inactivos. Los headers institucionales no seleccionan otro usuario ni amplían el acceso.

HU-006: `POST /api/v1/appointments/:appointmentId/cancel` requiere Bearer token, UUID válido y no admite campos de query/body. Devuelve `200` con `{ data: appointment }` tanto al cancelar como al repetir una cancelación propia ya completada; `appointment` contiene exactamente los campos públicos de cada elemento de HU-005, con `status: "CANCELADA"`. Errores: `400` para input inválido, `401` sin autenticación válida, `404` indistinguible para cita inexistente/eliminada/ajena o relaciones incoherentes, `409` para estado no cancelable o conflicto concurrente no resuelto y `503` si el catálogo de cancelación falta o es incompatible. Sólo transiciona `AGENDADA` activa, no final y con `allowsCancellation: true` a `CANCELADA`. No se añade una ventana temporal ni se exige que los catálogos institucionales sigan activos para cancelar una cita propia coherente.

La cancelación usa una transacción `Serializable`, cambios condicionales y `lockVersion`: `AgendaSlot` pasa de `RESERVED` a `RELEASED`, nunca a `AVAILABLE`. Conserva `Appointment.agendaSlotId UNIQUE`, propietario y cita; crea una `Cancellation` con actor y `releasesSlot: true` (liberación lógica, no disponibilidad pública), además del historial con estados anterior/nuevo y actor. Una cita ya cancelada devuelve su DTO sin nuevas escrituras. Ante `P2034` se reintenta una sola vez en una transacción nueva: si otra solicitud ya canceló, responde `200` sin duplicar efectos; si persiste el conflicto, responde `409`. HU-004 no reutiliza la cita cancelada; HU-005 sigue mostrándola a su dueño. No se crean reasignaciones ni ofertas: la futura reasignación podrá referenciar esta cancelación y transferir la cita existente.

## Estructura del monorepo

```text
apps/
  api/          # backend implementado
  web/          # fundación visual; integración API pendiente
  desktop/      # pendiente
packages/       # reservado para necesidades compartidas reales
docs/
  development/  # documentación técnica
  capstone/     # cumplimiento y planificación académica
Fase 1/         # evidencias académicas
Fase 2/
Fase 3/
```

## Integrantes y roles

Los cinco documentos v0.1 identifican a Matías Andrés Torres, Bastian Sepúlveda y Diego Simon; el Documento Base no incluye una nómina y todavía no hay roles validados en el README. Esta diferencia mantiene la identidad del equipo pendiente de confirmación: no se declara una nómina oficial ni se corrigen variantes sin validación del equipo.

## Metodología Scrum

Scrum se utilizará como marco de trazabilidad académica. Aún deben incorporarse Product Vision formal, Product Backlog priorizado, Definition of Done, Sprint Backlog, retrospectivas y evidencia de pruebas por sprint. La estrategia propuesta está en [Evidencia Scrum con GitHub](docs/capstone/GITHUB_SCRUM_EVIDENCE.md).

## Requisitos locales

- Windows, entorno actualmente verificado.
- Node.js 24.x; versión verificada: 24.11.0.
- npm 11.6.1.
- PostgreSQL 18.
- Git 2.49 o compatible.

Consulta el detalle en [SETUP.md](docs/development/SETUP.md).

## Instalación

Desde la raíz del repositorio, el lockfile permite instalar los workspaces con:

```powershell
npm ci
npm run --workspace @citajusta/api prisma:generate
```

El cliente Prisma generado no se versiona. La preparación y migración completa de la base de datos todavía debe consolidarse y validarse en el manual técnico Capstone.

Con las migraciones aplicadas y `DATABASE_URL` configurada, provisionar el estado inicial antes de reservar:

```powershell
npm run --workspace @citajusta/api bootstrap:appointment-status
```

El bootstrap es idempotente por códigos `AGENDADA` y `CANCELADA` y conserva toda configuración existente. Para `AGENDADA` omite `allowsConfirmation`, cuyo default del modelo es `false`; `CANCELADA` se crea activa y final, con `allowsCancellation` y `allowsConfirmation` en `false`. Los endpoints no ejecutan el bootstrap: la reserva responde `503` si `AGENDADA` falta, está inactiva o es final; la cancelación responde `503` si `CANCELADA` falta, está inactiva, no es final o permite cancelar/confirmar.

### HU-007: ingreso y consulta de lista de espera

- `POST /api/v1/waitlist`: Bearer token y body estricto `{ serviceId: UUID, branchId?: UUID }`, sin query. Devuelve `201` con `{ data: { id, status, enteredAt, service: { id, name }, branch: { id, name } | null } }`.
- `GET /api/v1/waitlist`: Bearer token, sin filtros ni campos de body. Devuelve `{ data: [...] }` con el mismo DTO, sólo solicitudes propias no eliminadas y con `status.isFinal: false`, ordenadas por `enteredAt ASC, id ASC`. Los catálogos inactivos no ocultan solicitudes abiertas; las relaciones institucionales incoherentes se excluyen.
- El propietario viene del principal y la institución del servicio. Servicio/institución deben estar activos y no eliminados; una sede indicada debe estar activa, pertenecer a esa institución y tener `ServiceBranch` activa. Se exige `allowsWaitlist: true`.
- Estado inicial `ACTIVE` (Activa, activo, no final). Prioridad `STANDARD` institucional, resuelta por `(institutionId, code)`, nunca elegida por cliente ni con fallback global. Estado, prioridad, notas y campos internos no forman parte del input/DTO.
- Equivalencia: mismo usuario, institución y servicio, independientemente de sede. Una solicitud no eliminada y no final bloquea otra incluso si su catálogo de estado está inactivo. Finalizadas/eliminadas permiten una nueva alta.
- Transacción `Serializable`, lectura de equivalencia e inserción dentro de ella y un reintento completo ante `P2034` o conflicto de serialización/deadlock del adapter-pg al commit. Conflictos persistentes devuelven `409`. No existe UNIQUE físico de equivalencia: todos los futuros escritores deben respetar esta política.
- Errores: `400` input inválido/extra, `401` autenticación/usuario inválido, `404` servicio/sede no accesible o relaciones inválidas, `409` espera deshabilitada/duplicada/conflicto y `503` catálogo faltante/incompatible.
- Errores inesperados de programación/persistencia, incluidas violaciones UNIQUE/FK no clasificadas, devuelven `500` sin detalles internos; no se reinterpretan como duplicados ni se reintentan. Sólo `P2034` o `DriverAdapterError` con `cause.kind: TransactionWriteConflict` y SQLSTATE `40001`/`40P01` habilitan el reintento transaccional.
- Sin sede significa solicitud por servicio, no aceptación de cualquier sede. Se conservan `allowsOtherBranches: false`, `minimumNoticeMinutes: 0` y demás defaults; no se crean preferencias. La falta de disponibilidad adecuada es una precondición del flujo de búsqueda, no una prohibición basada en la existencia de cupos. HU-008 definirá preferencias y HU-009 elegibilidad; no se crean citas, candidatos, ofertas ni reasignaciones.

Provisionar explícitamente después de configurar instituciones y repetir al incorporar nuevas:

```powershell
npm run --workspace @citajusta/api bootstrap:waitlist
npm run --workspace @citajusta/api test:e2e:waitlist
```

El bootstrap crea los estados `ACTIVE`/`WITHDRAWN` y `STANDARD` para cada institución activa/no eliminada. Sin instituciones sólo provisiona ambos estados. Una prioridad nueva usa nombre `Estándar`, nivel `0` y `active: true`; es un valor base técnico, no una fórmula de scoring. Conserva identificadores, nombres y niveles compatibles ya configurados. Si `ACTIVE` está inactivo/final, `WITHDRAWN` inactivo/no final, `STANDARD` inactiva o el nivel `0` pertenece a otra prioridad, falla con rollback sin sobrescribir ni escoger otro nivel. No utiliza prioridades globales, cuyos UNIQUE con institución nula no garantizan unicidad. Los endpoints nunca ejecutan bootstrap. E2E usa PostgreSQL local permitido y fixtures identificados; ejecutar secuencialmente con los E2E de appointments/checkpoint.

### HU-008: preferencias y retirada de lista de espera

- Todos los endpoints requieren Bearer token y propiedad de la espera; rechazan query y campos adicionales. El usuario nunca se recibe del cliente.
- `GET /api/v1/waitlist/:waitlistEntryId/preferences` devuelve `200 { data: { preferredDays, timeRanges, preferredBranchIds, allowsOtherBranches, acceptsAnyProfessional } }`. Sin preferencias: arrays vacíos, consentimiento de la entrada (por defecto `false`) y `acceptsAnyProfessional: true`. Conserva lectura de preferencias de esperas finalizadas y sedes posteriormente inactivas.
- `PUT` sobre la misma ruta reemplaza completamente esos cinco campos obligatorios y devuelve el mismo DTO con `200`. Días enteros ISO: `1=lunes` a `7=domingo`. Rangos `{ start: "08:30", end: "12:00" }` en `HH:mm`, sin cruce de medianoche ni solapamientos; rangos contiguos permitidos. El modelo guarda `TIME`, sin vínculo rango/día: cada rango corresponde al conjunto de días seleccionado. Arrays vacíos no conceden automáticamente disponibilidad universal.
- Días/rangos se devuelven ordenados; sedes conservan el orden enviado. Duplicados se rechazan con `400`. Cada sede del PUT debe estar activa/no eliminada, pertenecer a la institución de la espera y tener `ServiceBranch` activa para su servicio. No cambia la sede original. Ambos booleanos sólo persisten preferencias, sin matching.
- `POST /api/v1/waitlist/:waitlistEntryId/withdraw`, sin body funcional, devuelve `200 { data: { id, status: "WITHDRAWN" } }`. Una espera abierta pasa a retirada; repetir no escribe ni modifica timestamps. Otro estado final devuelve `409`. La entrada y sus preferencias se conservan.
- El mismo `bootstrap:waitlist` provisiona también `WITHDRAWN` (Retirada, activo y final), incluso sin instituciones. Es idempotente y conserva configuración compatible; una configuración inactiva/no final falla con rollback. Debe ejecutarse explícitamente antes de habilitar la retirada; ausencia/incompatibilidad del catálogo devuelve `503`.
- PUT y retirada usan `Serializable` con un reintento completo ante los conflictos ya reconocidos. PUT actualiza explícitamente `WaitlistEntry.updatedAt` a un instante mayor que el anterior, incluso al cambiar sólo hijos; no modifica `enteredAt`. La retirada efectiva también avanza `updatedAt`. Cualquier fallo revierte todas las escrituras.
- Errores: `400` contrato inválido, `401` autenticación/usuario inválido, `404` espera no accesible o sede/relación inválida, `409` espera finalizada/conflicto persistente, `503` catálogo de retirada faltante/incompatible y `500` inesperado sin detalles internos.
- HU-008 no interpreta los campos preexistentes `acceptsAnyTime`/`acceptsWeekend`, ni crea candidatos, ofertas o cambios en citas/cupos. La evaluación HU-009 descrita abajo conserva las preferencias y el snapshot `entryUpdatedAtSnapshot`.

### HU-009: generación institucional de ofertas

- `POST /api/v1/reassignments/:agendaSlotId/offers`: Bearer token, `x-institution-id` obligatorio y `x-branch-id` opcional. Sin query ni body funcional. Usa los guards de autenticación, contexto y permisos; requiere `reassignments.generate` y revalida su asignación vigente dentro de la transacción. El contexto solicitado debe coincidir con la institución/sede del cupo. No es una acción de usuario final.
- Un administrador debe provisionar explícitamente el permiso en el catálogo RBAC (`code=reassignments.generate`, `module=reassignments`, `action=generate`) y asignarlo sólo a roles operativos autorizados. Este cambio no incluye un flujo de administración de permisos. No se crea ni concede automáticamente; sin asignación devuelve `403`.
- Sólo procesa cupos futuros `RELEASED`, sin bloqueo temporal vigente, con relaciones activas/coherentes según la política compartida de disponibilidad, una única cita `CANCELADA` y una cancelación que liberó el cupo. No modifica citas ni historial ni cambia el cupo a `AVAILABLE`.
- Evalúa entradas del mismo servicio/institución, no eliminadas y no finales. Excluye al usuario de la cita cancelada, usuarios inactivos/eliminados y prioridades inactivas/no institucionales. Para sede: sede original O sede preferida explícita O consentimiento `allowsOtherBranches`, siempre dentro del contexto válido del cupo. Sede nula no concede aceptación universal.
- Compara día ISO y rango completo inicio/fin en `Institution.timeZone`. Requiere días explícitos; conjunto vacío o preferencias inexistentes excluyen. Los días explícitos prevalecen sobre el default legado `acceptsWeekend=false`. Rangos vacíos excluyen salvo `acceptsAnyTime=true`; con rangos explícitos exige contener toda la cita en uno de ellos. Intervalos que cruzan fecha o retroceden en hora local se excluyen conservadoramente. Respeta fecha límite y aviso mínimo persistidos.
- `acceptsAnyProfessional=false` excluye con `SPECIFIC_PROFESSIONAL_UNDEFINED`. No infiere profesional ni amplía el modelo; selección de profesional específico queda pendiente para una mejora futura.
- Regla versionada `PRIORITY_FIFO_V1`: nivel de prioridad ASC (menor nivel primero), `enteredAt ASC`, UUID ASC. Sin fórmula ponderada: `totalScore=-priority.level` satisface el CHECK existente de candidatos elegibles; los desempates determinan el ranking. Persiste `ELIGIBLE`/`EXCLUDED`, motivo, ranking, prioridad y `entryUpdatedAtSnapshot`, además de estado, antigüedad y preferencias en `evaluationContext`. El proceso conserva regla, zona, TTL, actor y contexto del cupo. Cambios posteriores no reescriben snapshots.
- `WAITLIST_OFFER_TTL_MINUTES`: entero positivo global, default explícito `10`. `createdAt` y `expiresAt` parten del mismo instante de creación; expiración = creación + TTL × 60 000 ms. No existe configuración por institución ni worker de expiración. El vencimiento puede superar el inicio del cupo; la futura aceptación debe revalidar que la cita aún no haya comenzado.
- Transacción `Serializable`, CAS sobre `RELEASED`/`lockVersion`, incremento único de versión y un reintento completo usando `transaction-conflict.ts` sin modificaciones. Conserva los UNIQUE/índices parciales existentes por cancelación, cupo, candidato y oferta activa. La oferta registra la versión posterior al CAS. Una evaluación previa de la misma cancelación, incluso agotada, devuelve `409`; no reevalúa snapshots ni genera la siguiente oferta.
- Éxito `201 { data: { id, status: "OFFERING", offer: { id, status: "PENDING", agendaSlotId, createdAt, expiresAt } } }`. Sin elegibles: `201 { data: { id, status: "EXHAUSTED", offer: null } }`, con candidatos excluidos persistidos. Repeticiones/concurrencia perdedora: `409`. Otros errores: `400` contrato/contexto inválido, `401` autenticación, `403` permiso, `404` recurso/contexto no accesible, `503` configuración temporal inutilizable, `500` inesperado sin detalles internos.
- No acepta/rechaza/expira ofertas, no notifica, no transfiere citas y no implementa frontend. La futura resolución debe comprobar vigencia, estado y snapshots de entrada/cupo y transferir la Appointment existente, nunca crear otra para el mismo cupo. La reevaluación, la continuación tras rechazo/expiración y el disparo automático quedan fuera de HU-009.

Validación enfocada: `npm run --workspace @citajusta/api test:e2e:reassignments` (PostgreSQL local, secuencial respecto de otros E2E). Unitarios: `node --test apps/api/test/reassignments.offers.test.mjs` después del build.

### HU-016: supervisión de reasignaciones

- `GET /api/v1/reassignments/:reassignmentId`: Bearer token, `x-institution-id` obligatorio y `x-branch-id` opcional; sin filtros query ni body. Reutiliza `AccessTokenGuard`, `AuthorizationContextGuard` y `PermissionsGuard`. Requiere el permiso independiente `reassignments.read` (`module=reassignments`, `action=read`), provisionado/asignado explícitamente a funcionarios autorizados; no concede generación, aceptación ni rechazo.
- `200 { data: ... }` incluye identificación/estado del proceso, institución/sede/servicio, cupo y versión actuales, cita asociada, cancelación de origen, reglas/snapshots de evaluación, candidatos y ofertas con destinatario identificado por UUID. No incluye contactos, credenciales, notas operativas ni JSON arbitrario. Timestamps ISO UTC; puntuación decimal como string para preservar precisión.
- Candidatos ordenados por `rankingPosition ASC NULLS LAST, id ASC`; ofertas por `attemptNumber ASC, id ASC`. Motivos, fechas de evaluación/resolución y estado final permiten reconstruir rechazo, continuación y aceptación. Se consultan también procesos históricos con catálogos actualmente inactivos, sin relajar aislamiento institucional.
- `pendingOfferId` refleja estado persistido `PENDING`; `activeOfferId` sólo identifica una oferta pendiente no vencida de un proceso `OFFERING`, calculada en `observedAt`. El GET no ejecuta expiración, reevaluación, scoring, notificaciones ni escrituras. Usa `RepeatableRead` para obtener un snapshot consistente sin alterar estados, versiones, ofertas o historial.
- Backlog HU-016 (RF-032/RF-033): se muestran reglas de evaluación y el actor de generación registrado como `AUTHORIZED_REQUEST`; si no existe, `NOT_RECORDED`. Esto distingue solicitud autorizada y evaluación por reglas, sin inventar intervenciones manuales o eventos no persistidos. No se añade intervención manual operativa.
- Errores: `400` UUID/input/contexto inválido, `401` sin autenticación, `403` sin permiso aplicable, `404` inexistente/no visible/relaciones institucionales incoherentes con respuesta uniforme, `500` inesperado sin detalles internos. Sin migraciones ni cambios a HU-009/010/011.

### HU-012: administración institucional de sedes y servicios

- `POST /api/v1/branches` (`branches.create`) y `PATCH /api/v1/branches/:branchId` (`branches.update`). Alta: `code`, `name`; opcionales: `addressLine1`, `addressLine2`, `municipality`, `region`, `country`, `latitude`, `longitude`, `phone`, `email`, `status` (`ACTIVE`/`INACTIVE`). PATCH admite esos mismos campos, al menos uno. Coordenadas numéricas con hasta siete decimales; DTO las devuelve como string decimal o null.
- `POST /api/v1/services` (`services.create`) y `PATCH /api/v1/services/:serviceId` (`services.update`). Alta: `code`, `name`, `durationMinutes`; opcionales: `description`, `categoryId`, `minimumAdvanceMinutes`, `maximumAdvanceDays`, `allowsWaitlist`, `requiresConfirmation`, `active`, `branchIds`. PATCH parcial no vacío; `active: false/true` desactiva/reactiva. Duración y anticipación máxima positivas; anticipación mínima no negativa y no superior a la máxima convertida a minutos. `maximumAdvanceDays: null` elimina el límite. No implementa nuevos flujos de confirmación.
- Bearer token y `x-institution-id` obligatorios. Reutiliza los tres guards existentes y revalida las asignaciones RBAC vigentes dentro de la transacción. Crear sedes y administrar servicios requiere permiso GLOBAL o INSTITUTION y contexto sin `x-branch-id`, porque afecta al catálogo institucional. Editar una sede admite un permiso BRANCH sólo con `x-branch-id` coincidente; no permite editar otra sede. Un administrador debe provisionar los cuatro permisos (`module=branches/services`, `action=create/update`), vincularlos mediante `RolePermission` y asignar el rol con `UserRole` al ámbito correcto. No se crean permisos ni se conceden roles automáticamente.
- Institución activa/no eliminada obtenida del contexto, nunca del body. Categoría y sedes explícitamente asociadas deben ser activas y de la misma institución. Los códigos se recortan y respetan la unicidad exacta existente `(institutionId, code)`, también para recursos inactivos o eliminados lógicamente; no se impone unicidad por nombre ni se cambia el uso de mayúsculas.
- `branchIds` omitido conserva asociaciones; enviado reemplaza el conjunto activo (máximo 100 UUID únicos). `[]` desactiva todas; las asociaciones retiradas quedan persistidas con `active=false`, sin DELETE. No cambia asignaciones profesionales ni agendas. Los campos nullable aceptan null explícito para limpiarse. Desactivar un servicio o sede no elimina citas, cupos, esperas, reasignaciones ni historiales; tampoco reescribe fechas/duración de citas existentes. Las lecturas operativas existentes mantienen su contrato y filtros de actividad; las consultas históricas conservan su comportamiento.
- Respuestas `201` en POST y `200` en PATCH, con `{ data: ... }`. DTO sede: `id` más los campos editables de sede. DTO servicio: `id` más los campos editables de servicio, con `branchIds` activos ordenados por UUID. No expone `institutionId`, relaciones Prisma completas, timestamps internos ni `deletedAt`. Sin query adicional; campos desconocidos, identidades y claves internas se rechazan. `400` input/contexto inválido, `401` no autenticado, `403` sin permiso/ámbito suficiente, `404` recurso o relación inexistente/no accesible, `409` código duplicado/conflicto concurrente persistente, `500` inesperado sin detalles internos. El guard puede devolver `403` antes de validar ausencia de contexto si no hay permiso aplicable.
- Cada operación usa Serializable; ante conflicto de serialización se reintenta una vez la transacción completa. Catálogo y asociaciones se confirman o revierten juntos. No se modifica Prisma ni se añaden dependencias. RF-006/007 y el alcance HU-012 se implementan aquí; la creación/edición de Institution descrita por RF-005 no se añade a este contrato. No existe infraestructura de auditoría administrativa reutilizable; se conservan `createdAt`/`updatedAt` e historiales de dominio, sin inventar una bitácora paralela ni atribuirles auditoría de cambios de catálogo.
- E2E real: `npm run --workspace @citajusta/api test:e2e:catalog`. Requiere PostgreSQL local permitido y los catálogos de estado ya provisionados mediante los bootstrap existentes. Ejecutar secuencialmente con los demás E2E: comparte fixtures protegidos, limpia sólo datos de prueba y comprueba aislamiento, unicidad concurrente, rollback SQL y preservación de relaciones/historial.

## Variables de entorno

El backend valida su configuración al arrancar. Usa [apps/api/.env.example](apps/api/.env.example) como contrato y crea un archivo local `apps/api/.env` con valores propios del entorno.

```powershell
if (-not (Test-Path apps/api/.env)) {
  Copy-Item apps/api/.env.example apps/api/.env
}
```

No se deben versionar `.env`, credenciales, connection strings reales ni secretos JWT.

## Compilación y ejecución

```powershell
npm run --workspace @citajusta/api build
npm run --workspace @citajusta/api start
```

## Pruebas

Fundación web y comandos de desarrollo/validación: [apps/web/README.md](apps/web/README.md). Arranque local desde la raíz: `npm run --workspace @citajusta/web dev`. Home usa datos sintéticos señalizados; no inicia sesión ni consulta/reserva/cancela citas.

Suite unitaria, aislada de PostgreSQL:

```powershell
npm run --workspace @citajusta/api test
```

Checkpoint E2E real, separado de la suite unitaria:

```powershell
npm run --workspace @citajusta/api test:e2e:checkpoint
```

El checkpoint E2E requiere PostgreSQL local accesible, esquema vigente y variables de entorno válidas. No usa mocks de Prisma ni de HTTP.

E2E de HU-004, HU-005 y HU-006, después del bootstrap:

```powershell
npm run --workspace @citajusta/api test:e2e:appointments
```

Verifica reserva, concurrencia real y rollback mediante inyección controlada de fallo; también consulta propia, aislamiento por usuario, DTO público, ordenamiento, cancelación, historial, reintentos sin efectos y exclusión de cupos liberados de la disponibilidad pública. Ambos E2E comparten fixtures y deben ejecutarse secuencialmente sobre una base local permitida; limpian sus propios datos, incluidas cancelaciones, al finalizar.

## Docker

Dockerfile y Docker Compose son obligatorios para la entrega Capstone, pero todavía no existen. Su implementación y validación corresponden a una fase técnica posterior.

El Stack Tecnológico v0.1 trató Docker como tecnología no comprometida en esa versión. La pauta Capstone vigente supersede esa decisión y exige Docker; queda pendiente crear una versión actualizada del documento, sin modificar el DOCX original en esta revisión.

## Documentación

- [Arquitectura](docs/development/ARCHITECTURE.md)
- [Decisiones técnicas](docs/development/DECISIONS.md)
- [Entorno de desarrollo](docs/development/SETUP.md)
- [Compliance Capstone](docs/capstone/README.md)
- [Matriz de cumplimiento](docs/capstone/CAPSTONE_COMPLIANCE_MATRIX.md)
- [Inventario documental](docs/capstone/DOCUMENT_INVENTORY.md)
- [Checklist de publicación](docs/capstone/PUBLICATION_CHECKLIST.md)
- [Documento Base](<Fase 2/Evidencias Proyecto/Evidencias de documentación/Documento_Base_CitaJusta.docx>)
- [Justificación del Proyecto v0.1](<Fase 2/Evidencias Proyecto/Evidencias de documentación/CitaJusta_Justificacion_del_Proyecto_v0.1.docx>)
- [Requisitos Funcionales v0.1](<Fase 2/Evidencias Proyecto/Evidencias de documentación/CitaJusta_Requisitos_Funcionales_v0.1.docx>)
- [Arquitectura de Software v0.1](<Fase 2/Evidencias Proyecto/Evidencias de documentación/CitaJusta_Arquitectura_de_Software_v0.1.docx>)
- [Arquitectura APIs v0.1](<Fase 2/Evidencias Proyecto/Evidencias de documentación/CitaJusta_Arquitectura_APIs_v0.1.docx>)
- [Stack Tecnológico v0.1](<Fase 2/Evidencias Proyecto/Evidencias de documentación/CitaJusta_Stack_Tecnologico_v0.1.docx>)

## Estructura Capstone

- [Fase 1](<Fase 1/README.md>)
- [Fase 2](<Fase 2/README.md>)
- [Fase 3](<Fase 3/README.md>)

Los formularios, guías y planillas oficiales deben ser incorporados desde su fuente docente; este repositorio no genera sustitutos.

## Licencia

Pendiente de definición para el cierre académico y para establecer términos de reutilización. Mientras no exista una licencia, no se concede permiso explícito de reutilización; esta brecha se controla como pendiente final y no como requisito técnico para evidenciar avance incremental.
