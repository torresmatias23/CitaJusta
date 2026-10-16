# Inventario documental

**Proyecto:** CitaJusta
**Fecha de actualización:** 16 de octubre de 2026
**Estado:** VIGENTE / EN ACTUALIZACIÓN DOCUMENTAL

Inventario de existencia y rutas contrastado con los README y la estructura real de Fase 2. INCORPORADO significa archivo presente, no contenido aprobado; PENDIENTE DE VALIDACIÓN requiere revisión académica; PENDIENTE DE ELABORACIÓN indica un entregable no localizado. Esta revisión no revalida código, documentos Office completos, servicios externos ni PostgreSQL. Se conservan los antecedentes de septiembre y del 04-10-2026.

El 70% general y 80% técnico son estimaciones informadas por el equipo, no mediciones definitivas ni un porcentaje de cumplimiento calculado desde esta tabla. HU-039 a HU-042 tienen Issues cerradas y PR fusionadas según el estado confirmado del proyecto; no se realizó auditoría remota en este corte. HU-043 queda excluida; Resend V2 continúa local, sin publicación confirmada.

## Documentos y artefactos técnicos vigentes

| Nombre | Ruta | Propósito | Estado actual | Requiere actualización |
| --- | --- | --- | --- | --- |
| Memoria operativa | `AGENTS.md` | Reglas para agentes, arquitectura, seguridad y trabajo incremental | VIGENTE COMO APOYO | Sí; revisar referencias de estado inicial y scripts cuando corresponda |
| README raíz y Fase 2 | [README raíz](../../README.md) y [Fase 2](<../../Fase 2/README.md>) | Estado y navegación de evidencias | SINCRONIZADOS AL CORTE 16-10-2026 | Mantener trazabilidad; validar identidad/roles y licencia |
| Arquitectura | `docs/development/ARCHITECTURE.md` | Arquitectura, dominios, Desktop e integraciones | REFERENCIA TÉCNICA EXISTENTE | Mantener alineación con HU-039–042 y retiro de HU-043 |
| Decisiones técnicas | `docs/development/DECISIONS.md` | Decisiones de stack y arquitectura | ACTUALIZADO AL 04-10-2026 | Incluye Sprint 8/9; actualizar al implementar cada integración |
| Entorno de desarrollo | `docs/development/SETUP.md` | Instalación, Web, Desktop y configuración local | ACTUALIZADO AL 04-10-2026 | Mantener variables/tooling de nuevas integraciones sin secretos |
| Plantilla API | `apps/api/.env.example` | Variables de entorno ficticias del backend | VIGENTE | Mantener al agregar nuevas variables |
| Plantilla Web | `apps/web/.env.example` | Configuración del frontend y proxy local | VIGENTE | Mantener al agregar nuevas variables |
| README Web | `apps/web/README.md` | Uso y estado de la aplicación web | VIGENTE | Mantener junto con nuevas funcionalidades |
| Prisma schema | `apps/api/prisma/schema.prisma` | Modelo de datos relacional | IMPLEMENTADO | Mantener trazabilidad con ER y normalización |
| Migraciones Prisma | `apps/api/prisma/migrations/` | Evolución versionada de la base de datos | IMPLEMENTADO | Mantener por cada cambio estructural |
| Aplicación Web | `apps/web/` | Frontend React/Vite integrado con la API | MVP CERRADO Y VALIDADO | Mantener y evolucionar sólo cuando una HU lo requiera |
| Aplicación Desktop | `apps/desktop/` | Cliente institucional Tauri 2 + React/Vite | IMPLEMENTADO Y VALIDADO HASTA HU-038 | Mantener; siguientes cambios sólo mediante HU refinadas |
| API Backend | `apps/api/` | Backend compartido por Web y Desktop | IMPLEMENTADO; NO REVALIDADO EN ESTA REVISIÓN | HU-039–042 cerradas; consolidar evidencia, Docker/OpenAPI/hardening |

## Documentos académicos incorporados

Las rutas enlazadas corresponden a archivos existentes; no se renombran ni trasladan documentos. Inventario completo de los 32 archivos Office presentes en Fase 2.

### Evidencias grupales e individuales

