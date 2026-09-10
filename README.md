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

El bootstrap crea `ACTIVE` y `STANDARD` para cada institución activa/no eliminada. Sin instituciones sólo provisiona `ACTIVE`. Una prioridad nueva usa nombre `Estándar`, nivel `0` y `active: true`; es un valor base técnico, no una fórmula de scoring. Conserva identificadores, nombres y niveles compatibles ya configurados. Si `ACTIVE` está inactivo/final, `STANDARD` inactiva o el nivel `0` pertenece a otra prioridad, falla con rollback sin sobrescribir ni escoger otro nivel. No utiliza prioridades globales, cuyos UNIQUE con institución nula no garantizan unicidad. Los endpoints nunca ejecutan bootstrap. E2E usa PostgreSQL local permitido y fixtures identificados; ejecutar secuencialmente con los E2E de appointments/checkpoint.

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
