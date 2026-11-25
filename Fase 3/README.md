# Fase 3 - CitaJusta

## Propósito

Consolidar las evidencias académicas, técnicas y metodológicas del cierre del proyecto Capstone CitaJusta.

## Estructura documental

### Evidencias Individuales

Diarios de reflexión de Fase 3 correspondientes a cada integrante del equipo.

### Evidencias Grupales

- Presentación final del proyecto en español.
- Material gráfico de difusión (flyer y tríptico).
- Registro de la reunión de coordinación final del 19/11/2026.
- Guion de la demo con dos casos de uso (Web y Desktop) y guía de preguntas para la defensa.
- Planilla oficial de evaluación Fase 3, cuando sea proporcionada.

### Evidencias Proyecto

#### Evidencias de documentación

- Arquitectura de APIs.
- Diseño de software.
- Diagramas UML y archivos fuente disponibles.
- Requisitos no funcionales.
- Manual técnico y despliegue.
- Docker y configuración.
- Innovación del proyecto.
- Registro técnico del 09/11/2026.

#### Evidencias de documentación/Scrum

Consolidación final de Product Vision, Product Backlog, Sprint Backlogs, Definition of Done, Daily Scrum, retrospectivas, Release Plan y evidencias Kanban, preservando los registros históricos verificables.

#### Evidencias de sistema/Aplicación

- Plan de pruebas y evidencias.
- Evidencias de pruebas Web y Desktop.
- Reportería para la toma de decisiones: Panel de gestión y métricas del proyecto completo.

#### Evidencias de sistema/Base de datos

- Modelo entidad-relación (versión F3.2 conservada y ediciones F3.3).

#### Evidencia audiovisual

Video final de CitaJusta, conservado fuera del repositorio como material de apoyo para la presentación.

## Estado documental (F3.3)

- Los nueve sprints se consideran terminados y revisados **según confirmación del equipo**; esta declaración no constituye aprobación docente ni evidencia de que todas las verificaciones RNF estén cerradas.
- La documentación Scrum consolidada está en `Evidencias Proyecto/Evidencias de documentación/Scrum/`, con corte registrado el 18/11/2026. Los antecedentes históricos de Fase 2 se mantienen sin alteraciones.
- `CitaJusta_Arquitectura_APIs_F3_20261025(version2).docx` y `CitaJusta_UML_Secuencia_Componentes_F3_20261025(version2).docx` son las versiones F3.3. Las versiones `version1` se conservan como antecedentes.
- El Modelo ER `version1` corresponde a F3.2 y se conserva como respaldo; las ediciones F3.3 se incorporan junto a él.
- HU-043 (WhatsApp) está excluida del alcance, no pendiente de desarrollo.
- Los documentos técnicos restantes mantienen su corte F3.2 salvo revisión específica.

## Actualización 24/11/2026

- **Reportería (acuerdo de la reunión 19/11):** Panel de gestión en Desktop y `GET /api/v1/reports/dashboard`, con recomendaciones para decidir, KPIs, tendencia, uso de agenda, rankings y lista de espera (PR #257). Evidencia: `Evidencias Proyecto/Evidencias de sistema/Aplicación/Reporteria_Panel_de_Gestion_F3.md`.
- **Presentación del 03/12:** guion de demo y guía de preguntas en `Evidencias Grupales/`.
- **Base de datos:** conciliación verificada de 44 modelos y 45 tablas físicas (44 + `_prisma_migrations`) en `CONTROL_DE_CAMBIOS_F3.md`.
- **Pruebas ejecutadas:** API 1107/1107, Web 172/172, Desktop 236/236, client-core 6/6 y E2E reports 16/16.
- **Diarios de reflexión:** 2 de 3 incorporados; falta el de Bastián.

Consulte `CONTROL_DE_CAMBIOS_F3.md` para la distinción entre revisión F3.2 histórica y cierre F3.3, y `Evidencias Proyecto/Evidencias de documentación/REGISTRO_TECNICO_F3_20261109.md` para los resultados de pruebas fechados.

La existencia de una carpeta no acredita por sí sola la entrega de sus documentos.

## Trazabilidad

Las evidencias deben corresponder a implementaciones, pruebas y actividades efectivamente realizadas. Los documentos históricos de Fase 2 se conservan sin alterar retroactivamente sus resultados.
