# Checklist de publicación en GitHub

El repositorio existe en el remoto pero no es accesible públicamente. La visibilidad exacta debe confirmarse después de reautenticar GitHub CLI. Este checklist debe revisarse inmediatamente antes de autorizar cualquier cambio de visibilidad. La publicación incremental no exige haber completado todos los entregables Capstone.

## Seguridad y privacidad

- [x] Historial revisado por secretos: 40 commits alcanzables auditados preliminarmente sin secretos reales detectados.
- [x] `.env` nunca versionado: `apps/api/.env` tiene cero commits y está ignorado.
- [ ] Revisión final de secretos completada sobre todos los archivos e historial que serán públicos.
- [x] `.gitignore` correcto para `.env`, variantes, logs, dependencias y artefactos generados.
- [ ] Archivos privados o sensibles eliminados o excluidos del alcance público.
- [ ] Datos personales, nombres del equipo y metadatos de los seis DOCX revisados y autorizados.

La plantilla `.env.example` contiene valores ficticios en su versión actual y en las cuatro versiones históricas revisadas. Los matches restantes corresponden a fixtures sintéticos de pruebas; no se detectaron claves privadas, tokens ni credenciales reales. Si una revisión posterior encuentra un secreto, la publicación queda bloqueada hasta revocarlo y sanear el historial mediante una tarea autorizada.

## Proyecto y evidencia

- [ ] README suficiente para publicación, con identidad y roles validados.
- [x] Estructura Capstone presente.
- [x] Seis documentos académicos reales incorporados al inventario y a la matriz.
- [ ] Identidad del equipo consistente entre README, Documento Base y documentos v0.1.
- [ ] Archivos y enlaces que serán públicos revisados desde una vista sin credenciales.

## Publicación y entrega

- [ ] GitHub CLI autenticado y acceso al remoto confirmado con la identidad autorizada.
- [ ] Visibilidad del repositorio preparada y cambio autorizado explícitamente.
- [ ] URL pública final verificada sin login.
- [ ] Enlace entregado al docente.

## Bloqueadores reales para publicación

- Reautenticar GitHub CLI y confirmar la cuenta autorizada para cambiar la visibilidad.
- Validar la identidad y los roles del equipo: los cinco DOCX v0.1 coinciden entre sí, pero el Documento Base omite la nómina y el README aún no tiene una identificación validada.
- Completar el contenido mínimo del README para publicación, especialmente la identidad/equipo y cualquier advertencia necesaria sobre el estado incremental.
- Revisar todos los archivos que se harán públicos, incluidos contenido, nombres y metadatos de los seis DOCX, y excluir información privada o sensible.
- Confirmar con una revisión final que no existan secretos. La auditoría preliminar no detectó secretos reales; cualquier hallazgo bloquearía la publicación hasta su revocación y saneamiento autorizado.

## Pendientes para cumplimiento Capstone final

Estos puntos deben resolverse para la entrega final, pero no bloquean por sí solos el cambio de visibilidad:

- Incorporar Product Vision aprobada, Product Backlog, Definition of Done, Sprint Backlogs, retrospectivas y evidencia por sprint.
- Actualizar y aprobar los documentos académicos; completar manual técnico, modelo ER, UML, RNF medibles y evidencia de normalización.
- Implementar y validar Web, Desktop y las funciones de negocio aún pendientes.
- Implementar y validar Dockerfile y Docker Compose. Docker es obligatorio por la pauta Capstone actual, que supersede Stack Tecnológico v0.1.
- Consolidar pruebas E2E, rendimiento y seguridad, con planes, resultados y trazabilidad.
- Mantener “5 APIs / al menos 2 propias” como `PENDIENTE_DOCENTE`; una API REST con múltiples endpoints no acredita cinco APIs.
- Incorporar documentos oficiales, evidencias individuales y grupales, presentación final y la definición de licencia; evaluar integración continua según el alcance.

No cambiar la visibilidad mientras exista un bloqueador real de publicación. Los pendientes de cumplimiento final deben permanecer visibles en la matriz como evidencia del avance incremental.
