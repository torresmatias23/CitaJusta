# Checklist de publicación en GitHub

**Proyecto:** CitaJusta
**Fecha de actualización:** 17 de octubre de 2026
**Estado:** REPOSITORIO PUBLICADO / CHECKLIST DE MANTENCIÓN Y ENTREGA

El repositorio de CitaJusta ya se encuentra disponible en GitHub y el acceso remoto fue validado mediante operaciones reales de `pull`, `push` y Pull Request. Este checklist deja de ser sólo una preparación para publicar y pasa a funcionar como control de seguridad, consistencia documental y preparación de la entrega académica final.

Corte documental TASK #181: se actualizan únicamente Docker demo, PostgreSQL E2E aislado y publicación de Resend V2, con resultados confirmados por el equipo e historial Git local. Las marcas anteriores de acceso/publicación se conservan como antecedentes, no como comprobación remota actual. No se ejecutan pruebas, servicios o revisiones de secretos exhaustivas ni se aprueban documentos académicos en esta tarea.

## Seguridad y privacidad

- [x] `.env` no versionado y protegido mediante `.gitignore`.
- [x] `apps/api/.env` permanece fuera del control de versiones.
- [x] `apps/web/.env` permanece fuera del control de versiones.
- [x] Los secretos locales utilizados para PostgreSQL y JWT no fueron incorporados al repositorio.
- [x] La plantilla `.env.example` mantiene valores ficticios y reutilizables.
- [x] Plantillas Docker demo y E2E separadas en `docker/.env.example` y `docker/e2e/.env.example`; sus archivos locales quedan ignorados. No incorporar credenciales a evidencias.
- [x] Dependencias, logs y artefactos generados se encuentran excluidos según las reglas actuales del repositorio.
- [ ] Ejecutar una revisión final de secretos sobre el contenido e historial antes de la entrega académica definitiva.
- [ ] Revisar metadatos y datos personales de los documentos DOCX/XLSX que se incorporen como evidencia académica.
- [ ] Confirmar que futuras evidencias, capturas o archivos adjuntos no expongan credenciales, tokens, correos privados u otros datos sensibles innecesarios.

La revisión realizada hasta ahora no ha evidenciado claves privadas, tokens reales ni archivos `.env` versionados. Si una revisión posterior identifica un secreto, éste debe revocarse y el historial debe sanearse antes de considerar cerrada la entrega.

## Proyecto y evidencia

