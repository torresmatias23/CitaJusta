# Base de datos

## Propósito

Reunir evidencia verificable del diseño y funcionamiento de la persistencia.

## Diseño documentado

- [Modelo Entidad-Relación v0.1](<../../Evidencias de documentación/Arquitectura/CitaJusta_Modelo_Entidad_Relacion_v0.1.docx>), incorporado en Arquitectura; pendiente de validación académica.
- [Schema Prisma](../../../../apps/api/prisma/schema.prisma) y [migraciones versionadas](../../../../apps/api/prisma/migrations/), como fuentes técnicas del diseño.

El esquema fuente contiene 42 modelos con mapeo a tablas y 90 relaciones que declaran `fields`/`references`. Se cuentan 103 anotaciones `@relation` si se incluyen también los extremos inversos nombrados; no son 103 claves foráneas independientes. El diseño Prisma no demuestra por sí solo el estado físico ni la reconciliación del PostgreSQL local.

## Evidencias y validaciones pendientes

Al 16-10-2026 esta carpeta sólo contiene su README. Consolidar evidencia no sensible de migraciones, constraints, integridad, normalización y pruebas. `citajusta_dev` conserva una migración experimental de HU-043 retirada del repositorio; su reconciliación está pendiente y no se ejecuta en esta revisión. Ver [decisión técnica](../../../../docs/development/DECISIONS.md#retiro-hu-043-y-reconciliación-local-pendiente).

No se deben incorporar credenciales ni volcados con datos sensibles.

**Estado:** ER INCORPORADO EN DOCUMENTACIÓN / EVIDENCIA OPERATIVA Y VALIDACIÓN PENDIENTES. No se afirma aprobación total ni sincronización de la base local.
