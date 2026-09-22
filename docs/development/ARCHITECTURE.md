# Arquitectura de CitaJusta

## Resumen técnico

CitaJusta es un monorepo con npm workspaces. Web consume una única API REST; Desktop está planificado sobre esa misma API. El backend es un monolito modular y concentra las reglas de negocio; PostgreSQL es la fuente persistente de verdad y Prisma la capa de acceso a datos.

```text
Web React/Vite ---------\
                        > API REST NestJS -> Prisma -> PostgreSQL
Desktop (planificado) --/
```

## Clientes web y desktop

- Web: React, Vite y TypeScript; MVP cerrado funcionalmente al 22-09-2026. Incluye autenticación, catálogos, disponibilidad, reserva, Mis citas, cancelación, lista de espera/preferencias, ofertas y notificaciones. HU-026 añade fecha específica con calendario y flexible 7/14/30, manteniendo `from`/`to` y el calendario local/DST del dispositivo.
- Desktop: Tauri, React y TypeScript planificados para la siguiente etapa; `apps/desktop` todavía no existe.
- Web usa el backend y Desktop usará la misma API; ambos representan estado, recopilan intención del usuario y consumen resultados de la API.
- Ningún cliente decide autorización, disponibilidad final, scoring, expiraciones ni reasignaciones.

## Backend

NestJS expone la API REST como monolito modular. El backend valida las entradas y es responsable de autenticación JWT, autorización RBAC, aislamiento institucional, reglas de agenda y lista de espera, auditoría y coordinación transaccional. Docker y OpenAPI siguen pendientes. CORS es explícito y los endpoints sensibles aplican rate limiting.

## Persistencia

PostgreSQL almacena el estado del sistema y Prisma gestiona el acceso a datos. Las operaciones que compiten por un cupo combinan transacciones y constraints de base de datos para conservar exclusividad ante concurrencia.

El contexto institucional forma parte de cada lectura y escritura; una operación no puede acceder ni afectar datos de otro tenant.

## Límites principales de dominio

- Identidad y acceso: autenticación, tokens, roles y permisos.
- Instituciones: tenant y pertenencia institucional.
- Agenda y disponibilidad: servicios, horarios y cupos.
- Citas: búsqueda, reserva y cancelación.
- Lista de espera: inscripción y preferencias.
- Compatibilidad y priorización: candidatos y scoring.
- Ofertas: emisión temporal, aceptación, rechazo y expiración.
- Reasignación: adjudicación del cupo liberado y transición atómica de estados.
- Auditoría: trazabilidad de acciones y cambios críticos.
- Notificaciones internas (HU-024): persistencia transaccional, listado, contador de no leídas y marcado individual; fechas en timezone institucional, UTC sólo como fallback.

## Flujo crítico de reasignación

1. El backend busca disponibilidad para la solicitud.
2. Si existe un cupo, intenta reservarlo de forma transaccional.
3. Si no existe, registra al usuario en la lista de espera con sus preferencias.
4. Una cancelación libera un cupo reutilizable e inicia automáticamente su reasignación en la misma transacción `Serializable` (HU-025). Cancelación auditada como `USER`; inicio/primera oferta como `SYSTEM`. Si el cupo no es reutilizable, se completa la cancelación sin crear un proceso inválido.
5. El backend obtiene candidatos compatibles del mismo contexto institucional y aplica scoring/priorización.
6. Emite una oferta temporal de acuerdo con la priorización; sin candidatos elegibles crea el proceso `EXHAUSTED`.
7. Ante aceptación, rechazo o expiración, vuelve a validar el estado vigente.
8. La aceptación reasigna el cupo en una transacción; el rechazo o la expiración permiten continuar el proceso con el siguiente candidato elegible.

HU-023 ejecuta expiración real mediante runner/provider interno y continúa con el ranking del mismo proceso. La generación manual queda para casos históricos/administrativos; repetir la cancelación no duplica procesos ni ofertas.

Cada transición debe comprobar el estado actual dentro de la operación crítica. Las restricciones persistentes deben impedir que dos solicitudes confirmen el mismo cupo.

## Backend como autoridad

Los clientes solo envían comandos o intenciones. El backend determina identidad, permisos, tenant, elegibilidad, disponibilidad, orden de prioridad, vigencia de ofertas y resultado de cada transición. Ningún estado aportado por un cliente puede sustituir estas comprobaciones.
