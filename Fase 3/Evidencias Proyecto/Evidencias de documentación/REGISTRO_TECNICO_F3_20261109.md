# CitaJusta · Evidencias Grupales de Fase 3

**Edición técnica F3.2: 9 de noviembre de 2026.** Archivos DOCX originales actualizados in situ; se conservan los nombres con sufijo `20261025` para facilitar la comparación y evitar romper referencias existentes. El contenido interior identifica el nuevo corte. Los archivos originales del ZIP recibido no se sobrescribieron.

## Qué contiene esta carpeta

Los diez DOCX son documentos de Fase 2/F3.1 actualizados, **no documentos nuevos ni resúmenes sustitutivos**:

| Archivo | Actualización de noviembre |
| --- | --- |
| 06 Plan de Pruebas y Evidencias | Matriz por ejecución y resultados 09/11; separación entre histórico, E2E y pruebas acotadas. |
| 07 Manual Técnico y Despliegue | CORS_ORIGINS, cabeceras API/Nginx, instalación reproducible desde lockfile, límites operativos. |
| 08 Requisitos No Funcionales | Matriz de 48 RNF corregida, 32 Cumple / 10 Parcial / 6 Pendiente, con evidencia y brechas. |
| 09 Docker y Configuración | compose.yaml, DOCKER_CORS_ORIGINS, nginx.conf y verificación de cabeceras. |
| 10 Diseño de Software | Controles transversales, RNF-009, RNF-024, RNF-008/010; sin nuevas tablas/endpoints. |
| 11 Evidencias de Pruebas Web y Desktop | Pruebas automatizadas de noviembre, límites de capturas manuales y checklist real. |
| 14 Innovación | Límites de impacto medido, diferenciación y mejoras de seguridad sin métricas ficticias. |
| Arquitectura de APIs | CORS, 429/Retry-After, límites 400 y cabeceras; OpenAPI pendiente. |
| Modelo Entidad-Relación | Sin migraciones por estas PR; persistencia del limitador y restricciones únicas; pendiente verificar esquema físico. |
| UML Secuencia/Componentes | Puntos de secuencia y frontera HTTP; figuras históricas conservadas, fuentes editables pendientes. |

Se incluye `00_componentes_esquema_F3.dot` como fuente esquemática existente; no se han fabricado dibujos ni reemplazado imágenes sin fuentes.

## Evidencia que respalda el corte

- **PR #234** (merge `a78c93e`): protección de reserva y políticas de rate limiting; E2E PostgreSQL aislado 8/8 auth-rate-limit y 24/24 appointments reportados.
- **PR #236** (merge `187f921`): rango máximo de 744 horas y 5.000 candidatos para disponibilidad; 125/125 pruebas seleccionadas PASS, incluidos 3 E2E.
- **PR #238** (merge `d34a5cb`, commit `b81ea3a`): CORS y cabeceras HTTP; Issues **#239 RNF-008** y **#240 RNF-010** Closed / Kanban Done; Daily Scrum **#233** del 09-11-2026 actualizado.
- Validación final reportada por Astra: **105/105 pruebas distintas PASS**, incluye suite body-parser+Multer 10/10, configuración/seguridad 33/33 y auth/integraciones 62/62; más validaciones anteriores de Nginx 4/4 y checkpoint E2E 3/3 reportadas por Codex. No sumar como si fueran una sola regresión.
- La falla gzip se resolvió al reconstruir `node_modules` desde `package-lock.json`; Express cargó realmente body-parser 2.4.0 y Multer 2.5.0; Prisma permanece 7.10.0. No se cambió código por ese incidente.

## Cómo interpretar estas evidencias

**No eliminar ni confundir**: las cifras de 17/10 (999/999 unitarias y 234/236 E2E) son históricas; los reportes de pruebas de noviembre corresponden a cortes y selecciones diferentes. Los documentos mantienen sus anexos F3.1 para auditoría.

**Pendiente de verificar antes de una entrega final académica**: auditoría de dependencias productivas actual sin severidades altas/críticas; TLS/HSTS público; backup y restauración integral; CI obligatoria; contrato OpenAPI; protección de datos/retención; validación formal de WCAG y empaquetado Tauri; concordancia de ER/diagramas con esquema físico; capturas funcionales nuevas; criterio docente de «5 APIs / 2 propias». Estos puntos no se marcan como completados por inferencia.

El ZIP actualizado constituye una revisión documental, **no un commit ni una PR**. Para integrar a GitHub, trabajar en una rama documental luego de comprobar `git status -sb`; copiar los archivos a `Fase 3/Evidencias Grupales/` respetando los datos locales y revisar diff antes de commit/PR. Evitar `git clean`, `reset` y sobreescrituras sin respaldo/autorización. No incluir archivos .env, contraseñas ni PII de demostración.

El detalle por archivo y las fuentes constan en `CONTROL_DE_CAMBIOS_F3.md`.


## Nota complementaria F3.3 · 19/11/2026

Se verificó en el ZIP recibido la presencia de versiones F3.3 de Arquitectura de APIs y UML bajo los nombres `(...version2).docx`. La edición original del Modelo Entidad-Relación incluida en el ZIP continúa identificada como F3.2; se dispone aparte de una edición F3.3 para reemplazo manual con respaldo.

La diferencia entre 42 modelos Prisma del esquema usado en octubre para el ER y 46 tablas físicas reportadas posteriormente **no se interpreta como cuatro tablas faltantes**, ni se da por reconciliada sin inventario del catálogo físico y comparación con el esquema actual.

La confirmación del equipo de que los nueve sprints fueron terminados y revisados se documenta como declaración de cierre funcional, no como nueva certificación RNF, aceptación docente o reejecución de las suites históricas. HU-043 (WhatsApp) permanece fuera de alcance. Este complemento no cambia el estado de las pruebas ni los reportes de 09/11.
