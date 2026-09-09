# Inventario documental

**Proyecto:** CitaJusta
**Fecha de actualización:** 9 de septiembre de 2026
**Estado:** VIGENTE / EN ACTUALIZACIÓN DOCUMENTAL

Este inventario registra los documentos, artefactos técnicos y evidencias académicas actualmente presentes o preparados para el proyecto CitaJusta. La versión anterior correspondía al 3 de septiembre de 2026 y quedó desactualizada después de la implementación de la aplicación web, la integración con la API, la ampliación de pruebas y el uso real de GitHub Projects, Issues y Pull Requests.

## Documentos y artefactos técnicos vigentes

| Nombre | Ruta | Propósito | Estado actual | Requiere actualización |
| --- | --- | --- | --- | --- |
| Memoria operativa | `AGENTS.md` | Reglas para agentes, arquitectura, seguridad y trabajo incremental | VIGENTE COMO APOYO | Sí; revisar referencias de estado inicial y scripts cuando corresponda |
| Arquitectura | `docs/development/ARCHITECTURE.md` | Arquitectura, dominios y flujo crítico | PARCIAL / REUTILIZABLE | Sí; diferenciar con claridad estado implementado y objetivo |
| Decisiones técnicas | `docs/development/DECISIONS.md` | Decisiones de stack y arquitectura | PARCIAL / REUTILIZABLE | Sí; incorporar decisiones posteriores y Docker cuando se implemente |
| Entorno de desarrollo | `docs/development/SETUP.md` | Instalación y configuración local | PARCIAL / REUTILIZABLE | Sí; alinear con Node, PostgreSQL, workspaces y flujo actual |
| Plantilla API | `apps/api/.env.example` | Variables de entorno ficticias del backend | VIGENTE | Mantener al agregar nuevas variables |
| Plantilla Web | `apps/web/.env.example` | Configuración del frontend y proxy local | VIGENTE | Mantener al agregar nuevas variables |
| README Web | `apps/web/README.md` | Uso y estado de la aplicación web | VIGENTE | Mantener junto con nuevas funcionalidades |
| Prisma schema | `apps/api/prisma/schema.prisma` | Modelo de datos relacional | IMPLEMENTADO | Mantener trazabilidad con ER y normalización |
| Migraciones Prisma | `apps/api/prisma/migrations/` | Evolución versionada de la base de datos | IMPLEMENTADO | Mantener por cada cambio estructural |
| Aplicación Web | `apps/web/` | Frontend React/Vite integrado con la API | IMPLEMENTADO Y VALIDADO | Continuar con nuevas historias |
| API Backend | `apps/api/` | Backend NestJS, seguridad, catálogos, citas y persistencia | IMPLEMENTADO Y VALIDADO | Continuar con HU pendientes |

## Documentos académicos incorporados

| Nombre | Ruta | Versión | Estado | Actualización necesaria |
| --- | --- | --- | --- | --- |
| Documento Base CitaJusta | `Fase 2/Evidencias Proyecto/Evidencias de documentación/Documento_Base_CitaJusta.docx` | No declarada; indica “Versión base” | PARCIAL | Agregar versión, fecha, autores y reconciliar contenido con implementación real |
| Justificación del Proyecto | `Fase 2/Evidencias Proyecto/Evidencias de documentación/CitaJusta_Justificacion_del_Proyecto_v0.1.docx` | 0.1, 23-08-2026 | PARCIAL | Validar integrantes, aprobar versión y enlazar evidencia real |
| Requisitos Funcionales | `Fase 2/Evidencias Proyecto/Evidencias de documentación/CitaJusta_Requisitos_Funcionales_v0.1.docx` | 0.1, 24-08-2026 | PARCIAL | Agregar criterios de aceptación y trazabilidad con HU, Sprint y pruebas |
| Arquitectura de Software | `Fase 2/Evidencias Proyecto/Evidencias de documentación/CitaJusta_Arquitectura_de_Software_v0.1.docx` | 0.1, 25-08-2026 | PARCIAL | Actualizar contra el estado real de Web, API, BD y pruebas |
| Arquitectura APIs | `Fase 2/Evidencias Proyecto/Evidencias de documentación/CitaJusta_Arquitectura_APIs_v0.1.docx` | 0.1, 25-08-2026 | PARCIAL | Separar endpoints implementados y planificados; enlazar pruebas |
| Stack Tecnológico | `Fase 2/Evidencias Proyecto/Evidencias de documentación/CitaJusta_Stack_Tecnologico_v0.1.docx` | 0.1, 25-08-2026 | PARCIAL | Actualizar tecnologías efectivamente implementadas y exigencias Docker |

Los seis DOCX continúan siendo evidencia útil, pero no deben considerarse versiones finales mientras conserven decisiones superadas o contenido aspiracional no reconciliado con el código actual.

