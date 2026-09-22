# Checklist de publicación en GitHub

**Proyecto:** CitaJusta
**Fecha de actualización:** 22 de septiembre de 2026
**Estado:** REPOSITORIO PUBLICADO / CHECKLIST DE MANTENCIÓN Y ENTREGA

El repositorio de CitaJusta ya se encuentra disponible en GitHub y el acceso remoto fue validado mediante operaciones reales de `pull`, `push` y Pull Request. Este checklist deja de ser sólo una preparación para publicar y pasa a funcionar como control de seguridad, consistencia documental y preparación de la entrega académica final.

## Seguridad y privacidad

- [x] `.env` no versionado y protegido mediante `.gitignore`.
- [x] `apps/api/.env` permanece fuera del control de versiones.
- [x] `apps/web/.env` permanece fuera del control de versiones.
- [x] Los secretos locales utilizados para PostgreSQL y JWT no fueron incorporados al repositorio.
- [x] La plantilla `.env.example` mantiene valores ficticios y reutilizables.
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
- [x] MVP Web cerrado funcionalmente al 22-09-2026 e integrado con la API.
- [x] Backend NestJS y PostgreSQL implementados y operativos.
- [x] Flujo Web/backend HU-007 a HU-026 implementado: lista de espera/preferencias y ofertas, además de autenticación, catálogos, disponibilidad, reserva, Mis citas y cancelación.
- [x] HU-023 expiración automática, HU-024 notificaciones internas, HU-025 inicio automático de reasignación y HU-026 fecha específica/flexible completadas.
- [x] README, ARCHITECTURE, DECISIONS y SETUP actualizados.
- [x] Uso real de Issues, GitHub Projects, ramas y Pull Requests para trazabilidad.
- [x] Evidencias Scrum recientes HU-025/HU-026 incorporadas/versionadas y mergeadas.
- [ ] Revisar versiones y entregables académicos restantes de planificación y seguimiento.
- [ ] Actualizar los documentos técnicos v0.1 que aún describen decisiones o estados superados.
- [ ] Mantener consistente la identidad y los roles del equipo entre README y documentos académicos.
- [ ] Revisar el repositorio desde una vista pública antes de la entrega al docente.

## Validación técnica actual

La aplicación cuenta actualmente con evidencia técnica verificable:

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

## Pendientes para cumplimiento Capstone final

Los siguientes puntos continúan abiertos y deben permanecer visibles como parte del avance incremental:

- Revisar los artefactos académicos restantes; mantener las evidencias Scrum recientes ya incorporadas/versionadas.
- Formalizar o actualizar Product Vision, Product Backlog, Definition of Done y Sprint Backlogs según la evidencia vigente.
- Completar y aprobar el documento de diseño consolidado.
- Completar manual técnico, modelo ER, UML, requisitos no funcionales medibles y evidencia de normalización.
- Implementar y validar la aplicación de escritorio.
- Implementar y validar Dockerfile y Docker Compose según la pauta Capstone vigente.
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
