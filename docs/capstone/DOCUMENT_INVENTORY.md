# Inventario documental

Inventario verificado al 3 de septiembre de 2026. La línea base incluía cuatro documentos Markdown versionados y una plantilla técnica de entorno. Esta revisión incorpora seis documentos DOCX académicos reales; siguen sujetos a validación editorial y de vigencia.

## Documentos y artefactos preexistentes

| Nombre | Ruta | Propósito | Requisito Capstone que cubre | Reutilizable | Requiere actualización | Destino propuesto |
| --- | --- | --- | --- | --- | --- | --- |
| Memoria operativa | `AGENTS.md` | Reglas para agentes, arquitectura, seguridad y trabajo incremental | Apoyo a arquitectura, RNF y gobernanza técnica | Sí | Sí; contiene referencias de estado inicial ya superadas | Mantener en raíz y referenciar desde manual técnico |
| Arquitectura | `docs/development/ARCHITECTURE.md` | Arquitectura, dominios y flujo crítico | Arquitectura; diseño, componentes y RNF parciales | Sí | Sí; distinguir mejor estado actual y objetivo | Mantener canónico y referenciar desde evidencia de documentación de Fase 2 |
| Decisiones técnicas | `docs/development/DECISIONS.md` | Decisiones acordadas de stack y arquitectura | Documento de diseño parcial | Sí | Sí, cuando se definan las decisiones de implementación de Docker exigidas por Capstone | Mantener canónico y referenciar desde evidencia de documentación de Fase 2 |
| Entorno de desarrollo | `docs/development/SETUP.md` | Versiones locales verificadas | Manual técnico parcial | Sí | Sí; la frase que niega dependencias, workspaces y scripts está obsoleta | Integrar en manual técnico de Fase 2 |
| Plantilla de entorno | `apps/api/.env.example` | Contrato ficticio de configuración del backend | Variables de entorno | Sí | No actualmente | Mantener junto a la API y enlazar desde README/manual técnico |

## Documentos académicos incorporados

| Nombre | Ruta | Versión | Requisito que cubre | Nivel de reutilización | Actualización necesaria | Destino académico |
| --- | --- | --- | --- | --- | --- | --- |
| Documento Base CitaJusta | `Fase 2/Evidencias Proyecto/Evidencias de documentación/Documento_Base_CitaJusta.docx` | No declarada; indica “Versión base” | Documento Base, visión, alcance, arquitectura, API, datos, seguridad, Scrum e innovación | Alta como fuente; media como entregable final | Incorporar versión, fecha, estado y autores; separar decisiones vigentes de propuestas; alinear `apps/backend` con `apps/api`, `/auth/me` con `/users/me` y el modelo sugerido con la implementación real | Formulación/Documento Base y fuente transversal para Fase 2 |
| Justificación del Proyecto | `Fase 2/Evidencias Proyecto/Evidencias de documentación/CitaJusta_Justificacion_del_Proyecto_v0.1.docx` | 0.1, borrador inicial, 23-08-2026 | Justificación, problema, beneficiarios, valor, impacto, innovación y pertinencia académica | Alta como contenido; media-alta como entregable | Validar integrantes; aprobar versión; agregar sustento y normativa aplicable si la pauta los exige; enlazar requisitos y evidencia real | Justificación y formulación del proyecto |
| Requisitos Funcionales | `Fase 2/Evidencias Proyecto/Evidencias de documentación/CitaJusta_Requisitos_Funcionales_v0.1.docx` | 0.1, borrador inicial, 24-08-2026 | RF-001 a RF-038 y flujo mínimo del MVP | Alta | Agregar criterios de aceptación y trazabilidad efectiva a PBI/HU, sprint, prueba y evidencia; normalizar el orden de RF-038 | Requisitos y fuente para Product Backlog |
| Arquitectura de Software | `Fase 2/Evidencias Proyecto/Evidencias de documentación/CitaJusta_Arquitectura_de_Software_v0.1.docx` | 0.1, borrador inicial, 25-08-2026 | Arquitectura de software, módulos, persistencia, seguridad, multi-tenant y flujo crítico | Alta | Aprobar y actualizar contra el estado real; enlazar ADR, API, modelo de datos y pruebas; no presentar decisiones futuras como implementadas | Diseño y arquitectura de Fase 2 |
| Arquitectura APIs | `Fase 2/Evidencias Proyecto/Evidencias de documentación/CitaJusta_Arquitectura_APIs_v0.1.docx` | 0.1, borrador inicial, 25-08-2026 | Arquitectura REST, `/api/v1`, contratos, seguridad, concurrencia y pruebas previstas | Alta como especificación | Separar endpoints implementados de planificados; enlazar OpenAPI y pruebas cuando existan; aclarar con el docente “5 APIs / al menos 2 propias” | Diseño de API de Fase 2 |
| Stack Tecnológico | `Fase 2/Evidencias Proyecto/Evidencias de documentación/CitaJusta_Stack_Tecnologico_v0.1.docx` | 0.1, borrador inicial, 25-08-2026 | Selección y justificación de tecnologías, monorepo, seguridad y QA | Alta como línea base; media como estado actual | Distinguir tecnologías implementadas de previstas y crear una versión actualizada que incorpore Docker como exigencia Capstone vigente | Stack y decisiones técnicas de Fase 2 |