| Documento | Ruta | Versión / referencia | Estado | Acción pendiente |
| --- | --- | --- | --- | --- |
| Guía oficial 2.4: Desarrollo del Proyecto APT | [2.4_GuiaEstudiante_Fase 2_DesarrolloProyecto APT.docx](<../../Fase 2/Evidencias Grupales/2.4_GuiaEstudiante_Fase 2_DesarrolloProyecto APT.docx>) | 2.4 | INCORPORADO / PENDIENTE DE VALIDACIÓN | Validar completitud y entrega docente |
| Guía oficial 2.6: Informe Final del Proyecto APT | [2.6_GuiaEstudiante_Fase 2_Informe Final Proyecto APT.docx](<../../Fase 2/Evidencias Grupales/2.6_GuiaEstudiante_Fase 2_Informe Final Proyecto APT.docx>) | 2.6 | INCORPORADO / PENDIENTE DE VALIDACIÓN | Validar contenido e informe final |
| Diario de Reflexión Fase 2 | [SEPULVEDA_BASTIAN_2.1_APT122_DiarioReflexionFase2.docx](<../../Fase 2/Evidencias Individuales/SEPULVEDA_BASTIAN_2.1_APT122_DiarioReflexionFase2.docx>) | Fase 2 / 2.1 | INCORPORADO / PENDIENTE DE VALIDACIÓN | Validar contenido, atribución y requisitos docentes |
| Diario de Reflexión Fase 2 | [SIMON_DIEGO_2.1_APT122_DiarioReflexionFase2.docx](<../../Fase 2/Evidencias Individuales/SIMON_DIEGO_2.1_APT122_DiarioReflexionFase2.docx>) | Fase 2 / 2.1 | INCORPORADO / PENDIENTE DE VALIDACIÓN | Validar contenido, atribución y requisitos docentes |
| Diario de Reflexión Fase 2 | [TORRES_MATIAS_2.1_APT122_DiarioReflexionFase2.docx](<../../Fase 2/Evidencias Individuales/TORRES_MATIAS_2.1_APT122_DiarioReflexionFase2.docx>) | Fase 2 / 2.1 | INCORPORADO / PENDIENTE DE VALIDACIÓN | Validar contenido, atribución y requisitos docentes |

### Documentación general y arquitectura

