# Matriz de cumplimiento Capstone

**Proyecto:** CitaJusta
**Fecha de actualización:** 9 de septiembre de 2026
**Estado:** VIGENTE / AVANCE INCREMENTAL

Esta matriz refleja el estado real del proyecto al 9 de septiembre de 2026. Se distingue entre evidencia técnica implementada, documentación académica ya versionada y artefactos preparados pero aún pendientes de incorporación al repositorio. Una funcionalidad parcial no se marca como completa sólo por existir código o documentación.

| Requisito | Obligatorio | Estado | Documento/Evidencia existente | Ubicación actual | Ubicación académica objetivo | Acción pendiente | Prioridad |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Documento Base | Sí | PARCIAL | Documento maestro real, pero sin versión formal consolidada y con contenido que debe reconciliarse con el estado actual | `Fase 2/Evidencias Proyecto/Evidencias de documentación/Documento_Base_CitaJusta.docx` | Evidencias de formulación y documentación | Versionar, actualizar arquitectura/rutas/modelo y validar responsables | ALTA |
| Justificación del proyecto | Sí | PARCIAL | Borrador 0.1 con problema, beneficiarios, valor, innovación y pertinencia académica | `Fase 2/Evidencias Proyecto/Evidencias de documentación/CitaJusta_Justificacion_del_Proyecto_v0.1.docx` | Evidencias de formulación y documentación | Aprobar versión y enlazarla con alcance y evidencia vigente | ALTA |
| Product Vision | Sí | PARCIAL | Contenido reutilizable en README, Documento Base y Justificación; artefacto formal aún no consolidado | `README.md` y DOCX existentes | `Fase 1/Evidencias Grupales/` | Formalizar y versionar la Product Vision | ALTA |
| Requisitos funcionales | Sí | PARCIAL | RF-001 a RF-038 documentados y parte relevante ya implementada | `Fase 2/Evidencias Proyecto/Evidencias de documentación/CitaJusta_Requisitos_Funcionales_v0.1.docx` | Evidencias de documentación y fuente del Product Backlog | Agregar trazabilidad RF → HU/PBI → Sprint → prueba → evidencia | ALTA |
| Product Backlog priorizado | Sí | PARCIAL | Artefacto actualizado preparado fuera del repositorio; GitHub Issues/Project contienen trazabilidad real | Pendiente de incorporar | `Fase 1/Evidencias Grupales/` | Incorporar versión vigente y mantenerla alineada con GitHub Project | ALTA |
| Sprint Backlog | Sí | PARCIAL | Sprint 4 histórico y Sprint 5 preparados; GitHub Project refleja tareas reales | Pendiente de incorporar | Evidencias grupales de la fase correspondiente | Incorporar los Sprint Backlogs preparados y actualizar Sprint 5 tras cierre de T05/T08 | ALTA |
| Definition of Done | Sí | FALTA | Existen prácticas de validación, pero no artefacto formal aprobado | — | `Fase 1/Evidencias Grupales/` | Formalizar criterios verificables de Done | ALTA |
| Documento de diseño | Sí | PARCIAL | Arquitectura, API, stack, decisiones y schema reutilizables | `docs/development/`, DOCX y `apps/api/prisma/schema.prisma` | `Fase 2/Evidencias Proyecto/Evidencias de documentación/` | Consolidar diseño académico vigente y separar implementado de futuro | ALTA |
| Retrospectivas | Sí | FALTA | No existe evidencia formal incorporada | — | Evidencias grupales de cada sprint | Incorporar retrospectivas reales; no inventar reuniones | MEDIA |
| Plan de pruebas por sprint | Sí | PARCIAL | Existen pruebas y resultados reales, pero falta consolidación académica por sprint | `apps/api/test/`, `apps/web/test/` | `Fase 2/Evidencias Grupales/` | Crear plan/resultados por sprint y trazar a HU/tareas | ALTA |
| Manual técnico | Sí | PARCIAL | Setup, arquitectura, decisiones, README raíz y README web | `docs/development/`, `README.md`, `apps/web/README.md` | `Fase 2/Evidencias Proyecto/Evidencias de documentación/` | Consolidar instalación limpia, BD, API, Web, diagnóstico y operación | ALTA |
| Arquitectura de software | Sí | PARCIAL | Documento técnico y DOCX v0.1; backend y web ya implementados parcialmente | `docs/development/ARCHITECTURE.md` y DOCX v0.1 | `Fase 2/Evidencias Proyecto/Evidencias de documentación/` | Actualizar contra el estado real Web/API/BD y enlazar pruebas | ALTA |
| Arquitectura de APIs | Sí | PARCIAL | API REST propia bajo `/api/v1` implementada con Auth, catálogos, disponibilidad y citas | `apps/api/src/` y DOCX v0.1 | `Fase 2/Evidencias Proyecto/Evidencias de documentación/` | Separar endpoints implementados de planificados y consolidar contratos | ALTA |
| Stack tecnológico | Sí | PARCIAL | Stack implementado: React/Vite, NestJS, Prisma, PostgreSQL, TypeScript; Docker sigue pendiente | Código, `package.json`, DOCX v0.1 | `Fase 2/Evidencias Proyecto/Evidencias de documentación/` | Crear versión actualizada e incorporar Docker cuando se implemente | ALTA |
| Modelo ER | Sí | PARCIAL | Modelo relacional implementado con 37 modelos Prisma; falta diagrama ER formal | `apps/api/prisma/schema.prisma` | Evidencias de documentación/Base de datos | Crear diagrama ER con cardinalidades y claves | ALTA |
| UML casos de uso | Sí | FALTA | No existe evidencia formal | — | `Fase 2/Evidencias Proyecto/Evidencias de documentación/` | Elaborar desde requisitos vigentes | ALTA |
| UML clases | Sí | FALTA | No existe evidencia formal | — | `Fase 2/Evidencias Proyecto/Evidencias de documentación/` | Elaborar representación coherente con el diseño | ALTA |
| UML secuencia | Sí | FALTA | Existen flujos técnicos textuales, pero no UML formal | `docs/development/ARCHITECTURE.md` | `Fase 2/Evidencias Proyecto/Evidencias de documentación/` | Crear secuencias de casos críticos | ALTA |
| UML componentes | Sí | FALTA | Existe representación arquitectónica técnica, no UML formal | `docs/development/ARCHITECTURE.md` | `Fase 2/Evidencias Proyecto/Evidencias de documentación/` | Crear UML de componentes | MEDIA |
| Requisitos no funcionales | Sí | PARCIAL | Seguridad, integridad, validación, rate limit, CORS y calidad descritos/implementados parcialmente | `AGENTS.md`, `docs/development/ARCHITECTURE.md`, código y DOCX | Evidencias de documentación | Consolidarlos como requisitos medibles y trazables | ALTA |
| Evidencia de normalización | Sí | FALTA | Modelo relacional implementado, pero no existe justificación formal de formas normales | — | Evidencias de documentación/Base de datos | Documentar análisis de normalización | ALTA |
| Dockerfile | Sí | FALTA | No existe | — | `Fase 2/Evidencias Proyecto/Evidencias de sistema/Aplicación/` | Implementar, validar y documentar | ALTA |
| Docker Compose | Sí | FALTA | No existe | — | `Fase 2/Evidencias Proyecto/Evidencias de sistema/` | Orquestar servicios y documentar uso | ALTA |
| Variables de entorno | Sí | COMPLETO | Plantillas ficticias, validación runtime y archivos locales ignorados | `apps/api/.env.example`, `apps/web/.env.example`, validación backend | Manual técnico y evidencia de aplicación | Mantener sin secretos y actualizar al agregar variables | ALTA |
| README | Sí | PARCIAL | README raíz, README web y navegación técnica presentes | `README.md`, `apps/web/README.md` | Raíz del repositorio | Completar identidad/roles, licencia y estado final de entrega | ALTA |
| Identidad y roles del equipo | Sí | PARCIAL | Nómina consistente en documentos v0.1: Matías Andrés Torres, Bastian Sepúlveda y Diego Simon; roles aún requieren consolidación | DOCX y README | README y entregables académicos | Validar y unificar roles en todos los documentos | ALTA |
| Pruebas automatizadas backend | Sí | COMPLETO | 114/114 pruebas backend PASS para el alcance implementado | `apps/api/test/` | Evidencias de pruebas por sprint | Mantener verdes y registrar resultados por sprint | ALTA |
| Pruebas automatizadas web | Sí | COMPLETO | 39/39 pruebas web PASS; typecheck y build PASS | `apps/web/test/` | Evidencias de pruebas por sprint | Mantener verdes y ampliar junto a nuevas HU | ALTA |
| Pruebas integración/E2E | Sí | COMPLETO PARA ALCANCE ACTUAL | 22/22 E2E appointments, 1/1 checkpoint backend y 13/13 Web/API/PostgreSQL PASS | `apps/api/test/e2e/`, `apps/web/test/e2e/` | Evidencias de sistema/pruebas | Ampliar cuando se implementen HU-007, HU-008 y HU-009 | ALTA |
| Pruebas rendimiento | Sí | FALTA | No existe evidencia dedicada | — | Evidencias de pruebas de Fase 2 | Definir métricas, herramienta, carga y resultados | MEDIA |
| Pruebas seguridad | Sí | PARCIAL | Tests de Auth, JWT, sesión, guards, RBAC y manejo de errores | `apps/api/test/`, `apps/web/test/` | Evidencias de pruebas por sprint | Crear plan e informe específico de seguridad | ALTA |
| Innovación | Sí | PARCIAL | Lista de espera, scoring y reasignación están justificadas/modeladas, pero HU-007/008/009 siguen pendientes | Justificación, arquitectura y Prisma schema | Evidencias de documentación/sistema | Implementar y demostrar flujo funcional de innovación | ALTA |
| Aplicación Web | Sí | PARCIAL | React/Vite implementado e integrado con API real: registro, login, catálogos, disponibilidad, reserva, Mis citas y cancelación | `apps/web/` | `Fase 2/Evidencias Proyecto/Evidencias de sistema/Aplicación/` | Incorporar evidencia académica y completar funcionalidades futuras del alcance | ALTA |
| Aplicación Escritorio | Sí | FALTA | No existe `apps/desktop` funcional | — | `Fase 2/Evidencias Proyecto/Evidencias de sistema/Aplicación/` | Implementar cliente de escritorio y probarlo | ALTA |
| BD relacional >= 30 tablas | Sí | COMPLETO | PostgreSQL con 37 modelos Prisma y migraciones versionadas | `apps/api/prisma/` | Evidencias de sistema/Base de datos | Mantener trazabilidad con ER, normalización y despliegue | ALTA |
| 5 APIs / al menos 2 propias | Por confirmar | PENDIENTE_DOCENTE | Existe una API REST propia central con múltiples endpoints; esto no acredita por sí solo cinco APIs distintas | `apps/api/src/` y DOCX APIs | Evidencias de documentación | Confirmar formalmente el criterio con el docente | ALTA |
| GitHub público | Sí | COMPLETO | Repositorio remoto operativo; `pull`, `push` y Pull Requests reales validados | GitHub `torresmatias23/CitaJusta` | URL de entrega | Verificar nuevamente acceso público sin login antes de entrega oficial | ALTA |
| Trazabilidad Scrum con GitHub | Sí | COMPLETO PARA ALCANCE ACTUAL | Issues, GitHub Project/Kanban, branches y Pull Requests utilizados realmente | GitHub + `docs/capstone/GITHUB_SCRUM_EVIDENCE.md` | Evidencias grupales | Mantener tablero y documentos académicos sincronizados | ALTA |
| Evidencias individuales | Sí | FALTA | Existe estructura, pero no entregables individuales reales incorporados en esta revisión | `Fase 1/`, `Fase 2/`, `Fase 3/` | `Evidencias Individuales/` | Incorporar documentos reales cuando corresponda | ALTA |
| Evidencias grupales | Sí | PARCIAL | GitHub contiene evidencia real y existen artefactos académicos preparados, aún pendientes de incorporar | GitHub + archivos preparados fuera del repo | `Evidencias Grupales/` | Incorporar Product Backlog, Sprint Backlogs, Burndown, Release, Daily y otros | ALTA |
| Documentos oficiales del profesor | Sí | PENDIENTE_DOCENTE | Sólo deben incorporarse originales proporcionados por docente/equipo | — | Ubicación indicada por el docente | Incorporar originales; no fabricar sustitutos | ALTA |
| Presentación final | Sí | PARCIAL | Existe versión de trabajo preparada, aún no corresponde a entrega final | Fuera del repo / pendiente de incorporar | `Fase 3/Evidencias Grupales/` | Actualizar al cierre y versionar cuando corresponda | MEDIA |
| Licencia | Por confirmar | FALTA | No existe | — | Raíz | Definir titularidad y condiciones de reutilización | MEDIA |
| Integración continua | No especificado | FALTA | No existe automatización CI versionada | — | Evidencia de sistema de Fase 2 | Evaluar e implementar si aporta valor al cierre técnico | MEDIA |

