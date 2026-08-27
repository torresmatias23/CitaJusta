# Arquitectura de CitaJusta

## Resumen técnico

CitaJusta será un monorepo con npm workspaces. Los clientes web y de escritorio consumirán una única API REST. El backend será un monolito modular y concentrará las reglas de negocio; PostgreSQL será la fuente persistente de verdad y Prisma la capa de acceso a datos.

```text
Web React/Vite ---------\
                        > API REST NestJS -> Prisma -> PostgreSQL
Desktop Tauri/React ----/
```

## Clientes web y desktop

- Web: React, Vite y TypeScript.
- Desktop: Tauri, React y TypeScript.
- Ambos clientes usan el mismo backend y representan estado, recopilan intención del usuario y consumen resultados de la API.
- Ningún cliente decide autorización, disponibilidad final, scoring, expiraciones ni reasignaciones.

## Backend

NestJS expondrá la API REST como monolito modular. El backend validará las entradas y será responsable de autenticación JWT, autorización RBAC, aislamiento institucional, reglas de agenda y lista de espera, auditoría y coordinación transaccional. CORS será explícito y los endpoints sensibles tendrán rate limiting.

## Persistencia

PostgreSQL almacenará el estado del sistema y Prisma gestionará el acceso a datos. Las operaciones que compitan por un cupo deberán combinar transacciones y constraints de base de datos para conservar exclusividad ante concurrencia.

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

## Flujo crítico de reasignación

1. El backend busca disponibilidad para la solicitud.
2. Si existe un cupo, intenta reservarlo de forma transaccional.
3. Si no existe, registra al usuario en la lista de espera con sus preferencias.
4. Una cancelación libera un cupo dentro de una operación consistente.
5. El backend obtiene candidatos compatibles del mismo contexto institucional y aplica scoring/priorización.
6. Emite una oferta temporal de acuerdo con la priorización.
7. Ante aceptación, rechazo o expiración, vuelve a validar el estado vigente.
8. La aceptación reasigna el cupo en una transacción; el rechazo o la expiración permiten continuar el proceso con el siguiente candidato elegible.

Cada transición debe comprobar el estado actual dentro de la operación crítica. Las restricciones persistentes deben impedir que dos solicitudes confirmen el mismo cupo.

## Backend como autoridad

Los clientes solo envían comandos o intenciones. El backend determina identidad, permisos, tenant, elegibilidad, disponibilidad, orden de prioridad, vigencia de ofertas y resultado de cada transición. Ningún estado aportado por un cliente puede sustituir estas comprobaciones.