| Documento | Ruta | Versión / referencia | Estado | Acción pendiente |
| --- | --- | --- | --- | --- |
| Documento Base | [Documento_Base_CitaJusta.docx](<../../Fase 2/Evidencias Proyecto/Evidencias de documentación/Documento_Base_CitaJusta.docx>) | Sin versión formal validada | INCORPORADO / PENDIENTE DE VALIDACIÓN | Consolidar versión, alcance y responsables |
| Justificación del Proyecto | [CitaJusta_Justificacion_del_Proyecto_v0.1.docx](<../../Fase 2/Evidencias Proyecto/Evidencias de documentación/CitaJusta_Justificacion_del_Proyecto_v0.1.docx>) | v0.1 | INCORPORADO / PENDIENTE DE VALIDACIÓN | Validar integrantes y relación con evidencia vigente |
| Requisitos Funcionales | [CitaJusta_Requisitos_Funcionales_v0.2.docx](<../../Fase 2/Evidencias Proyecto/Evidencias de documentación/CitaJusta_Requisitos_Funcionales_v0.2.docx>) | v0.2 | INCORPORADO / PENDIENTE DE VALIDACIÓN | Validar trazabilidad RF → HU → prueba; HU-043 excluida |
| Stack Tecnológico | [CitaJusta_Stack_Tecnologico_v0.2.docx](<../../Fase 2/Evidencias Proyecto/Evidencias de documentación/CitaJusta_Stack_Tecnologico_v0.2.docx>) | v0.2 | INCORPORADO / PENDIENTE DE VALIDACIÓN | Mantener Docker obligatorio sin darlo por implementado |
| Arquitectura de APIs | [CitaJusta_Arquitectura_APIs_v0.2.docx](<../../Fase 2/Evidencias Proyecto/Evidencias de documentación/Arquitectura/CitaJusta_Arquitectura_APIs_v0.2.docx>) | v0.2 | INCORPORADO / PENDIENTE DE VALIDACIÓN | Validar contratos y cierre HU-039–042; no acreditar cantidad de APIs sin criterio docente |
| Arquitectura de Software | [CitaJusta_Arquitectura_de_Software_v0.2.docx](<../../Fase 2/Evidencias Proyecto/Evidencias de documentación/Arquitectura/CitaJusta_Arquitectura_de_Software_v0.2.docx>) | v0.2 | INCORPORADO / PENDIENTE DE VALIDACIÓN | Validar coherencia Web/Desktop/API y alcance entregable |
| Casos de Uso UML | [CitaJusta_Casos_de_Uso_UML.docx](<../../Fase 2/Evidencias Proyecto/Evidencias de documentación/Arquitectura/CitaJusta_Casos_de_Uso_UML.docx>) | Sin versión en el nombre | INCORPORADO / PENDIENTE DE VALIDACIÓN | Validar actores, límites y trazabilidad |
| UML de secuencia y componentes | [CitaJusta_UML_Secuencia_Componentes.docx](<../../Fase 2/Evidencias Proyecto/Evidencias de documentación/Arquitectura/CitaJusta_UML_Secuencia_Componentes.docx>) | Sin versión en el nombre | INCORPORADO / PENDIENTE DE VALIDACIÓN | Validar diagramas y casos críticos |
| Modelo Entidad-Relación | [CitaJusta_Modelo_Entidad_Relacion_v0.1.docx](<../../Fase 2/Evidencias Proyecto/Evidencias de documentación/Arquitectura/CitaJusta_Modelo_Entidad_Relacion_v0.1.docx>) | v0.1 | INCORPORADO / PENDIENTE DE VALIDACIÓN | Validar claves, cardinalidades y coherencia con schema |
| Mockups Web y Desktop | [CitaJusta_Mockups_Web_Desktop.docx](<../../Fase 2/Evidencias Proyecto/Evidencias de documentación/Mockups/CitaJusta_Mockups_Web_Desktop.docx>) | Sin versión en el nombre | INCORPORADO / PENDIENTE DE VALIDACIÓN | Distinguir capturas de ejecución de diseños conceptuales; revisar privacidad |

El ER se basa en 42 modelos Prisma mapeados a tablas y 90 relaciones con `fields`/`references`, según el README técnico de Fase 2. El diseño fuente no demuestra la reconciliación de PostgreSQL local. Las capturas de una aplicación y los mockups conceptuales tampoco equivalen por sí solos a aprobación funcional o pruebas documentadas.

### Documentación Scrum

Según el [índice Scrum](<../../Fase 2/Evidencias Proyecto/Evidencias de documentación/Scrum/README.md>), se conservan antecedentes y actualizaciones fechadas. Incorporación no implica aprobación de una ceremonia, Sprint Planning ni cierre de Sprint 8.