## Avance técnico relevante al 9 de septiembre de 2026

La línea base del 3 de septiembre quedó superada por los siguientes avances:

- Aplicación Web implementada en `apps/web`.
- Registro, login, restauración de sesión, logout y rutas protegidas.
- Catálogos de instituciones, sedes y servicios.
- Consulta de disponibilidad.
- Reserva de citas.
- Confirmación y listado de citas propias.
- Cancelación de citas.
- Integración real Web → API → PostgreSQL.
- Pull Request #43 mergeado a `main`.
- 114/114 pruebas backend PASS.
- 39/39 pruebas web PASS.
- 22/22 E2E de appointments PASS.
- 1/1 checkpoint E2E backend PASS.
- 13/13 E2E Web/API/PostgreSQL PASS.
- Flujo manual validado de punta a punta.
- Uso real de Issues, GitHub Projects/Kanban, branches y Pull Requests.

## Brechas principales abiertas

Las principales brechas para el cumplimiento final son:

1. Formalizar Definition of Done, Product Vision y consolidar Product/Sprint Backlogs en el repositorio.
2. Incorporar artefactos grupales preparados: Burndown, Release Plan, Daily Meeting y otros.
3. Actualizar los DOCX técnicos v0.1.
4. Completar documento de diseño y manual técnico.
5. Crear ER formal, UML requeridos y evidencia de normalización.
6. Implementar Dockerfile y Docker Compose.
7. Implementar aplicación de escritorio.
8. Implementar HU-007, HU-008 y HU-009 para completar el componente innovador de lista de espera/reasignación.
9. Preparar pruebas de rendimiento y un informe dedicado de seguridad.
10. Confirmar con el docente el criterio “5 APIs / al menos 2 propias”.
11. Incorporar evidencias individuales y documentación oficial cuando corresponda.
12. Definir licencia si es requerida para el cierre.

## Criterio de actualización

Esta matriz debe actualizarse después de cada hito importante. Los estados `COMPLETO` sólo deben utilizarse cuando exista evidencia verificable; `COMPLETO PARA ALCANCE ACTUAL` indica que la evidencia satisface lo implementado hasta la fecha, pero deberá ampliarse cuando se incorporen nuevas funcionalidades.