- [x] Estructura general del proyecto presente en el repositorio.
- [x] Estructura académica de Fase 1, Fase 2 y Fase 3 presente.
- [x] Documentos técnicos iniciales incorporados en `Fase 2/Evidencias Proyecto/Evidencias de documentación/`.
- [x] Documentación técnica canónica presente en `docs/development/`.
- [x] Documentación de control Capstone presente en `docs/capstone/`.
- [x] MVP Web cerrado funcionalmente e integrado con la API.
- [x] Backend NestJS y PostgreSQL implementados y operativos.
- [x] Flujo Web/backend HU-007 a HU-026 implementado: lista de espera/preferencias y ofertas, además de autenticación, catálogos, disponibilidad, reserva, Mis citas y cancelación.
- [x] HU-023 expiración automática, HU-024 notificaciones internas, HU-025 inicio automático de reasignación y HU-026 fecha específica/flexible completadas.
- [x] Antecedente conservado: README, ARCHITECTURE, DECISIONS y SETUP sincronizados al cierre HU-038; no implica que sus avisos operativos posteriores estén actualizados.
- [x] Uso real de Issues, GitHub Projects, ramas y Pull Requests para trazabilidad.
- [x] Evidencias Scrum recientes HU-025/HU-026 incorporadas/versionadas y mergeadas.
- [x] Docker demo incorporado mediante [PR #176](https://github.com/torresmatias23/CitaJusta/pull/176), con validación operativa local confirmada.
- [x] PostgreSQL Docker E2E aislado incorporado mediante [PR #179](https://github.com/torresmatias23/CitaJusta/pull/179); 18/18 suites y 237/237 PASS confirmados.
- [x] Resend V2 con logo CID fusionado mediante [PR #173](https://github.com/torresmatias23/CitaJusta/pull/173); no permanece sólo local.
- [ ] Consolidar capturas/resultados sanitizados Docker/E2E en Fase 2 y sincronizar los avisos anteriores de README/SETUP/ARCHITECTURE e índices académicos.
- [ ] Aportar evidencia específica de recepción/renderizado real de Resend V2 con logo; merge, SENT y recepción previa de V1 no acreditan este punto.
- [ ] Revisar versiones y entregables académicos restantes de planificación y seguimiento.
- [x] Crear versiones v0.2 de Requisitos, Arquitectura de Software, Arquitectura APIs y Stack Tecnológico sin borrar los v0.1 históricos.
- [ ] Mantener consistente la identidad y los roles del equipo entre README y documentos académicos.
- [ ] Revisar el repositorio desde una vista pública antes de la entrega al docente.

## Antecedentes de validación técnica

Se conservan los siguientes resultados históricos, sin reejecución en TASK #181:

- HU-025 API: 390/390 PASS.
- HU-025 E2E: 8/8 PASS.
- HU-026 fechas: 10/10 PASS.
- HU-026 UI: 16/16 PASS.
- Web completa: 95/95 PASS.
- Web typecheck: PASS.
- Builds correspondientes API/Web: PASS.
- `git diff --check`: PASS en el cierre de la integración web.
- Flujo manual completo validado:
  registro → login → catálogos → disponibilidad → reserva → confirmación → Mis citas → cancelación → logout.

La integración web fue incorporada a `main` mediante el Pull Request #43 (`feat: complete web api integration`).

### Evidencia confirmada al 17-10-2026

- Docker demo, PR #176 / merge `633a853`: PostgreSQL 18, API NestJS y Web React/Nginx Healthy; /health operativo, Web HTTP 200 y acceso no autenticado protegido con HTTP 401; 12 migraciones aplicadas. Es demostración local, no producción.
- E2E aislado, PR #179 / commit `3e4fa33` / merge `aa40db6`: base citajusta_e2e en 127.0.0.1:15432, marcador citajusta-e2e-docker-v1, runner con verificación de identidad y aislamiento; 18/18 suites, 237/237 PASS; 12 migraciones y 0 pendientes.
- Auditoría E2E 12/12 PASS; unitarios del runner 24/24 PASS tras corrección; Prisma generate y build API PASS. Estos 24 tests no equivalen a la suite backend completa. reassignment-demo sigue pendiente de adaptación y fuera de las 18 suites. Las integraciones externas de las pruebas están simuladas.
- Resend V2, PR #173 / merge `cc7a4d5`: HTML de reserva con logo CID incorporado a main. No se confirmó aquí envío/recepción real V2; SENT indica aceptación por el proveedor, no recepción garantizada.

Resultados operativos confirmados por el equipo para [Issue #181](https://github.com/torresmatias23/CitaJusta/issues/181), no pruebas ejecutadas en esta revisión documental. Fuentes y límites en la [matriz](CAPSTONE_COMPLIANCE_MATRIX.md#evidencias-confirmadas-al-17-10-2026--task-181) y el [inventario](DOCUMENT_INVENTORY.md#evidencia-técnica-confirmada-al-17-10-2026). No acreditan cumplimiento legal, certificación de seguridad, rendimiento, aprobación académica ni preparación productiva.

## Publicación y acceso

- [x] Repositorio remoto configurado correctamente.
- [x] Acceso de escritura al repositorio confirmado con la cuenta autorizada.
- [x] `push` y `pull` operativos desde el entorno de desarrollo actual.
- [x] Pull Requests creados y mergeados correctamente.
- [x] Integración web mergeada a `main`.
- [x] Repositorio accesible públicamente.
- [ ] Verificar nuevamente la URL pública final sin sesión antes de la entrega oficial.
- [ ] Registrar o entregar al docente el enlace definitivo cuando corresponda.

GitHub CLI (`gh`) no es un requisito para la publicación. En el entorno actual se utiliza Git Credential Manager para la autenticación HTTPS y el acceso remoto funciona correctamente.

Para PUBLICACIÓN/ENTREGA, revisar secretos, información sensible/metadatos, suficiencia del README, identidad/roles del equipo, acceso/autenticación GitHub y archivos que se harán públicos. Son controles distintos del cumplimiento CAPSTONE FINAL: artefactos académicos, rendimiento, seguridad dedicada, OpenAPI o despliegue pendiente no deben presentarse como bloqueadores para evidenciar avance incremental del repositorio.

## Pendientes para cumplimiento Capstone final

- Consolidar implementación y evidencias de Sprint 8 para HU-039 Resend, HU-040 Google OAuth/OIDC, HU-041 Google Calendar y HU-042 OpenStreetMap/Google Maps. HU-043 WhatsApp Cloud API queda descartada del entregable desde el 15-10-2026 por restricciones empresariales de Meta en el contexto académico; no es pendiente de implementación ni bloqueador de publicación. Actualizar los documentos académicos vigentes sin reescribir evidencias históricas.

Los siguientes puntos continúan abiertos y deben permanecer visibles como parte del avance incremental:

- Revisar los artefactos académicos restantes; mantener las evidencias Scrum recientes ya incorporadas/versionadas.
- Formalizar o actualizar Product Vision, Product Backlog, Definition of Done y Sprint Backlogs según la evidencia vigente.
- Completar y aprobar el documento de diseño consolidado.
- Completar manual técnico, modelo ER, UML, requisitos no funcionales medibles y evidencia de normalización.
- Consolidar la evidencia académica de la aplicación de escritorio ya implementada y validada hasta HU-038.
- Consolidar evidencia académica de Dockerfile/Compose demo y E2E ya implementados y validados localmente (PR #176/#179); no marcarlos como pendientes de implementación. Despliegue productivo permanece no acreditado.
- Adaptar el E2E histórico reassignment-demo sin relajar aislamiento, y documentar recepción/renderizado real de Resend V2 cuando exista evidencia específica.
- Mantener la evidencia funcional de lista de espera, preferencias y reasignación ya implementadas.
- Consolidar planes y evidencia de pruebas por sprint.
- Incorporar pruebas de rendimiento y una evaluación de seguridad dedicada.
- Mantener “5 APIs / al menos 2 propias” como `PENDIENTE_DOCENTE` hasta confirmar formalmente el criterio de evaluación.
- Incorporar documentos oficiales, evidencias individuales y grupales y presentación final según corresponda.
- Definir la licencia o condiciones de reutilización del repositorio si la entrega final lo requiere.
- Evaluar integración continua si aporta valor al cierre técnico del proyecto.

## Criterio de mantenimiento

El repositorio ya está publicado, por lo que los cambios futuros deben mantener estas condiciones mínimas:

1. No versionar secretos ni archivos `.env`.
2. Mantener `main` estable mediante trabajo por ramas y Pull Requests.
3. Ejecutar pruebas relevantes antes del merge.
4. Mantener alineados código, documentación técnica y evidencia académica.
5. Revisar seguridad, privacidad y consistencia documental antes de cada entrega formal.

Este checklist debe actualizarse nuevamente antes de la entrega final del proyecto.