## Consistencia documental

Los cinco documentos v0.1 identifican la misma nómina: Matías Andrés Torres, Bastian Sepúlveda y Diego Simon. El Documento Base no identifica integrantes y el README aún no contiene una nómina y roles validados. No se detectaron nombres divergentes entre los documentos que sí los declaran, pero la identidad y los roles deben confirmarse antes de unificar los artefactos o publicar.

El Stack Tecnológico v0.1 incluyó “Contenedores Docker como requisito obligatorio del entorno local” entre las tecnologías no comprometidas en esa versión. Esa decisión queda supersedida por la pauta Capstone vigente, que exige Docker. El DOCX permanece sin cambios y queda pendiente crear una versión actualizada.

## Documentos creados en esta fase

| Nombre | Ruta | Propósito | Requisito Capstone que cubre | Reutilizable | Requiere actualización | Destino propuesto |
| --- | --- | --- | --- | --- | --- | --- |
| README principal | `README.md` | Presentación, estado, instalación y navegación del proyecto | README y manual técnico parcial | Sí | Sí; faltan identidad/roles validados, licencia y componentes pendientes | Raíz |
| Guía Capstone | `docs/capstone/README.md` | Criterios, estado y planificación académica | Organización y compliance | Sí | Sí, en cada hito | Mantener en `docs/capstone/` |
| Matriz de cumplimiento | `docs/capstone/CAPSTONE_COMPLIANCE_MATRIX.md` | Trazar requisitos, evidencia y brechas | Control de cumplimiento | Sí | Sí, en cada hito | Mantener en `docs/capstone/` |
| Inventario documental | `docs/capstone/DOCUMENT_INVENTORY.md` | Registrar documentos reales y faltantes | Gestión documental | Sí | Sí, al incorporar evidencia | Mantener en `docs/capstone/` |
| Checklist de publicación | `docs/capstone/PUBLICATION_CHECKLIST.md` | Controlar una futura publicación segura | GitHub público y seguridad | Sí | Sí, antes de publicar | Mantener en `docs/capstone/` |
| Estrategia Scrum en GitHub | `docs/capstone/GITHUB_SCRUM_EVIDENCE.md` | Definir trazabilidad con Issues, sprints y PR | Scrum y evidencia grupal | Sí | Sí, al aprobar convenciones | Evidencias grupales y referencia operativa |
| Índice Fase 1 | `Fase 1/README.md` | Delimitar evidencia de la fase | Organización Fase 1 | Sí | Sí, al incorporar entregables | `Fase 1/` |
| Evidencias individuales Fase 1 | `Fase 1/Evidencias Individuales/README.md` | Reservar y normalizar entregables personales | Evidencias individuales | Sí | Sí | Misma carpeta |
| Evidencias grupales Fase 1 | `Fase 1/Evidencias Grupales/README.md` | Reservar entregables del equipo | Evidencias grupales y Scrum | Sí | Sí | Misma carpeta |
| Índice Fase 2 | `Fase 2/README.md` | Delimitar evidencia de la fase | Organización Fase 2 | Sí | Sí | `Fase 2/` |
| Evidencias individuales Fase 2 | `Fase 2/Evidencias Individuales/README.md` | Reservar y normalizar entregables personales | Evidencias individuales | Sí | Sí | Misma carpeta |
| Evidencias grupales Fase 2 | `Fase 2/Evidencias Grupales/README.md` | Reservar entregables del equipo | Evidencias grupales y Scrum | Sí | Sí | Misma carpeta |
| Evidencias de proyecto Fase 2 | `Fase 2/Evidencias Proyecto/README.md` | Organizar documentación y sistema | Evidencias del proyecto | Sí | Sí | Misma carpeta |
| Evidencias de documentación | `Fase 2/Evidencias Proyecto/Evidencias de documentación/README.md` | Reservar diseño, manuales y diagramas | Diseño, manual técnico, ER, UML y RNF | Sí | Sí | Misma carpeta |
| Evidencias de sistema | `Fase 2/Evidencias Proyecto/Evidencias de sistema/README.md` | Organizar evidencia ejecutable | Aplicación, BD y pruebas | Sí | Sí | Misma carpeta |
| Evidencia de aplicación | `Fase 2/Evidencias Proyecto/Evidencias de sistema/Aplicación/README.md` | Reservar evidencia web, desktop, Docker y pruebas | Aplicación y despliegue | Sí | Sí | Misma carpeta |
| Evidencia de base de datos | `Fase 2/Evidencias Proyecto/Evidencias de sistema/Base de datos/README.md` | Reservar ER, migraciones y normalización | Base de datos relacional | Sí | Sí | Misma carpeta |
| Índice Fase 3 | `Fase 3/README.md` | Delimitar evidencia de la fase final | Organización Fase 3 | Sí | Sí | `Fase 3/` |
| Evidencias individuales Fase 3 | `Fase 3/Evidencias Individuales/README.md` | Reservar y normalizar entregables personales | Evidencias individuales | Sí | Sí | Misma carpeta |
| Evidencias grupales Fase 3 | `Fase 3/Evidencias Grupales/README.md` | Reservar cierre y presentación del equipo | Evidencias grupales y presentación final | Sí | Sí | Misma carpeta |

