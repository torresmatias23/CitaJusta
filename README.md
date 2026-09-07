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
| API backend | En desarrollo: salud, autenticación/sesiones, base RBAC, catálogos, consulta de disponibilidad, reserva directa transaccional (HU-004) y consulta de mis citas (HU-005) |
| Persistencia | PostgreSQL y Prisma; 37 modelos y migraciones versionadas |
| Aplicación web | Pendiente; `apps/web` aún no existe |
| Aplicación de escritorio | Pendiente; `apps/desktop` aún no existe |
| Docker | Obligatorio para Capstone, pendiente de implementación |
| Funciones críticas de citas, lista de espera y reasignación | Modelado de base presente; implementación funcional incompleta |
| Documentación académica | Seis DOCX reales incorporados; revisión, trazabilidad y actualización pendientes |

## Tecnologías

- Monorepo con npm workspaces.
- NestJS y TypeScript para la API REST.
- PostgreSQL con Prisma ORM.
- JWT Access Token y Refresh Token; base de autorización RBAC.
- React, Vite y TypeScript planificados para web.
- Tauri, React y TypeScript planificados para escritorio.
- Git y GitHub.

## Arquitectura resumida

```text
Web React/Vite (pendiente) ---------\
                                      > API REST NestJS -> Prisma -> PostgreSQL
Desktop Tauri/React (pendiente) ----/
```

Web y escritorio consumirán el mismo backend. La autenticación, autorización, aislamiento institucional, disponibilidad y futuras transiciones de reservas, ofertas y reasignaciones deben resolverse en el backend.

La API funcional usa el prefijo `/api/v1`; el endpoint técnico `GET /health` permanece sin prefijo.

HU-004: `POST /api/v1/appointments` requiere Bearer token y recibe únicamente `{ "agendaSlotId": "UUID" }`. Devuelve `201` con `{ data: { id, agendaSlotId, institutionId, branchId, serviceId, professionalId, startsAt, endsAt, origin, status } }`. El backend fija usuario, origen `WEB` y estado `AGENDADA`; un conflicto de disponibilidad/concurrencia devuelve `409`. No ofrece aún cancelación.

HU-005: `GET /api/v1/appointments/me` requiere Bearer token. No admite campos de query ni body (`400`); el usuario se obtiene exclusivamente del principal autenticado (`401` sin autenticación válida). Devuelve `200` con `{ data: [{ id, institutionId, status, startsAt, endsAt, origin, branch: { id, name }, service: { id, name }, professional: { id, firstNames, lastNames } }] }`, o `{ data: [] }`. `status` es el código almacenado; fechas ISO 8601 UTC. Orden: `startsAt ASC, id ASC`, sin paginación ni filtro temporal. Incluye citas propias pasadas y futuras sin cambiar estados; excluye citas eliminadas lógicamente y relaciones institucionales incoherentes. Conserva el historial aunque los catálogos estén inactivos. Los headers institucionales no seleccionan otro usuario ni amplían el acceso.

## Estructura del monorepo

```text
apps/
  api/          # backend implementado
  web/          # pendiente
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

El bootstrap es idempotente por código `AGENDADA` y conserva toda configuración existente. Omite `allowsConfirmation`, cuyo default del modelo es `false`. El endpoint no ejecuta el bootstrap: si el estado falta, está inactivo o es final, responde `503`.

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

Suite unitaria, aislada de PostgreSQL:

```powershell
npm run --workspace @citajusta/api test
```

Checkpoint E2E real, separado de la suite unitaria:

```powershell
npm run --workspace @citajusta/api test:e2e:checkpoint
```

El checkpoint E2E requiere PostgreSQL local accesible, esquema vigente y variables de entorno válidas. No usa mocks de Prisma ni de HTTP.

E2E de HU-004 y HU-005, después del bootstrap:

```powershell
npm run --workspace @citajusta/api test:e2e:appointments
```

Verifica reserva, concurrencia real y rollback mediante inyección controlada de fallo en el historial; también consulta propia, aislamiento por usuario, DTO público, ordenamiento y ausencia de escrituras al consultar. Ambos E2E comparten fixtures y deben ejecutarse secuencialmente sobre una base local permitida; limpian sus propios datos al finalizar.

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
