# Control de cambios · CitaJusta Fase 3

**Registro histórico F3.2: corte de evidencia del 9 de noviembre de 2026.**
**Complemento F3.3: 19 de noviembre de 2026 (cierre documental parcial y controlado).**
**Edición anterior conservada:** F3.1 del 25 de octubre de 2026.
**Ubicación real de entrega:** `Evidencias Grupales/` (sin `Anexos_Tecnicos_Actualizados/`, que figuraba erróneamente en la versión antigua del control de cambios).

## Metodología y conservación

- Se abrieron y editaron **los mismos diez DOCX** del ZIP entregado, manteniendo párrafos, tablas, fotografías, figuras y apartados históricos. No se sustituyeron por informes nuevos.
- Los nombres de archivo se conservan con sufijo histórico `20261025`; portada, control de versión y apartados finales indican el corte 09/11. Esto evita romper enlaces o referencias antiguas.
- En el catálogo RNF se actualizó **la evidencia y el estado** de RNF-008, RNF-009, RNF-010 y RNF-035 a **Cumple**, además de ampliar RNF-024 sin darlo por totalmente cerrado. Las restantes 43 filas conservan su estado por falta de evidencia de reevaluación completa.
- Los resultados 17–25/10 se conservan como registros fechados, no se inventan reejecuciones. Un dato reportado por Codex/Astra se identifica como tal; las cifras de suites solapadas no se suman.
- El `.dot` se conserva como vista esquemática; las figuras históricas no se alteran ni se presentan como diagramas fuente editable acreditados.

## Cambios concretos por documento

| Documento | Acción F3.2 |
| --- | --- |
| `06_Plan_de_Pruebas_y_Evidencias_CitaJusta_F3_20261025.docx` | ejecuciones noviembre; separación de suites; incidente gzip |
| `07_Manual_Tecnico_y_Despliegue_CitaJusta_F3_20261025.docx` | variables CORS; seguridad cabeceras; npm ci reproducible; evidencia pruebas |
| `08_Requisitos_No_Funcionales_CitaJusta_F3_20261025.docx` | filas 008/009/010/024/035; matriz 32/10/6; brechas RNF-013 |
| `09_Docker_y_Configuracion_CitaJusta_F3_20261025.docx` | Compose CORS; cabeceras nginx; límites despliegue |
| `10_Documento_Diseno_Software_CitaJusta_F3_20261025.docx` | arquitectura seguridad HTTP; límites consulta; integridad transaccional |
| `11_Evidencias_Pruebas_Web_Desktop_CitaJusta_F3_20261025.docx` | evidencia automatizada vs visual; checklist sin inventar capturas |
| `14_Innovacion_del_Proyecto_CitaJusta_F3_20261025.docx` | innovación no métricas ficticias; seguridad no certificación |
| `CitaJusta_Arquitectura_APIs_F3_20261025.docx` | contratos errores 400/429; CORS frontal vs auth; OpenAPI pendiente |
| `CitaJusta_Modelo_Entidad_Relacion_F3_20261025.docx` | no migraciones nuevas; contadores existentes; duplicados textuales retirados:3 |
| `CitaJusta_UML_Secuencia_Componentes_F3_20261025.docx` | secuencias HTTP; estado figuras editable; duplicados textuales retirados:3 |

## Evidencia técnica verificada o reportada

| Fecha/corte | Fuente | Resultado documentado |
| --- | --- | --- |
| Octubre 2026 (histórico) | ZIP F3.1 / logs Fase 2 | 999/999 unitarias; 234/236 E2E API en 17/10; auditoría E2E de 25/10 18/18. Se preservan las discrepancias de guías históricas. |
| Noviembre 2026 | PR #234, merge `a78c93e` | Rate limiting, 8/8 auth-rate-limit E2E y 24/24 appointments E2E PostgreSQL aislado. |
| Noviembre 2026 | PR #236, merge `187f921` | RNF-024: 125/125 pruebas seleccionadas, 3 E2E incluidos, límite 744 h / 5.000 candidatos. |
| 09/11/2026 | PR #238, merge `d34a5cb` | CORS y cabeceras integradas en main. Issues #239 y #240 en Done; Daily #233 actualizado. |
| Cierre técnico de PR #238 | Codex | 4/4 Nginx real, 3/3 E2E checkpoint PostgreSQL, validación Compose PASS (ejecuciones separadas). |
| Cierre técnico de PR #238 | Astra | 105/105 pruebas distintas en su ronda, 0 FAIL y 0 SKIP; body-parser+Multer 10/10; CORS/entorno 33/33; autenticación/integraciones 62/62. Build PASS. |

## Recuento RNF (catálogo consolidado de 48, no RNF v0.1)

| Corte | Cumple | Cumple parcialmente | Pendiente | Total |
| --- | ---: | ---: | ---: | ---: |
| 17/10 histórico | 28 | 11 | 9 | 48 |
| 09/11 con evidencias incorporadas | **32** | **10** | **6** | **48** |

La numeración RNF-008/009/010 corresponde al **catálogo consolidado de 48 RNF** de Fase 3; otras versiones históricas del documento RNF usaban identificadores distintos. No confundir con el RNF v0.1.

## Pendientes explícitos (NO convertir en Done por documentación)

