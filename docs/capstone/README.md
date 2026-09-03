# Capstone compliance

Esta área concentra la auditoría y planificación académica de CitaJusta para APT122. No sustituye documentos oficiales del docente ni duplica la documentación técnica canónica.

## Documentos

- [Matriz de cumplimiento](CAPSTONE_COMPLIANCE_MATRIX.md)
- [Inventario documental](DOCUMENT_INVENTORY.md)
- [Checklist de publicación](PUBLICATION_CHECKLIST.md)
- [Estrategia de evidencia Scrum con GitHub](GITHUB_SCRUM_EVIDENCE.md)

## Estados de la matriz

- `COMPLETO`: existe evidencia real y localizable.
- `PARCIAL`: existe una base reutilizable, pero falta completar o consolidar evidencia.
- `FALTA`: no existe evidencia suficiente.
- `PENDIENTE_DOCENTE`: requiere aclaración o material proporcionado por el docente.
- `NO_APLICA`: existe justificación explícita para excluirlo.

## Planificación de artefactos Scrum

Antes de la entrega deberán existir, sin duplicar información técnica:

- Product Vision formal.
- Product Backlog priorizado.
- Definition of Done.
- Sprint Backlog por sprint.
- Retrospectiva por sprint.
- Plan y evidencia de pruebas por sprint.

La documentación actual reutilizable es `docs/development/ARCHITECTURE.md`, `DECISIONS.md` y `SETUP.md`. El resto permanece pendiente de incorporar.

## Consulta pendiente al docente

Pregunta a resolver: en el requisito “5 APIs, con al menos 2 propias”, ¿API significa un servicio o contrato independiente, una integración con un proveedor externo u otra unidad evaluable? También debe confirmarse qué condición define una API como propia y qué evidencia exige la evaluación. Los endpoints de una misma API REST no se contarán como APIs independientes sin esa respuesta.

## Docker obligatorio

No existe todavía Dockerfile ni Docker Compose y la documentación previa no los presenta como opcionales. Cuando se implementen deberán actualizarse `README.md`, `docs/development/ARCHITECTURE.md`, `DECISIONS.md`, `SETUP.md`, la matriz y el checklist de publicación.

## Reglas académicas

- Las evidencias individuales deben identificar APELLIDOS Y NOMBRES EN MAYÚSCULAS Y SIN TILDES.
- No renombrar archivos personales sin identificar con certeza a su propietario.
- Las planillas, evaluaciones, autoevaluaciones, diarios y formularios oficiales se incorporan sólo desde la fuente docente.
- Ninguna evidencia debe contener secretos, credenciales ni datos personales innecesarios.

## Línea base auditada

- Rama: `docs/capstone-compliance`.
- Backend NestJS presente; aplicaciones web y escritorio pendientes.
- PostgreSQL confirmado en Prisma, con 37 modelos y 37 tablas declaradas en migraciones.
- Docker, Compose, CI, UML y modelo ER formal pendientes.
- Remoto GitHub existente y no accesible públicamente; mantener privado hasta completar el checklist.
- Auditoría preliminar de 40 commits sin secretos reales detectados; `apps/api/.env` nunca fue versionado.

La visibilidad debe confirmarse nuevamente después de reautenticar GitHub CLI y antes de cualquier publicación.