## Documentos de control Capstone

| Nombre | Ruta | Propósito | Estado al 09-09-2026 |
| --- | --- | --- | --- |
| Guía Capstone | `docs/capstone/README.md` | Organización y criterios de cumplimiento | REQUIERE REVISIÓN |
| Matriz de cumplimiento | `docs/capstone/CAPSTONE_COMPLIANCE_MATRIX.md` | Trazar requisitos, evidencia y brechas | REQUIERE ACTUALIZACIÓN |
| Inventario documental | `docs/capstone/DOCUMENT_INVENTORY.md` | Registrar documentos y faltantes | ACTUALIZADO EN ESTA REVISIÓN |
| Checklist de publicación | `docs/capstone/PUBLICATION_CHECKLIST.md` | Seguridad, publicación y preparación de entrega | ACTUALIZADO EN ESTA REVISIÓN |
| Evidencia Scrum con GitHub | `docs/capstone/GITHUB_SCRUM_EVIDENCE.md` | Trazabilidad con Issues, Project, branches y PR | ACTUALIZADO EN ESTA REVISIÓN |

## Evidencia técnica verificable

La documentación debe mantenerse alineada con la siguiente evidencia real:

| Evidencia | Resultado |
| --- | --- |
| Backend tests | 114/114 PASS |
| E2E appointments | 22/22 PASS |
| Checkpoint E2E backend | 1/1 PASS |
| Web tests | 39/39 PASS |
| Web typecheck | PASS |
| Web build | PASS |
| Web/API/PostgreSQL E2E | 13/13 PASS |
| Flujo manual | Registro → Login → Catálogos → Disponibilidad → Reserva → Confirmación → Mis citas → Cancelación → Logout |
| Integración Web | PR #43 mergeado a `main` |

## Evidencia Scrum y GitHub

El estado actual ya no corresponde a una propuesta de uso futuro. El proyecto utiliza:

- GitHub Issues para historias y tareas.
- GitHub Projects como Kanban.
- Columnas `Backlog`, `Ready`, `In Progress`, `Review`, `Testing` y `Done`.
- Branches por funcionalidad o tarea.
- Pull Requests para revisión e integración.
- Resultados de pruebas como evidencia previa al merge.

La integración web fue desarrollada en `feat/web-api-integration` e incorporada mediante el Pull Request #43.

## Estructura académica existente

| Ruta | Propósito | Estado |
| --- | --- | --- |
| `Fase 1/Evidencias Individuales/` | Entregables personales de Fase 1 | ESTRUCTURA PRESENTE |
| `Fase 1/Evidencias Grupales/` | Planificación y entregables grupales de Fase 1 | ESTRUCTURA PRESENTE / EVIDENCIA POR INCORPORAR |
| `Fase 2/Evidencias Individuales/` | Entregables personales de Fase 2 | ESTRUCTURA PRESENTE |
| `Fase 2/Evidencias Grupales/` | Seguimiento, Scrum, pruebas y avance grupal | ESTRUCTURA PRESENTE / EVIDENCIA POR INCORPORAR |
| `Fase 2/Evidencias Proyecto/Evidencias de documentación/` | Arquitectura, requisitos, diseño, manuales y diagramas | CONTIENE 6 DOCX TÉCNICOS |
| `Fase 2/Evidencias Proyecto/Evidencias de sistema/Aplicación/` | Evidencia de Web, Desktop, Docker y pruebas | ESTRUCTURA PRESENTE / DEBE ACTUALIZARSE |
| `Fase 2/Evidencias Proyecto/Evidencias de sistema/Base de datos/` | Evidencia de BD, ER, migraciones y normalización | ESTRUCTURA PRESENTE / DEBE ACTUALIZARSE |
| `Fase 3/Evidencias Individuales/` | Evidencia personal final | ESTRUCTURA PRESENTE |
| `Fase 3/Evidencias Grupales/` | Cierre y presentación final | ESTRUCTURA PRESENTE |

Los README de estructura no constituyen por sí solos evidencia de cumplimiento.

## Documentos académicos preparados y aún por incorporar al repositorio

A la fecha existen versiones de trabajo preparadas fuera de la estructura versionada y deben incorporarse en una pasada documental controlada:

| Documento | Estado | Destino propuesto |
| --- | --- | --- |
| Declaración de Nivel de Avance | PREPARADO / PENDIENTE DE INCORPORAR | Evidencia académica correspondiente |
| Acta de Constitución del Proyecto | DISPONIBLE SEGÚN DOCUMENTACIÓN DEL EQUIPO / REVISAR VERSIÓN | `Fase 1/Evidencias Grupales/` |
| Alcances del Proyecto | PREPARADO / PENDIENTE DE INCORPORAR | `Fase 1/Evidencias Grupales/` |
| Product Backlog priorizado | PREPARADO / PENDIENTE DE INCORPORAR | `Fase 1/Evidencias Grupales/` |
| Sprint Backlog Sprint 4 | EXISTENTE COMO EVIDENCIA HISTÓRICA / PENDIENTE DE INCORPORAR | Evidencias grupales de la fase correspondiente |
| Sprint Backlog Sprint 5 | PREPARADO / PENDIENTE DE INCORPORAR | `Fase 2/Evidencias Grupales/` |
| Burndown Sprint 4 | PREPARADO / PENDIENTE DE INCORPORAR | `Fase 2/Evidencias Grupales/` |
| Release Plan | PREPARADO / PENDIENTE DE INCORPORAR | `Fase 2/Evidencias Grupales/` |
| Revisión Daily Meeting | PREPARADO / PENDIENTE DE INCORPORAR | `Fase 2/Evidencias Grupales/` |
| Registro Daily Scrum | PLANTILLA DISPONIBLE; SIN DATOS INVENTADOS | `Fase 2/Evidencias Grupales/` |

## Pendientes documentales y técnicos

| Documento / Evidencia | Estado | Destino propuesto |
| --- | --- | --- |
| Product Vision formal | PENDIENTE DE INCORPORAR O FORMALIZAR | `Fase 1/Evidencias Grupales/` |
| Definition of Done | PENDIENTE DE FORMALIZAR | `Fase 1/Evidencias Grupales/` |
| Retrospectiva por sprint | PENDIENTE | Evidencias grupales de la fase correspondiente |
| Plan y evidencia de pruebas por sprint | PARCIAL; existen pruebas, falta consolidación académica | `Fase 2/Evidencias Grupales/` |
| Documento de diseño consolidado | PENDIENTE | Evidencias de documentación de Fase 2 |
| Manual técnico completo | PENDIENTE | Evidencias de documentación de Fase 2 |
| Modelo ER formal | PENDIENTE; el modelo relacional sí existe | Evidencias de documentación / Base de datos |
| Evidencia de normalización | PENDIENTE | Evidencias de documentación / Base de datos |
| UML de casos de uso | PENDIENTE | Evidencias de documentación de Fase 2 |
| UML de clases | PENDIENTE | Evidencias de documentación de Fase 2 |
| UML de secuencia | PENDIENTE | Evidencias de documentación de Fase 2 |
| UML de componentes | PENDIENTE | Evidencias de documentación de Fase 2 |
| Requisitos no funcionales medibles | PENDIENTE DE CONSOLIDAR | Evidencias de documentación de Fase 2 |
| Informe de rendimiento | PENDIENTE | Evidencias de pruebas de Fase 2 |
| Evaluación de seguridad dedicada | PARCIAL; existen pruebas de seguridad, falta informe consolidado | Evidencias de pruebas de Fase 2 |
| Aplicación de escritorio | PENDIENTE DE IMPLEMENTAR | Evidencia de sistema |
| Dockerfile | PENDIENTE DE IMPLEMENTAR | Evidencia de sistema |
| Docker Compose | PENDIENTE DE IMPLEMENTAR | Evidencia de sistema |
| HU-007 Lista de espera | PENDIENTE | Código + evidencia Sprint |
| HU-008 Preferencias | PENDIENTE | Código + evidencia Sprint |
| HU-009 Ofertas / reasignación | PENDIENTE | Código + evidencia Sprint |
| Evidencia funcional de innovación | PARCIAL | Evidencia de documentación y sistema |
| Presentación final | PENDIENTE | `Fase 3/Evidencias Grupales/` |
| Licencia | PENDIENTE DE DEFINIR | Raíz |
| Guías y documentos oficiales del docente | PENDIENTE SEGÚN ENTREGA | Ubicación indicada por el docente |

## Consistencia documental

Los documentos v0.1 identifican como integrantes a Matías Andrés Torres, Bastian Sepúlveda y Diego Simon. Esa nómina debe mantenerse consistente en los documentos académicos que corresponda.

Las siguientes reglas deben respetarse al actualizar evidencia:

1. No presentar funcionalidades futuras como implementadas.
2. Distinguir evidencia técnica real de documentación de diseño.
3. No inventar reuniones, retrospectivas, acuerdos ni responsables.
4. Mantener las cifras de pruebas alineadas con la última ejecución validada.
5. No versionar secretos ni archivos `.env`.
6. Actualizar este inventario cada vez que se incorporen entregables importantes.

## Próxima actualización recomendada

Después de incorporar los documentos académicos preparados y actualizar `CAPSTONE_COMPLIANCE_MATRIX.md`, volver a revisar este inventario para cambiar cada elemento de `PENDIENTE DE INCORPORAR` a su estado real y dejar trazabilidad de la versión efectivamente almacenada en el repositorio.