1. RNF-013: auditar el árbol productivo actual, incluyendo advertencia npm `overrides`/workspaces, sin afirmar «cero vulnerabilidades».
2. RNF-014 y RNF-022: TLS/HSTS público y restauración integral de backup, no acreditados.
3. RNF-032 y RNF-034: CI de PR obligatoria y especificación OpenAPI publicada, no acreditadas.
4. RNF-044: derechos del titular/retención, revisión de procedimiento y pruebas, no acreditados.
5. RNF-024 sigue parcial: hay límites públicos de disponibilidad, falta auditoría transversal de listados y payloads.
6. Validación visual real Web/Desktop de noviembre, instalación Tauri, accesibilidad, esquema físico/normalización y revisión docente de APIs.

## Política de integración

No se modifica Fase 2 original ni se hace commit/push desde esta edición. Antes de copiar al repositorio comprobar rama y `git status -sb`, mantener los archivos de Fase 3 y `.vscode` locales intactos, revisar diferencias y confirmar los cambios con el equipo. No subir secretos, bases de datos ni datos personales.


## Complemento de cierre F3.3 · 19/11/2026

Este complemento **no reescribe** los resultados ni los estados RNF del corte F3.2 de 09/11. Mantiene las 48 filas RNF y su recuento histórico 32/10/6, sin extrapolarlo automáticamente al 19/11.

| Evidencia | Estado observado en el ZIP recibido | Acción de cierre |
| --- | --- | --- |
| Arquitectura de APIs | `CitaJusta_Arquitectura_APIs_F3_20261025(version2).docx` contiene portada F3.3 (19/11); se conserva `version1` F3.2. | Registrar `version2` como edición más reciente del paquete recibido; no sobrescribir antecedentes. |
| UML Secuencia y Componentes | `CitaJusta_UML_Secuencia_Componentes_F3_20261025(version2).docx` identifica F3.3; conserva cuatro figuras UML y la vista complementaria. | Conservar `version1` como respaldo; no declarar fuentes gráficas editables inexistentes. |
| Modelo Entidad-Relación | En el ZIP recibido solo está la edición F3.2 de `CitaJusta_Modelo_Entidad_Relacion_F3_20261025.docx`. | Se preparó una versión F3.3 separada con el mismo contenido gráfico. Integrarla tras respaldar el Word anterior. Los 42 modelos Prisma (corte octubre) y las 46 tablas físicas reportadas después son métricas/cortes diferentes, **sin conciliación acreditada**. |
| Scrum | `Scrum/README.md` declara Sprints 1–9 terminados y revisados según confirmación del equipo (18/11). | Reflejar el cierre funcional sin atribuir aprobación docente, firmas retroactivas ni regresiones inexistentes. |
| Alcance WhatsApp | La documentación de Scrum identifica HU-043 excluida del alcance. | Mantenerla como exclusión expresa; no registrar como pendiente. |
| Manual, RNF, Docker, diseño, pruebas e innovación | Los archivos presentes conservan el sufijo histórico `20261025` y revisiones F3.2. | Revisión específica posterior, preservando evidencias y condiciones técnicas efectivamente verificadas. |

**Límites de esta edición:** solo se actualiza el índice/control documental y se adjunta el Modelo ER F3.3 ya elaborado. No se verificó aquí el esquema PostgreSQL del repositorio actual, una nueva ejecución de tests, la publicación de OpenAPI, el empaquetado Tauri ni la entrega académica.

**Integración:** conservar respaldo del Modelo ER anterior; revisar `git status -sb` y rama antes de copiar cambios. No hacer commit/push sin autorización del equipo.

## Complemento técnico · 24/11/2026

### Conciliación de modelos y tablas físicas

Inventario ejecutado sobre la base aislada E2E (`citajusta-e2e`, PostgreSQL 18.7) con las migraciones de `main` aplicadas, comparando `information_schema.tables` con los `@@map` de `apps/api/prisma/schema.prisma`:

| Objeto | Cantidad | Observación |
| --- | ---: | --- |
| Modelos Prisma | 44 | Cada modelo mapea exactamente una tabla física; no hay modelos sin tabla. |
| Tablas base en `public` | 45 | 44 del dominio + `_prisma_migrations` (control interno de Prisma, no es tabla de negocio). |
| Tipos ENUM | 20 | También se declaran con `@@map`; no son tablas. |
| Claves foráneas | 91 | — |
| Índices | 171 | Incluye claves primarias y `UNIQUE`. |
| Migraciones aplicadas | 14 | Igual a las carpetas de `prisma/migrations`. |

Conclusión: el esquema actual tiene **44 tablas de negocio**. La cifra de 42 modelos corresponde al corte de octubre usado para el Modelo ER. Las 46 tablas físicas reportadas después provienen de una base distinta: la base local de desarrollo conserva objetos de la migración experimental HU-043 retirada (ver `docs/development/DECISIONS.md`). Esa base no se inventarió en este corte, por lo que su diferencia no se atribuye a tablas faltantes del esquema.

### Reportería para la toma de decisiones (reunión 19/11)

| Fecha/corte | Fuente | Resultado documentado |
| --- | --- | --- |
| 24/11/2026 | PR #257, merge `6124678` | `GET /api/v1/reports/dashboard` y Desktop → Análisis → Panel de gestión: recomendaciones con umbrales fijos, KPIs, tendencia, estado de citas, uso de agenda, rankings y lista de espera. |
| 24/11/2026 | Ejecución local de suites | API unitarias 1107/1107, Web 172/172, Desktop 236/236, client-core 6/6, E2E reports 16/16 sobre PostgreSQL 18 Docker; `tsc` y `vite build` Desktop PASS. |

El E2E de reportes fallaba antes con `429` en el registro de usuarios de prueba (7 registros contra el límite de 5 por 15 minutos de CJ-SEC-02). Se corrigió en la propia prueba, que restablece la cuota de su ejecución, sin relajar el límite productivo.
