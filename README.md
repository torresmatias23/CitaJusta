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
| API backend | En desarrollo: salud, autenticación/sesiones, base RBAC, catálogos y consulta de disponibilidad |
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
