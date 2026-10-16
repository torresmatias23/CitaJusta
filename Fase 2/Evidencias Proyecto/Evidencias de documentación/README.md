# Evidencias de documentación

## Propósito

Reunir los documentos técnicos exigidos para acreditar el diseño y desarrollo de CitaJusta, conservando versiones históricas y versiones actualizadas cuando cambie el estado real del proyecto.

## Inventario vigente al 16-10-2026

Los siguientes archivos están incorporados; su presencia no acredita aprobación ni validación completa de su contenido.

### Documentación general

- [Documento Base](<Documento_Base_CitaJusta.docx>).
- [Justificación del Proyecto v0.1](<CitaJusta_Justificacion_del_Proyecto_v0.1.docx>).
- [Requisitos Funcionales v0.2](<CitaJusta_Requisitos_Funcionales_v0.2.docx>).
- [Stack Tecnológico v0.2](<CitaJusta_Stack_Tecnologico_v0.2.docx>).

### Arquitectura, UML y modelo de datos

- [Arquitectura de APIs v0.2](<Arquitectura/CitaJusta_Arquitectura_APIs_v0.2.docx>).
- [Arquitectura de Software v0.2](<Arquitectura/CitaJusta_Arquitectura_de_Software_v0.2.docx>).
- [Casos de Uso UML](<Arquitectura/CitaJusta_Casos_de_Uso_UML.docx>).
- [UML de secuencia y componentes](<Arquitectura/CitaJusta_UML_Secuencia_Componentes.docx>).
- [Modelo Entidad-Relación v0.1](<Arquitectura/CitaJusta_Modelo_Entidad_Relacion_v0.1.docx>).

El ER documenta el diseño basado en el schema Prisma vigente: 42 modelos mapeados a tablas y 90 relaciones con `fields`/`references`. Estas cifras describen el esquema fuente, no acreditan la reconciliación de PostgreSQL local. Diagramas y trazabilidad requieren validación antes de una entrega formal.

### Mockups y evidencia visual

- [Mockups y evidencias Web/Desktop](<Mockups/CitaJusta_Mockups_Web_Desktop.docx>).

Al validar este documento se deben distinguir capturas de aplicaciones en funcionamiento de diseños conceptuales. Un boceto no prueba funcionalidad implementada; una captura tampoco sustituye resultados de pruebas o aprobación de requisitos.

### Scrum y versiones anteriores

- [Índice Scrum](<Scrum/README.md>): backlog, seguimiento Sprint 8, Daily, Release Plan, Kanban y retrospectiva por validar.
- [Arquitectura APIs v0.1](<Versiones anteriores/CitaJusta_Arquitectura_APIs_v0.1.docx>).
- [Arquitectura de Software v0.1](<Versiones anteriores/CitaJusta_Arquitectura_de_Software_v0.1.docx>).
- [Requisitos Funcionales v0.1](<Versiones anteriores/CitaJusta_Requisitos_Funcionales_v0.1.docx>).
- [Stack Tecnológico v0.1](<Versiones anteriores/CitaJusta_Stack_Tecnologico_v0.1.docx>).

Las versiones anteriores se conservan como evidencia histórica; sus planes no prevalecen sobre el alcance vigente.

## Cambio de alcance del 15-10-2026

HU-043 / RF-043 (WhatsApp Cloud API) está formalmente fuera del entregable por restricciones empresariales de Meta para el contexto académico. HU-039 a HU-042 están cerradas con PR fusionadas según el estado confirmado del proyecto; Resend V2 con logo está implementado localmente y pendiente de publicación. Se mantienen las versiones y evidencias históricas; no se presenta WhatsApp como proveedor activo ni Nager.Date como implementada.

## Pendientes de cierre

Validar los documentos incorporados, completar UML/entregables aún exigidos por la pauta y consolidar requisitos no funcionales medibles, manual técnico, pruebas dedicadas de seguridad/rendimiento, Docker/Compose, OpenAPI y presentación final. No se declara Fase 2 completamente cumplida.

El [inventario documental](../../../docs/capstone/DOCUMENT_INVENTORY.md) y la [matriz Capstone](../../../docs/capstone/CAPSTONE_COMPLIANCE_MATRIX.md) conservan rutas/estados anteriores: requieren sincronización con Arquitectura, Versiones anteriores, UML/ER y diarios ya incorporados. Se señalan estas diferencias sin modificar esos documentos en esta revisión.
