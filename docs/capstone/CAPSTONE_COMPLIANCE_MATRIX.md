# Matriz de cumplimiento Capstone

**Proyecto:** CitaJusta
**Fecha de actualización:** 16 de octubre de 2026
**Estado:** VIGENTE / AVANCE INCREMENTAL

Esta matriz sincroniza existencia y rutas de Fase 2 con los README al 16-10-2026. Distingue INCORPORADO / PENDIENTE DE VALIDACIÓN, PENDIENTE DE ELABORACIÓN y NO VERIFICADO. Un archivo presente no acredita aprobación, completitud ni cumplimiento técnico. No se auditan Office completos, código, despliegues, GitHub ni PostgreSQL en esta revisión.

El avance general 70% y técnico 80% se conserva únicamente como estimación del equipo, no como medición definitiva ni resultado calculado de esta matriz. Los resultados de pruebas y cortes anteriores se conservan como historia, sin presentarlos como verificaciones ejecutadas hoy.

Decisión de alcance del 15-10-2026, vigente: HU-043 / RF-043 (WhatsApp Cloud API) se descarta por restricciones empresariales de Meta para el contexto académico. No se contabiliza como funcionalidad implementada ni como pendiente de implementación del entregable. Las referencias al plan HU-039 a HU-043 del 04-10-2026 se conservan como evidencia histórica; los anexos/documentos actuales requieren validación y trazabilidad, según el [inventario](DOCUMENT_INVENTORY.md#retiro-hu-043-del-alcance-entregable). Los estados conservadores de esta matriz y la consulta docente sobre cantidad de APIs no cambian por esta retirada.

| Requisito | Obligatorio | Estado | Documento/Evidencia existente | Ubicación actual | Ubicación académica objetivo | Acción pendiente | Prioridad |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Documento Base | Sí | PARCIAL | Documento maestro real, pero sin versión formal consolidada y con contenido que debe reconciliarse con el estado actual | `Fase 2/Evidencias Proyecto/Evidencias de documentación/Documento_Base_CitaJusta.docx` | Evidencias de formulación y documentación | Versionar, actualizar arquitectura/rutas/modelo y validar responsables | ALTA |
| Justificación del proyecto | Sí | PARCIAL | Borrador 0.1 con problema, beneficiarios, valor, innovación y pertinencia académica | `Fase 2/Evidencias Proyecto/Evidencias de documentación/CitaJusta_Justificacion_del_Proyecto_v0.1.docx` | Evidencias de formulación y documentación | Aprobar versión y enlazarla con alcance y evidencia vigente | ALTA |
| Product Vision | Sí | PARCIAL | Contenido reutilizable en README, Documento Base y Justificación; artefacto formal aún no consolidado | `README.md` y DOCX existentes | `Fase 1/Evidencias Grupales/` | Formalizar y versionar la Product Vision | ALTA |
| Requisitos funcionales | Sí | INCORPORADO / PENDIENTE DE VALIDACIÓN | Requisitos v0.2 presentes; HU-039–042 cerradas y HU-043 excluida según el estado confirmado | [CitaJusta_Requisitos_Funcionales_v0.2.docx](<../../Fase 2/Evidencias Proyecto/Evidencias de documentación/CitaJusta_Requisitos_Funcionales_v0.2.docx>) | Fase 2/Evidencias Proyecto/Evidencias de documentación/ | Consolidar RF → HU/Issue → PR → prueba → evidencia sin incluir HU-043 como implementada | ALTA |
| Product Backlog priorizado | Sí | INCORPORADO / PENDIENTE DE VALIDACIÓN | Backlog y actualización fechada, conservando antecedentes | [06_Product_Backlog_CitaJusta.xlsx](<../../Fase 2/Evidencias Proyecto/Evidencias de documentación/Scrum/06_Product_Backlog_CitaJusta.xlsx>) | Fase 2/Evidencias Proyecto/Evidencias de documentación/Scrum/ | Completar enlaces de Issues cerradas y PR fusionadas HU-039–042; Resend V2 sigue local | ALTA |
| Sprint Backlog | Sí | INCORPORADO / VALIDACIÓN PENDIENTE | Sprint Backlog histórico y seguimiento Sprint 8; no acreditan planificación/cierre formal de Sprint 8 | [07_Sprint_Backlog_CitaJusta.xlsx](<../../Fase 2/Evidencias Proyecto/Evidencias de documentación/Scrum/07_Sprint_Backlog_CitaJusta.xlsx>) y [16_Seguimiento_Sprint_8_2026-10-15.xlsx](<../../Fase 2/Evidencias Proyecto/Evidencias de documentación/Scrum/16_Seguimiento_Sprint_8_2026-10-15.xlsx>) | Fase 2/Evidencias Proyecto/Evidencias de documentación/Scrum/ | Validar corte, planificación y seguimiento sin inventar estados o ceremonias | ALTA |
| Definition of Done | Sí | FALTA | Existen prácticas de validación, pero no artefacto formal aprobado | — | `Fase 1/Evidencias Grupales/` | Formalizar criterios verificables de Done | ALTA |
| Documento de diseño | Sí | PARCIAL / VALIDACIÓN PENDIENTE | Arquitecturas, UML y ER presentes; no sustituyen documento consolidado aprobado | [Índice documental](<../../Fase 2/Evidencias Proyecto/Evidencias de documentación/README.md>) | Fase 2/Evidencias Proyecto/Evidencias de documentación/ | Consolidar alcance de diseño y validar documentos incorporados | ALTA |
| Retrospectivas | Sí | INCORPORADO / PENDIENTE DE VALIDACIÓN | Acta fechada explícitamente PARA_VALIDAR | [15_Acta_Retrospectiva_2026-10-15_PARA_VALIDAR.docx](<../../Fase 2/Evidencias Proyecto/Evidencias de documentación/Scrum/15_Acta_Retrospectiva_2026-10-15_PARA_VALIDAR.docx>) | Fase 2/Evidencias Proyecto/Evidencias de documentación/Scrum/ | Validar acuerdos, responsables, plazos y carácter de retrospectiva; no inferir cierre de sprint | MEDIA |
| Plan de pruebas por sprint | Sí | PARCIAL | Existen pruebas y resultados reales, pero falta consolidación académica por sprint | `apps/api/test/`, `apps/web/test/` | `Fase 2/Evidencias Grupales/` | Crear plan/resultados por sprint y trazar a HU/tareas | ALTA |
| Manual técnico | Sí | PARCIAL | README raíz/Fase 2 actualizados; guías técnicas existentes | [README raíz](../../README.md), [SETUP](../development/SETUP.md) | Fase 2/Evidencias Proyecto/Evidencias de documentación/ | Consolidar manual final y evidencias del entorno sin presentar el README como aprobación completa | ALTA |
| Arquitectura de software | Sí | INCORPORADO / PENDIENTE DE VALIDACIÓN | DOCX v0.2 localizado en Arquitectura; versión v0.1 histórica conservada | [CitaJusta_Arquitectura_de_Software_v0.2.docx](<../../Fase 2/Evidencias Proyecto/Evidencias de documentación/Arquitectura/CitaJusta_Arquitectura_de_Software_v0.2.docx>) | Fase 2/Evidencias Proyecto/Evidencias de documentación/Arquitectura/ | Validar coherencia con Web/Desktop/backend y alcance vigente | ALTA |
| Arquitectura de APIs | Sí | INCORPORADO / PENDIENTE DE VALIDACIÓN | DOCX APIs v0.2 y contratos técnicos; no acredita cantidad de APIs distintas | [CitaJusta_Arquitectura_APIs_v0.2.docx](<../../Fase 2/Evidencias Proyecto/Evidencias de documentación/Arquitectura/CitaJusta_Arquitectura_APIs_v0.2.docx>) | Fase 2/Evidencias Proyecto/Evidencias de documentación/Arquitectura/ | Validar contratos HU-039–042; OpenAPI y criterio de cantidad de APIs siguen pendientes | ALTA |
| Stack tecnológico | Sí | INCORPORADO / PENDIENTE DE VALIDACIÓN | Stack v0.2 presente; Prisma 7.10.0 y Docker obligatorio según documentación | [CitaJusta_Stack_Tecnologico_v0.2.docx](<../../Fase 2/Evidencias Proyecto/Evidencias de documentación/CitaJusta_Stack_Tecnologico_v0.2.docx>) | Fase 2/Evidencias Proyecto/Evidencias de documentación/ | Validar versión y evidenciar tecnologías; Docker obligatorio no equivale a Docker implementado | ALTA |
| Modelo ER | Sí | INCORPORADO / PENDIENTE DE VALIDACIÓN | ER v0.1 basado en 42 modelos mapeados y 90 relaciones con fields/references, según README | [CitaJusta_Modelo_Entidad_Relacion_v0.1.docx](<../../Fase 2/Evidencias Proyecto/Evidencias de documentación/Arquitectura/CitaJusta_Modelo_Entidad_Relacion_v0.1.docx>) | Fase 2/Evidencias Proyecto/Evidencias de documentación/Arquitectura/ | Validar cardinalidades/claves y trazabilidad; no acreditar reconciliación PostgreSQL | ALTA |
| UML casos de uso | Sí | INCORPORADO / PENDIENTE DE VALIDACIÓN | Documento específico de casos de uso presente | [CitaJusta_Casos_de_Uso_UML.docx](<../../Fase 2/Evidencias Proyecto/Evidencias de documentación/Arquitectura/CitaJusta_Casos_de_Uso_UML.docx>) | Fase 2/Evidencias Proyecto/Evidencias de documentación/Arquitectura/ | Validar actores, casos y relación con requisitos | ALTA |
| UML clases | Sí | PENDIENTE DE ELABORACIÓN / COBERTURA POR CONFIRMAR | No se localizó documento específico de clases entre los archivos de Fase 2 | — | Fase 2/Evidencias Proyecto/Evidencias de documentación/Arquitectura/ | Confirmar cobertura exigida por pauta; elaborar si corresponde | ALTA |
| UML secuencia | Sí | INCORPORADO / PENDIENTE DE VALIDACIÓN | Documento de secuencia y componentes presente | [CitaJusta_UML_Secuencia_Componentes.docx](<../../Fase 2/Evidencias Proyecto/Evidencias de documentación/Arquitectura/CitaJusta_UML_Secuencia_Componentes.docx>) | Fase 2/Evidencias Proyecto/Evidencias de documentación/Arquitectura/ | Validar flujos críticos y correspondencia con implementación | ALTA |
| UML componentes | Sí | INCORPORADO / PENDIENTE DE VALIDACIÓN | Documento conjunto de secuencia y componentes presente | [CitaJusta_UML_Secuencia_Componentes.docx](<../../Fase 2/Evidencias Proyecto/Evidencias de documentación/Arquitectura/CitaJusta_UML_Secuencia_Componentes.docx>) | Fase 2/Evidencias Proyecto/Evidencias de documentación/Arquitectura/ | Validar límites, dependencias y representaciones | MEDIA |
| Mockups Web y Desktop | Apoyo de diseño | INCORPORADO / PENDIENTE DE VALIDACIÓN | Documento visual Web/Desktop presente | [CitaJusta_Mockups_Web_Desktop.docx](<../../Fase 2/Evidencias Proyecto/Evidencias de documentación/Mockups/CitaJusta_Mockups_Web_Desktop.docx>) | Fase 2/Evidencias Proyecto/Evidencias de documentación/Mockups/ | Clasificar capturas reales frente a diseños conceptuales; no inferir funcionalidad desde bocetos | MEDIA |
| Requisitos no funcionales | Sí | PARCIAL | Seguridad, integridad, validación, rate limit, CORS y calidad descritos/implementados parcialmente | `AGENTS.md`, `docs/development/ARCHITECTURE.md`, código y DOCX | Evidencias de documentación | Consolidarlos como requisitos medibles y trazables | ALTA |
| Evidencia de normalización | Sí | FALTA | Modelo relacional implementado, pero no existe justificación formal de formas normales | — | Evidencias de documentación/Base de datos | Documentar análisis de normalización | ALTA |
| Dockerfile | Sí | PENDIENTE DE IMPLEMENTACIÓN / EVIDENCIA | No hay evidencia de implementación/validación aportada en este corte | [Aplicación](<../../Fase 2/Evidencias Proyecto/Evidencias de sistema/Aplicación/README.md>) | Fase 2/Evidencias Proyecto/Evidencias de sistema/Aplicación/ | Implementar y validar antes de acreditar cumplimiento | ALTA |
| Docker Compose | Sí | PENDIENTE DE IMPLEMENTACIÓN / EVIDENCIA | No hay evidencia de orquestación/despliegue validado en este corte | [Sistema](<../../Fase 2/Evidencias Proyecto/Evidencias de sistema/README.md>) | Fase 2/Evidencias Proyecto/Evidencias de sistema/ | Implementar y documentar ejecución reproducible | ALTA |
| Despliegue | Confirmar alcance con pauta | NO VERIFICADO / EVIDENCIA PENDIENTE | No se verificó un entorno desplegado ni evidencias operativas de entrega | [Sistema](<../../Fase 2/Evidencias Proyecto/Evidencias de sistema/README.md>) | Evidencias de sistema | Definir entorno y alcance docente; desplegar y registrar validaciones antes de darlo por cumplido | ALTA |
| Variables de entorno | Sí | COMPLETO | Plantillas ficticias, validación runtime y archivos locales ignorados | `apps/api/.env.example`, `apps/web/.env.example`, validación backend | Manual técnico y evidencia de aplicación | Mantener sin secretos y actualizar al agregar variables | ALTA |
| README | Sí | INCORPORADO / VALIDACIÓN FINAL PENDIENTE | README raíz y nueve índices de Fase 2 sincronizados con rutas actuales | [README raíz](../../README.md) y [Fase 2](<../../Fase 2/README.md>) | Raíz y carpetas académicas | Mantener coherencia con controles Capstone; cerrar identidad/roles, licencia y entrega final | ALTA |
| Identidad y roles del equipo | Sí | PARCIAL | Nómina consistente en documentos v0.1: Matías Andrés Torres, Bastian Sepúlveda y Diego Simon; roles aún requieren consolidación | DOCX y README | README y entregables académicos | Validar y unificar roles en todos los documentos | ALTA |
| Pruebas automatizadas backend | Sí | EVIDENCIA HISTÓRICA / NO REVALIDADA | HU-025 API 390/390 PASS conservado como corte histórico; no se ejecuta regresión hoy | `apps/api/test/` | Evidencias de pruebas por sprint | Consolidar evidencia reciente y asociarla a versión/PR sin reutilizar cifras como ejecución actual | ALTA |
| Pruebas automatizadas web | Sí | EVIDENCIA HISTÓRICA / NO REVALIDADA | HU-026 fechas 10/10, UI 16/16 y Web 95/95 PASS: antecedentes conservados | `apps/web/test/` | Evidencias de pruebas por sprint | Consolidar evidencia actual por versión sin inventar resultados | ALTA |
| Pruebas integración/E2E | Sí | EVIDENCIA HISTÓRICA / ENTORNO NO REVALIDADO | HU-025 E2E 8/8 PASS histórico; no se ejecuta sobre citajusta_dev | `apps/api/test/e2e/` | Evidencias de sistema/pruebas | Verificar entorno aislado y documentar regresión; no acreditar la BD local por evidencia histórica | ALTA |
| Pruebas rendimiento | Sí | PENDIENTE DE ELABORACIÓN / VERIFICACIÓN | No se localizó informe dedicado en Fase 2 | — | Evidencias de pruebas de Fase 2 | Definir carga, métricas y resultados verificables | MEDIA |
| Pruebas seguridad | Sí | PARCIAL / EVALUACIÓN DEDICADA PENDIENTE | Antecedentes de tests Auth/JWT/RBAC; no equivalen a auditoría o prueba dedicada de seguridad | `apps/api/test/`, `apps/web/test/` | Evidencias de pruebas por sprint | Crear y ejecutar plan dedicado con informe, alcance y resultados | ALTA |
| Innovación | Sí | PARCIAL | Lista de espera, preferencias, ranking y ofertas implementados; HU-023 expiración y HU-025 inicio automático completados | Justificación, arquitectura y Prisma schema | Evidencias de documentación/sistema | Consolidar la demostración académica del flujo implementado | ALTA |
| Aplicación Web | Sí | COMPLETO PARA ALCANCE ACTUAL | MVP Web cerrado: autenticación, catálogos, disponibilidad, reserva, Mis citas, cancelación, lista de espera/preferencias, ofertas, notificaciones y fecha específica/flexible | `apps/web/` | `Fase 2/Evidencias Proyecto/Evidencias de sistema/Aplicación/` | Mantener evidencia del MVP; nuevas modificaciones sólo mediante HU refinadas | ALTA |
| Aplicación Escritorio | Sí | COMPLETO PARA ALCANCE SPRINT 7 | `apps/desktop` implementa Tauri 2 + React/Vite con módulos institucionales hasta HU-038 | `apps/desktop/` | `Fase 2/Evidencias Proyecto/Evidencias de sistema/Aplicación/` | Consolidar evidencia académica final y mantener pruebas verdes | ALTA |
| BD relacional >= 30 tablas | Sí | MODELO INCORPORADO / BD FÍSICA NO VERIFICADA | 42 modelos mapeados según README; citajusta_dev conserva migración experimental fuera del árbol | [CitaJusta_Modelo_Entidad_Relacion_v0.1.docx](<../../Fase 2/Evidencias Proyecto/Evidencias de documentación/Arquitectura/CitaJusta_Modelo_Entidad_Relacion_v0.1.docx>) y [schema](../../apps/api/prisma/schema.prisma) | Evidencias de sistema/Base de datos | Validar evidencia física y reconciliación con autorización; Prisma no acredita por sí solo la BD | ALTA |
| 5 APIs / al menos 2 propias | Por confirmar | PENDIENTE_DOCENTE | Existe una API REST propia central con múltiples endpoints; esto no acredita por sí solo cinco APIs distintas | `apps/api/src/` y DOCX APIs | Evidencias de documentación | Confirmar formalmente el criterio con el docente | ALTA |
| GitHub público | Sí | NO VERIFICADO EN ESTE CORTE | Se conserva antecedente de remoto/PR operativos, que no demuestra visibilidad pública sin login | GitHub del proyecto | URL de entrega | Comprobar acceso público y revisión de archivos antes de entrega; sin cambios remotos en esta tarea | ALTA |
| Trazabilidad Scrum con GitHub | Sí | COMPLETO PARA ALCANCE ACTUAL | Issues, GitHub Project/Kanban, branches y Pull Requests utilizados realmente; evidencias HU-025/HU-026 incorporadas/versionadas y mergeadas | GitHub + `docs/capstone/GITHUB_SCRUM_EVIDENCE.md` | Evidencias grupales | Mantener tablero y documentos académicos sincronizados | ALTA |
| Evidencias individuales | Sí | INCORPORADO / PENDIENTE DE VALIDACIÓN | Tres Diarios de Reflexión Fase 2 presentes | [Índice individual](<../../Fase 2/Evidencias Individuales/README.md>) | Fase 2/Evidencias Individuales/ | Validar contenido y requisitos de cada diario; no declarar aprobación | ALTA |
| Evidencias grupales | Sí | INCORPORADO / VALIDACIÓN PENDIENTE | Guías 2.4/2.6 presentes; Scrum se conserva en documentación del proyecto | [Índice grupal](<../../Fase 2/Evidencias Grupales/README.md>) y [Scrum](<../../Fase 2/Evidencias Proyecto/Evidencias de documentación/Scrum/README.md>) | Fase 2/Evidencias Grupales/ | Validar guías e informe final; consolidar pruebas/evidencias restantes | ALTA |
| Documentos oficiales del profesor | Sí | INCORPORADO PARCIAL / VALIDACIÓN DOCENTE | Guías 2.4 y 2.6 presentes; planillas de evaluación no localizadas en carpeta grupal | [Guías incorporadas](<../../Fase 2/Evidencias Grupales/README.md>) | Fase 2/Evidencias Grupales/ | Validar completitud y confirmar otros originales requeridos con docente | ALTA |
| Presentación final | Sí | PARCIAL | Existe versión de trabajo preparada, aún no corresponde a entrega final | Fuera del repo / pendiente de incorporar | `Fase 3/Evidencias Grupales/` | Actualizar al cierre y versionar cuando corresponda | MEDIA |
| Licencia | Por confirmar | FALTA | No existe | — | Raíz | Definir titularidad y condiciones de reutilización | MEDIA |
| Integración continua | No especificado | NO VERIFICADO EN ESTE CORTE | La existencia y alcance de workflows no se audita en una sincronización documental | — | Evidencia de sistema de Fase 2 | Verificar configuración y ejecuciones antes de acreditar automatización | MEDIA |

## Antecedente histórico: avance técnico al 04 de octubre de 2026

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
- HU-025 API 390/390 y E2E 8/8 PASS.
- HU-026 fechas 10/10, UI 16/16 y Web completa 95/95 PASS; builds correspondientes PASS.
- Aplicación institucional Tauri implementada y validada hasta HU-038.
- HU-038 Auditoría Desktop 34/34 PASS; API tooling + Auditoría 24/24 PASS; Desktop completa 163/163 PASS; API/Desktop build y `cargo check` PASS.
- Product Backlog/Release Plan sincronizados: Sprint 7 cerrado, Sprint 8 integraciones externas HU-039 a HU-043 y Sprint 9 cierre técnico/académico.
- HU-007 a HU-026 del flujo Web/backend implementadas; MVP Web cerrado.
- HU-023 expiración automática, HU-024 notificaciones internas, HU-025 inicio automático de reasignación y HU-026 fecha específica/flexible completadas.
- Evidencias Scrum recientes incorporadas/versionadas; README, ARCHITECTURE, DECISIONS y SETUP actualizados.
- Flujo manual validado de punta a punta.
- Uso real de Issues, GitHub Projects/Kanban, branches y Pull Requests.

## Brechas principales abiertas al 16-10-2026

1. Validar guías, diarios, arquitecturas, UML/ER, mockups y acta de retrospectiva incorporados; no volver a clasificarlos como ausentes.
2. Formalizar Definition of Done/Product Vision y confirmar cobertura de UML de clases y normalización.
3. Consolidar trazabilidad de Issues cerradas/PR fusionadas HU-039–042 y los anexos Scrum; no inferir cierre formal de Sprint 8.
4. Consolidar manual técnico, diseño y evidencia de aplicación/BD: las subcarpetas del sistema contienen sólo README.
5. Implementar y evidenciar Docker/Compose y despliegue; completar OpenAPI y requisitos no funcionales medibles.
6. Elaborar y ejecutar pruebas dedicadas de rendimiento y seguridad con informes verificables.
7. Confirmar con el docente “5 APIs / al menos 2 propias”; integraciones existentes no acreditan automáticamente el criterio.
8. Verificar publicación/entrega y licencia; Resend V2 sigue local sin publicación confirmada.
9. Mantener HU-043 fuera del entregable y la reconciliación de citajusta_dev pendiente de autorización; Nager.Date no está implementada.

## Criterio de actualización

Esta matriz debe actualizarse después de cada hito importante. Los estados `COMPLETO` sólo deben utilizarse cuando exista evidencia verificable; `COMPLETO PARA ALCANCE ACTUAL` indica que la evidencia satisface lo implementado hasta la fecha, pero deberá ampliarse cuando se incorporen nuevas funcionalidades.


### Registro histórico de actualización 04-10-2026

La aplicación institucional Tauri ya está implementada y validada hasta HU-038. Product Backlog y Release Plan incorporan HU-039 a HU-043 para Sprint 8. Docker/Compose, publicación OpenAPI, hardening, rendimiento y cierre académico permanecen como trabajo de Sprint 9. La interpretación del criterio "5 APIs / al menos 2 propias" sigue pendiente de confirmación docente; las integraciones externas planificadas no se contabilizan automáticamente como cumplimiento hasta contar con esa confirmación.


## Alcance confirmado del corte 16-10-2026

HU-039 a HU-042 tienen Issues cerradas y PR fusionadas, según confirmación del proyecto; enlazar sus evidencias sin inventar números ni afirmar una auditoría remota realizada aquí. HU-043 está formalmente fuera de alcance, no Done por implementación. Resend V2 con logo conserva cambios locales y no tiene publicación confirmada. Las versiones anteriores y decisiones de retiro se mantienen. Este corte no acredita cumplimiento total de Fase 2 ni resultados técnicos nuevos.