| Documento | Ruta | Versión / referencia | Estado | Acción pendiente |
| --- | --- | --- | --- | --- |
| Declaración de nivel de avance | [01_Declaracion_Nivel_Avance_CitaJusta.docx](<../../Fase 2/Evidencias Proyecto/Evidencias de documentación/Scrum/01_Declaracion_Nivel_Avance_CitaJusta.docx>) | Antecedente histórico | HISTÓRICO INCORPORADO | Conservar el corte original |
| Minuta anterior | [02_Minuta_Anterior_CitaJusta.docx](<../../Fase 2/Evidencias Proyecto/Evidencias de documentación/Scrum/02_Minuta_Anterior_CitaJusta.docx>) | Antecedente histórico | HISTÓRICO INCORPORADO | No reinterpretar como reunión nueva |
| Acta de constitución | [03_Acta_Constitucion_CitaJusta.docx](<../../Fase 2/Evidencias Proyecto/Evidencias de documentación/Scrum/03_Acta_Constitucion_CitaJusta.docx>) | Antecedente histórico | HISTÓRICO INCORPORADO | Validar responsables sin reescribir el acta |
| Alcances | [04_Alcances_Proyecto_CitaJusta.docx](<../../Fase 2/Evidencias Proyecto/Evidencias de documentación/Scrum/04_Alcances_Proyecto_CitaJusta.docx>) | Actualización 15-10 según índice | INCORPORADO / PENDIENTE DE VALIDACIÓN | Validar anexos y exclusión HU-043 |
| Daily / revisión de reunión | [05_Revision_Daily_Meeting_CitaJusta.docx](<../../Fase 2/Evidencias Proyecto/Evidencias de documentación/Scrum/05_Revision_Daily_Meeting_CitaJusta.docx>) | Registro y antecedentes según índice | INCORPORADO / PENDIENTE DE VALIDACIÓN | Validar fechas y acuerdos; no inventar ceremonias |
| Product Backlog | [06_Product_Backlog_CitaJusta.xlsx](<../../Fase 2/Evidencias Proyecto/Evidencias de documentación/Scrum/06_Product_Backlog_CitaJusta.xlsx>) | Actualización 15-10 e historia conservada | INCORPORADO / PENDIENTE DE VALIDACIÓN | Consolidar enlaces de Issues cerradas y PR fusionadas HU-039–042 |
| Sprint Backlog | [07_Sprint_Backlog_CitaJusta.xlsx](<../../Fase 2/Evidencias Proyecto/Evidencias de documentación/Scrum/07_Sprint_Backlog_CitaJusta.xlsx>) | Sprint 7 histórico según índice | HISTÓRICO INCORPORADO | No confundirlo con un Sprint 8 formal aprobado |
| Burndown | [08_Burndown_Sprint_4_CitaJusta.xlsx](<../../Fase 2/Evidencias Proyecto/Evidencias de documentación/Scrum/08_Burndown_Sprint_4_CitaJusta.xlsx>) | Sprint 4 histórico | HISTÓRICO INCORPORADO | Conservar estimaciones y gráficos |
| Épicas e historias | [09_Epicas_Historias_Usuario_CitaJusta.docx](<../../Fase 2/Evidencias Proyecto/Evidencias de documentación/Scrum/09_Epicas_Historias_Usuario_CitaJusta.docx>) | Actualización 15-10 según índice | INCORPORADO / PENDIENTE DE VALIDACIÓN | Validar alcance y trazabilidad vigente |
| Release Plan | [13_Release_Plan_CitaJusta.xlsx](<../../Fase 2/Evidencias Proyecto/Evidencias de documentación/Scrum/13_Release_Plan_CitaJusta.xlsx>) | Corte 15-10 e historia conservada | INCORPORADO / PENDIENTE DE VALIDACIÓN | Validar entregable sin HU-043; Resend V2 sigue local |
| Evidencia Kanban | [14_Evidencia_Kanban_CitaJusta.docx](<../../Fase 2/Evidencias Proyecto/Evidencias de documentación/Scrum/14_Evidencia_Kanban_CitaJusta.docx>) | Anexo 15-10 según índice | INCORPORADO / PENDIENTE DE VALIDACIÓN | Consolidar enlaces reales y estado de publicación |
| Acta de retrospectiva | [15_Acta_Retrospectiva_2026-10-15_PARA_VALIDAR.docx](<../../Fase 2/Evidencias Proyecto/Evidencias de documentación/Scrum/15_Acta_Retrospectiva_2026-10-15_PARA_VALIDAR.docx>) | 15-10-2026 | INCORPORADO / PENDIENTE DE VALIDACIÓN | Validar con el equipo; no acreditar retrospectiva formal completa |
| Seguimiento Sprint 8 | [16_Seguimiento_Sprint_8_2026-10-15.xlsx](<../../Fase 2/Evidencias Proyecto/Evidencias de documentación/Scrum/16_Seguimiento_Sprint_8_2026-10-15.xlsx>) | 15-10-2026 | INCORPORADO / PENDIENTE DE VALIDACIÓN | No sustituye Sprint Planning/Backlog ni cierre aprobado |

### Versiones históricas conservadas

