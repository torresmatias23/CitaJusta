# Evidencia Scrum con GitHub

**Proyecto:** CitaJusta
**Fecha de actualización:** 9 de septiembre de 2026
**Estado:** VIGENTE / EN USO

## Objetivo

Utilizar GitHub como fuente de trazabilidad del trabajo del proyecto CitaJusta, vinculando planificación, desarrollo, revisión, pruebas y cierre de tareas e historias de usuario.

La evidencia se mantiene a través de Issues, GitHub Projects, ramas, Pull Requests y resultados de pruebas. Esta trazabilidad complementa los documentos académicos de Product Backlog, Sprint Backlog, Daily Meeting, Burndown y Release Plan.

## Uso actual de GitHub

| Recurso | Uso en CitaJusta | Estado |
| --- | --- | --- |
| GitHub Issues | Historias de usuario, tareas técnicas y seguimiento del trabajo | EN USO |
| GitHub Projects | Kanban del proyecto con estados Backlog, Ready, In Progress, Review, Testing y Done | EN USO |
| Branches | Desarrollo aislado por funcionalidad o tarea | EN USO |
| Pull Requests | Revisión e integración de cambios hacia `main` | EN USO |
| Commits | Registro incremental de implementación y correcciones | EN USO |
| Checks / tests | Evidencia técnica de validación antes de integrar cambios | EN USO |
| Milestones | Agrupación opcional por sprint o release | PENDIENTE / NO UTILIZADO COMO FUENTE PRINCIPAL |

## Flujo de trazabilidad aplicado

```text
Historia de usuario o tarea
-> Issue / tarjeta en GitHub Project
-> Estado del Kanban
-> Branch de trabajo
-> Implementación y pruebas
-> Pull Request
-> Revisión / validación
-> Merge a main
-> Done
```

Este flujo permite relacionar el avance técnico con la planificación Scrum y mantener evidencia verificable de lo realizado.

## Kanban del proyecto

El proyecto utiliza un tablero GitHub Projects con las siguientes columnas:

- Backlog
- Ready
- In Progress
- Review
- Testing
- Done

Las historias de usuario y tareas avanzan por estas columnas según su estado real. Una tarea sólo debe pasar a `Done` cuando su implementación y validación estén completas.

## Evidencia reciente

### Integración Web con API

La integración completa de la aplicación web con el backend fue desarrollada en la rama:

```text
feat/web-api-integration
```

y posteriormente integrada a `main` mediante:

```text
Pull Request #43 — feat: complete web api integration
```

El PR incorporó, entre otros elementos:

- registro e inicio de sesión;
- restauración y cierre de sesión;
- protección de rutas;
- catálogos de instituciones, sedes y servicios;
- consulta de disponibilidad;
- reserva de citas;
- confirmación de reserva;
- listado de citas propias;
- cancelación de citas;
- estados loading, empty y error;
- mejoras responsive y de accesibilidad.

### Validación registrada

Antes del merge se verificó:

- Web typecheck: PASS
- Web tests: 39/39 PASS
- Web build: PASS
- Web/API/PostgreSQL E2E: 13/13 PASS
- `git diff --check`: PASS
- Flujo manual completo: registro → login → búsqueda → disponibilidad → reserva → confirmación → Mis citas → cancelación → logout

Esta evidencia respalda el cierre de las tareas de integración frontend y E2E asociadas al Sprint 5.

## Convenciones de trabajo vigentes

- Cada historia o tarea relevante debe ser identificable en GitHub.
- Las ramas de desarrollo deben aislar el trabajo antes de integrarlo a `main`.
- Los Pull Requests deben resumir el alcance implementado y las validaciones realizadas.
- Las pruebas deben ejecutarse antes de integrar cambios.
- El Kanban debe reflejar el estado real del trabajo.
- Las tareas sólo se consideran terminadas cuando cumplen sus criterios técnicos y de validación.
- La documentación académica debe mantenerse alineada con la evidencia técnica existente en GitHub.
- Las retrospectivas, Sprint Backlogs, Burndown y demás artefactos Scrum se almacenan como evidencia académica en las carpetas correspondientes del repositorio.

## Trazabilidad con documentación académica

GitHub no reemplaza los entregables formales del proyecto, sino que los complementa.

| Evidencia académica | Evidencia técnica relacionada |
| --- | --- |
| Product Backlog | Issues y GitHub Project |
| Sprint Backlog | Tarjetas seleccionadas para el sprint |
| Kanban | GitHub Project |
| Daily Meeting | Avance registrado y cambios de estado |
| Burndown | Progreso del Sprint Backlog |
| Release Plan | Historias y funcionalidades previstas por versión |
| Evidencia de pruebas | Tests ejecutados y resultados registrados |
| Evidencia de implementación | Branches, commits y Pull Requests |

## Estado actual

`IMPLEMENTADO Y EN USO`.

GitHub ya se utiliza como fuente real de trazabilidad del proyecto CitaJusta. Existen Issues, tablero Kanban, ramas de desarrollo y Pull Requests asociados al avance técnico. La estrategia descrita inicialmente dejó de ser sólo una propuesta y actualmente forma parte del flujo de trabajo del equipo.

Como mejora futura, se puede evaluar el uso de Milestones por sprint o release si aporta valor al seguimiento, sin duplicar innecesariamente la información ya mantenida en GitHub Projects y en la documentación académica.
