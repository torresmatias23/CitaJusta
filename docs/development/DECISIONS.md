# Decisiones técnicas

| Área | Decisión acordada |
| --- | --- |
| Repositorio | Monorepo |
| Gestión del monorepo | npm workspaces |
| Backend | Monolito modular con NestJS |
| Comunicación | API REST |
| Web | React, Vite y TypeScript |
| Escritorio | Tauri, React y TypeScript planificados; siguiente etapa, `apps/desktop` aún no existe |
| Persistencia | PostgreSQL |
| Acceso a datos | Prisma |
| Lenguaje | TypeScript |
| Autenticación | JWT Access Token y Refresh Token |
| Autorización | RBAC |
| Control de versiones | Git y GitHub |
| Despliegue lógico inicial | Sin microservicios |
| Integración de clientes | Web consume la API; Desktop consumirá el mismo backend |
| Autoridad de negocio | La lógica crítica reside en el backend |

## HU-023: disparador interno de expiración

La expiración utiliza un provider NestJS con temporizador nativo, sin scheduler externo ni dependencias adicionales. El disparador descubre IDs vencidos; el dominio resuelve cada oferta y continúa la reasignación en una transacción `Serializable`, compartiendo la lógica de continuidad con el rechazo. PostgreSQL conserva la autoridad ante múltiples instancias; el control local de solapamiento es sólo operativo.

Los procesos válidos sin candidatos terminan `EXHAUSTED`; cambios operativos que impiden continuar terminan `CANCELLED`; inconsistencias reales de procesos activos terminan `FAILED`. Errores transitorios hacen rollback y permiten reintentos, nunca un cierre automático `FAILED`. No se cambia `expectedSlotVersion` para acomodar una oferta obsoleta ni se crea una segunda cita. Configuración, arranque y cierre se documentan en `SETUP.md`.

## HU-024: persistencia transaccional y privacidad

Una única API interna recibe `Prisma.TransactionClient`, identidad/contexto derivados del dominio y datos mínimos validados por tipo; genera contenido controlado sin texto libre ni PII. La inserción con conflicto ignorado sobre destinatario/evento preserva tanto el contenido como readAt. Cancelaciones distintas de una cita reasignada se distinguen por cancellationId. La FK del destinatario restringe borrados; contexto y recurso son referencias históricas sin cascadas.

El listado utiliza keyset por createdAt/id descendentes y snapshot RepeatableRead para contador/lista coherentes. POST read actualiza sólo el destinatario con readAt nulo; la concurrencia conserva el primer timestamp. En Web, cada identidad monta un estado nuevo y aborta/invalida peticiones anteriores, sin cache compartida entre cuentas. Las fechas de las notificaciones se presentan en el timezone institucional; UTC se utiliza sólo como fallback.

## HU-025: inicio automático de reasignación

La cancelación de un cupo reutilizable inicia la reasignación dentro de la misma transacción `Serializable`, mediante el helper compartido `reassignment-start.ts`. La generación manual conserva autorización, tenant, sede y contrato HTTP para casos históricos/administrativos; no es un paso normal tras cancelar. El inicio y la primera oferta automáticos se auditan como `SYSTEM`; la cancelación sigue como `USER`.

Validación de estado, `lockVersion` y deduplicación evitan procesos/ofertas adicionales al repetir la cancelación. Sin candidatos elegibles se crea `EXHAUSTED` sin oferta; un cupo no reutilizable permite completar la cancelación sin crear un proceso inválido. Rechazo/expiración conservan la continuidad HU-023 sobre el mismo proceso y ranking. No requiere cambios Prisma ni migraciones.

## HU-026: búsqueda por fecha local en Web

Se mantiene “Soy flexible” con 7/14/30 días y se añade “Fecha específica” con calendario, sin cambiar el backend ni los parámetros `institutionId`, `branchId`, `serviceId`, `from`, `to` de `/resultados`. Las fechas inválidas o anteriores a hoy no permiten buscar; cambiar de modo descarta la fecha específica anterior.

`YYYY-MM-DD` se descompone manualmente en año/mes/día del dispositivo, nunca con `new Date('YYYY-MM-DD')`. Para hoy, `from` es ahora; para una fecha futura, el inicio local de ese día. `to` es el inicio local del día siguiente mediante calendario, sin sumar 86.400.000 ms, para respetar DST. La conversión a ISO se realiza al construir los query params.