| Documento | Ruta | Versión / referencia | Estado | Acción pendiente |
| --- | --- | --- | --- | --- |
| Arquitectura APIs | [CitaJusta_Arquitectura_APIs_v0.1.docx](<../../Fase 2/Evidencias Proyecto/Evidencias de documentación/Versiones anteriores/CitaJusta_Arquitectura_APIs_v0.1.docx>) | v0.1 | HISTÓRICO INCORPORADO | Conservar como antecedente; no usar su alcance como compromiso vigente |
| Arquitectura de Software | [CitaJusta_Arquitectura_de_Software_v0.1.docx](<../../Fase 2/Evidencias Proyecto/Evidencias de documentación/Versiones anteriores/CitaJusta_Arquitectura_de_Software_v0.1.docx>) | v0.1 | HISTÓRICO INCORPORADO | Conservar como antecedente; no usar su alcance como compromiso vigente |
| Requisitos Funcionales | [CitaJusta_Requisitos_Funcionales_v0.1.docx](<../../Fase 2/Evidencias Proyecto/Evidencias de documentación/Versiones anteriores/CitaJusta_Requisitos_Funcionales_v0.1.docx>) | v0.1 | HISTÓRICO INCORPORADO | Conservar como antecedente; no usar su alcance como compromiso vigente |
| Stack Tecnologico | [CitaJusta_Stack_Tecnologico_v0.1.docx](<../../Fase 2/Evidencias Proyecto/Evidencias de documentación/Versiones anteriores/CitaJusta_Stack_Tecnologico_v0.1.docx>) | v0.1 | HISTÓRICO INCORPORADO | Conservar como antecedente; no usar su alcance como compromiso vigente |

Las versiones v0.1 anteriores y los cortes del 04-10-2026 se conservan; las versiones actuales y anexos pendientes de validación no los sustituyen retrospectivamente.

### Retiro HU-043 del alcance entregable

Antecedente de revisión del 15-10-2026, conservado como registro histórico de hallazgos: WhatsApp Cloud API se descarta por restricciones empresariales de Meta para el contexto académico. No se modificaron archivos Office, sus imágenes ni el historial Scrum. La tabla registra hallazgos de ese corte, no afirma que todos sigan sin atender: los README actuales informan anexos del 15-10 cuya aprobación aún debe validarse. Se actualizan sólo las ubicaciones para mantener la trazabilidad. Rutas relativas a `Fase 2/Evidencias Proyecto/Evidencias de documentación/`:

| Ruta | Referencia encontrada | Acción pendiente |
| --- | --- | --- |
| `CitaJusta_Requisitos_Funcionales_v0.2.docx` | RF-043 y avisos WhatsApp sujetos a viabilidad | Marcar RF-043 fuera del entregable en la siguiente versión; conservar la decisión y trazabilidad |
| `Arquitectura/CitaJusta_Arquitectura_APIs_v0.2.docx` | Sección 9.5 WhatsApp, tabla HU/RF-043 y alcance planificado | Retirar del alcance/API vigente; conservar v0.2 como antecedente |
| `Arquitectura/CitaJusta_Arquitectura_de_Software_v0.2.docx` | Sprint 8 y adaptador WhatsApp condicionado | Actualizar la arquitectura entregable sin ese adaptador |
| `CitaJusta_Stack_Tecnologico_v0.2.docx` | WhatsApp como integración condicionada | Registrar exclusión; conservar stack e integraciones anteriores |
| `Documento_Base_CitaJusta.docx` | Preparación futura para correo/WhatsApp/SMS | Diferenciar preparación genérica histórica del alcance entregable sin WhatsApp |
| `Scrum/06_Product_Backlog_CitaJusta.xlsx` | HU-043 pendiente en Sprint 8 y notas de alcance | Registrar cambio de alcance fechado, sin marcar Done ni borrar la historia |
| `Scrum/09_Epicas_Historias_Usuario_CitaJusta.docx` | Historia HU-043 y alcance planificado | Incorporar decisión de exclusión en nueva versión; mantener antecedentes |
| `Scrum/13_Release_Plan_CitaJusta.xlsx` | R0.8 y WhatsApp pendiente/condicionado | Registrar retiro de R0.8 sin reescribir releases cerrados |

