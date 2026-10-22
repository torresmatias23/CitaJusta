# Entrega final Fase 2 — CitaJusta

Entregables solicitados para el cierre de la Fase 2 (Capstone APT122), elaborados el 17-10-2026 sobre el commit `865a7d0` de `main`. Los documentos anteriores de `Evidencias Proyecto/` se conservan sin cambios como evidencia histórica; los entregables se distribuyen en las carpetas existentes según su tipo.

| # | Entregable solicitado | Acción | Archivo |
|---|---|---|---|
| 1 | Product Vision | Revisar y actualizar | [01_Product_Vision_CitaJusta.docx](<Evidencias de documentación/Scrum/01_Product_Vision_CitaJusta.docx>) |
| 2 | Product Backlog | Revisar y actualizar | [02_Product_Backlog_CitaJusta_v2.0.xlsx](<Evidencias de documentación/Scrum/02_Product_Backlog_CitaJusta_v2.0.xlsx>) |
| 3 | Sprint Backlogs | Consolidar los Sprints realizados | [03_Sprint_Backlogs_Consolidado_CitaJusta.xlsx](<Evidencias de documentación/Scrum/03_Sprint_Backlogs_Consolidado_CitaJusta.xlsx>) |
| 4 | Definition of Done (DoD) | Revisar y actualizar | [04_Definition_of_Done_CitaJusta.docx](<Evidencias de documentación/Scrum/04_Definition_of_Done_CitaJusta.docx>) |
| 5 | Retrospectivas Scrum | Organizar las evidencias | [05_Retrospectivas_Scrum_CitaJusta.docx](<Evidencias de documentación/Scrum/05_Retrospectivas_Scrum_CitaJusta.docx>) |
| 6 | Plan de Pruebas y Evidencias | Elaborar y consolidar | [06_Plan_de_Pruebas_y_Evidencias_CitaJusta.docx](<Evidencias de sistema/Aplicación/06_Plan_de_Pruebas_y_Evidencias_CitaJusta.docx>) |
| 7 | Manual Técnico y de Despliegue | Elaborar o actualizar | [07_Manual_Tecnico_y_Despliegue_CitaJusta.docx](<Evidencias de documentación/07_Manual_Tecnico_y_Despliegue_CitaJusta.docx>) |
| 8 | Requisitos No Funcionales | Revisar y documentar | [08_Requisitos_No_Funcionales_CitaJusta.docx](<Evidencias de documentación/08_Requisitos_No_Funcionales_CitaJusta.docx>) |
| 9 | Documentación de Docker y Configuración | Revisar y completar | [09_Docker_y_Configuracion_CitaJusta.docx](<Evidencias de documentación/09_Docker_y_Configuracion_CitaJusta.docx>) |
| 10 | Documento de Diseño de Software | Revisar y consolidar | [10_Documento_Diseno_Software_CitaJusta.docx](<Evidencias de documentación/Arquitectura/10_Documento_Diseno_Software_CitaJusta.docx>) |
| 11 | Evidencias de Pruebas de la Aplicación Web y Desktop | Recopilar y organizar | [11_Evidencias_Pruebas_Web_Desktop_CitaJusta.docx](<Evidencias de sistema/Aplicación/11_Evidencias_Pruebas_Web_Desktop_CitaJusta.docx>) y [Evidencias/](<Evidencias de sistema/Aplicación/Evidencias/>) |
| 12 | Presentación Final del Proyecto | Preparar | [12_Presentacion_Final_CitaJusta.pptx](<Evidencias de documentación/12_Presentacion_Final_CitaJusta.pptx>) |
| 13 | Diario de Reflexión Fase 2 (2.1) | Completar individualmente | [Evidencias Individuales](<../Evidencias Individuales/README.md>) (cada integrante) |
| 14 | Documentación de Innovación | Sección para el informe final | [14_Innovacion_Seccion_Informe_Final_CitaJusta.docx](<Evidencias de documentación/14_Innovacion_Seccion_Informe_Final_CitaJusta.docx>) |

## Evidencias

Ubicadas en `Evidencias de sistema/Aplicación/Evidencias/`, junto a los documentos 06 y 11 que las referencian.

| Carpeta | Contenido |
|---|---|
| [01_pruebas_automatizadas/](<Evidencias de sistema/Aplicación/Evidencias/01_pruebas_automatizadas/>) | Salidas de `prisma validate`, builds y suites unitarias: API 691/691, Web 138/138, Desktop 165/165, client-core 5/5; `npm audit`. |
| [02_docker_y_e2e/](<Evidencias de sistema/Aplicación/Evidencias/02_docker_y_e2e/>) | Build y arranque de Docker Compose, migraciones, datos demo, prueba de humo del flujo principal (35/35), concurrencia (10 usuarios → 1 reserva), carga indicativa y respaldo/restauración. |
| [02_docker_y_e2e/e2e_api/](<Evidencias de sistema/Aplicación/Evidencias/02_docker_y_e2e/e2e_api/>) | 18 suites E2E contra PostgreSQL 18 aislado: 236 pruebas, 234 aprobadas (detalle en `resumen-e2e.txt`). |
| [03_capturas_web/](<Evidencias de sistema/Aplicación/Evidencias/03_capturas_web/>) | Capturas reales de la aplicación Web ejecutada en Docker. |
| [04_capturas_desktop/](<Evidencias de sistema/Aplicación/Evidencias/04_capturas_desktop/>) | Capturas de ejecución de la aplicación Desktop (Tauri 2) tomadas del documento de Mockups (fuente en `00-fuente.txt`). |
| [05_scripts_verificacion/](<Evidencias de sistema/Aplicación/Evidencias/05_scripts_verificacion/>) | Scripts usados para la prueba de humo, la prueba de concurrencia y las capturas Web. |

Las evidencias de migraciones, concurrencia y respaldo/restauración de `02_docker_y_e2e/` también respaldan la carpeta [Base de datos](<Evidencias de sistema/Base de datos/README.md>).

## Anexo: propuesta de configuración Docker

[Anexos/Propuesta_Docker/](<Evidencias de documentación/Anexos/Propuesta_Docker/>) contiene la configuración Docker preparada y verificada el 17-10-2026 (PostgreSQL, migraciones, API y Web), descrita en el documento 09. El repositorio ya cuenta con su propio entorno Docker Compose en la raíz (`compose.yaml` y `docker/`, PR #176); este anexo se conserva como referencia de la entrega y no reemplaza esa configuración.

Pruebas unitarias: ver el documento 06 (comandos exactos y E2E en base aislada).

Volver a [Evidencias Proyecto](<README.md>).