Los README de las carpetas académicas son marcadores de estructura; no constituyen por sí mismos evidencia de cumplimiento.

## Pendiente de completar o incorporar

Los siguientes entregables finales o complementarios aún no están incorporados o no cuentan con evidencia completa:

| Documento | Estado | Destino propuesto |
| --- | --- | --- |
| Product Vision formal | PENDIENTE DE INCORPORAR | `Fase 1/Evidencias Grupales/` |
| Product Backlog priorizado | PENDIENTE DE INCORPORAR | `Fase 1/Evidencias Grupales/` |
| Definition of Done | PENDIENTE DE INCORPORAR | `Fase 1/Evidencias Grupales/` |
| Sprint Backlog por sprint | PENDIENTE DE INCORPORAR | Evidencias grupales de la fase correspondiente |
| Retrospectiva por sprint | PENDIENTE DE INCORPORAR | Evidencias grupales de la fase correspondiente |
| Plan y evidencia de pruebas por sprint | PENDIENTE DE INCORPORAR | Evidencias grupales de la fase correspondiente |
| Documento de diseño consolidado | PENDIENTE DE INCORPORAR | Evidencias de documentación de Fase 2 |
| Manual técnico completo | PENDIENTE DE INCORPORAR | Evidencias de documentación de Fase 2 |
| Modelo ER | PENDIENTE DE INCORPORAR | Evidencias de documentación de Fase 2 |
| Evidencia de normalización | PENDIENTE DE INCORPORAR | Evidencias de documentación/Base de datos de Fase 2 |
| UML de casos de uso | PENDIENTE DE INCORPORAR | Evidencias de documentación de Fase 2 |
| UML de clases | PENDIENTE DE INCORPORAR | Evidencias de documentación de Fase 2 |
| UML de secuencia | PENDIENTE DE INCORPORAR | Evidencias de documentación de Fase 2 |
| UML de componentes | PENDIENTE DE INCORPORAR | Evidencias de documentación de Fase 2 |
| Catálogo medible de requisitos no funcionales | PENDIENTE DE INCORPORAR | Evidencias de documentación de Fase 2 |
| Informes de rendimiento y seguridad | PENDIENTE DE INCORPORAR | Evidencias de pruebas de Fase 2 |
| Evidencia funcional de innovación | PARCIAL; existe sustento documental, falta evidencia funcional | Evidencias de documentación/sistema de Fase 2 |
| Evidencias individuales y grupales reales | PENDIENTE DE INCORPORAR | Carpetas académicas de cada fase |
| Presentación final | PENDIENTE DE INCORPORAR | `Fase 3/Evidencias Grupales/` |
| Licencia | PENDIENTE DE DEFINIR | Raíz |
| Guías, formularios y planillas oficiales | PENDIENTE DOCENTE | Ubicación indicada por el docente |

No se crearán sustitutos para documentación oficial de Duoc ni contenido personal no proporcionado.