También se encontraron menciones genéricas en Arquitectura APIs, Arquitectura de Software y Stack v0.1, y antecedentes en `Scrum/04_Alcances_Proyecto_CitaJusta.docx` y `Scrum/05_Revision_Daily_Meeting_CitaJusta.docx`. Se conservan como historia; no acreditan integración disponible. La reconciliación de la base local experimental se documenta aparte en [DECISIONS](../development/DECISIONS.md#retiro-hu-043-y-reconciliación-local-pendiente).

## Documentos de control Capstone

| Nombre | Ruta | Propósito | Estado al corte documental |
| --- | --- | --- | --- |
| Guía Capstone | `docs/capstone/README.md` | Organización y criterios de cumplimiento | REQUIERE REVISIÓN |
| Matriz de cumplimiento | `docs/capstone/CAPSTONE_COMPLIANCE_MATRIX.md` | Trazar requisitos, evidencia y brechas | ACTUALIZADO EN ESTA REVISIÓN |
| Inventario documental | `docs/capstone/DOCUMENT_INVENTORY.md` | Registrar documentos y faltantes | ACTUALIZADO EN ESTA REVISIÓN |
| Checklist de publicación | `docs/capstone/PUBLICATION_CHECKLIST.md` | Seguridad, publicación y preparación de entrega | EXISTENTE; NO MODIFICADO EN ESTA REVISIÓN |
| Evidencia Scrum con GitHub | `docs/capstone/GITHUB_SCRUM_EVIDENCE.md` | Trazabilidad con Issues, Project, branches y PR | REFERENCIA HISTÓRICA; NO MODIFICADA |

## Evidencia técnica histórica conservada

Resultados de cortes anteriores, conservados sin reejecución en esta tarea documental. No representan una regresión actual ni certifican despliegue, seguridad, rendimiento o estado de la base local:

| Evidencia | Resultado |
| --- | --- |
| HU-025 API | 390/390 PASS |
| HU-025 E2E | 8/8 PASS |
| HU-026 fechas | 10/10 PASS |
| HU-026 UI | 16/16 PASS |
| Web tests | 95/95 PASS |
| HU-038 Auditoría Desktop | 34/34 PASS |
| HU-038 API tooling + Auditoría | 24/24 PASS |
| Desktop suite al cierre HU-038 | 163/163 PASS |
| API/Desktop build + cargo check | PASS |
| API build | PASS |
| Web typecheck | PASS |
| Web build | PASS |
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

La integración web fue desarrollada en `feat/web-api-integration` e incorporada mediante el Pull Request #43. Las evidencias Scrum recientes HU-025/HU-026 ya están incorporadas, versionadas y mergeadas.

## Estructura académica existente

| Ruta | Propósito | Estado |
| --- | --- | --- |
| `Fase 1/Evidencias Individuales/` | Entregables personales de Fase 1 | ESTRUCTURA PRESENTE |
| `Fase 1/Evidencias Grupales/` | Planificación y entregables grupales de Fase 1 | ESTRUCTURA PRESENTE / EVIDENCIA POR INCORPORAR |
| `Fase 2/Evidencias Individuales/` | Entregables personales de Fase 2 | TRES DIARIOS INCORPORADOS / VALIDACIÓN PENDIENTE |
| `Fase 2/Evidencias Grupales/` | Guías oficiales de desarrollo e informe final | GUÍAS 2.4 Y 2.6 INCORPORADAS / VALIDACIÓN PENDIENTE |
| `Fase 2/Evidencias Proyecto/Evidencias de documentación/` | General, Arquitectura, Mockups, Scrum y Versiones anteriores | ARCHIVOS INVENTARIADOS ARRIBA / VALIDACIÓN PENDIENTE |
| `Fase 2/Evidencias Proyecto/Evidencias de sistema/Aplicación/` | Evidencia de Web, Desktop, Docker y pruebas | SÓLO README / EVIDENCIA OPERATIVA POR CONSOLIDAR |
| `Fase 2/Evidencias Proyecto/Evidencias de sistema/Base de datos/` | Evidencia de BD, ER, migraciones y normalización | SÓLO README / EVIDENCIA OPERATIVA POR CONSOLIDAR |
| `Fase 3/Evidencias Individuales/` | Evidencia personal final | ESTRUCTURA PRESENTE |
| `Fase 3/Evidencias Grupales/` | Cierre y presentación final | ESTRUCTURA PRESENTE |

Los README de estructura no constituyen por sí solos evidencia de cumplimiento.

## Seguimiento de incorporación y antecedentes

La planificación anterior clasificaba Declaración de Avance, Alcances, Backlogs, Burndown, Daily y Release Plan como preparados o pendientes de incorporar. Sus archivos ahora están localizados en `Scrum/` e inventariados arriba: se corrige la clasificación de incorporación, sin inventar nuevas ceremonias ni cambiar el contenido histórico. Los posibles faltantes de otros sprints requieren confirmación docente y no se deducen de un archivo de Sprint 7 o de seguimiento Sprint 8.

## Pendientes documentales y técnicos

| Documento / Evidencia | Estado | Destino propuesto |
| --- | --- | --- |
| Product Vision formal | PENDIENTE DE INCORPORAR O FORMALIZAR | `Fase 1/Evidencias Grupales/` |
| Definition of Done | PENDIENTE DE FORMALIZAR | `Fase 1/Evidencias Grupales/` |
| Retrospectiva por sprint | ACTA DEL 15-10 INCORPORADA / PENDIENTE DE VALIDACIÓN | Evidencias grupales de la fase correspondiente |
| Plan y evidencia de pruebas por sprint | PARCIAL; existen pruebas, falta consolidación académica | `Fase 2/Evidencias Grupales/` |
| Documento de diseño consolidado | PENDIENTE | Evidencias de documentación de Fase 2 |
| Manual técnico completo | PENDIENTE | Evidencias de documentación de Fase 2 |
| Modelo ER formal | INCORPORADO EN ARQUITECTURA / PENDIENTE DE VALIDACIÓN | Evidencias de documentación / Base de datos |
| Evidencia de normalización | PENDIENTE | Evidencias de documentación / Base de datos |
| UML de casos de uso | INCORPORADO / PENDIENTE DE VALIDACIÓN | Evidencias de documentación de Fase 2 |
| UML de clases | NO LOCALIZADO / PENDIENTE DE ELABORACIÓN Y CONFIRMACIÓN DE COBERTURA | Evidencias de documentación de Fase 2 |
| UML de secuencia | INCORPORADO / PENDIENTE DE VALIDACIÓN | Evidencias de documentación de Fase 2 |
| UML de componentes | INCORPORADO / PENDIENTE DE VALIDACIÓN | Evidencias de documentación de Fase 2 |
| Requisitos no funcionales medibles | PENDIENTE DE CONSOLIDAR | Evidencias de documentación de Fase 2 |
| Informe de rendimiento | PENDIENTE | Evidencias de pruebas de Fase 2 |
| Evaluación de seguridad dedicada | PARCIAL; existen pruebas de seguridad, falta informe consolidado | Evidencias de pruebas de Fase 2 |
| Aplicación de escritorio | IMPLEMENTADA; falta consolidar evidencia académica final | Evidencia de sistema |
| Dockerfile | PENDIENTE DE IMPLEMENTAR | Evidencia de sistema |
| Docker Compose | PENDIENTE DE IMPLEMENTAR | Evidencia de sistema |
| Evidencia funcional de innovación | PARCIAL | Evidencia de documentación y sistema |
| Presentación final | PENDIENTE | `Fase 3/Evidencias Grupales/` |
| Licencia | PENDIENTE DE DEFINIR | Raíz |
| Guías y documentos oficiales del docente | 2.4 Y 2.6 INCORPORADAS / VALIDACIÓN PENDIENTE; PLANILLAS NO LOCALIZADAS | Ubicación indicada por el docente |

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

Validar los documentos incorporados y completar su trazabilidad, sin volver a declarar ausentes UML, ER, guías o diarios ya presentes. Mantener pendientes Docker/Compose, despliegue, OpenAPI, normalización, informe de seguridad/rendimiento, licencia y publicación de Resend V2. El criterio de APIs permanece PENDIENTE_DOCENTE. No se acredita reconciliación de `citajusta_dev`, no se implementa Nager.Date y no se declara cumplimiento total de Fase 2.
