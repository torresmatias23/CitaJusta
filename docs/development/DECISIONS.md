# Decisiones técnicas

| Área | Decisión acordada |
| --- | --- |
| Repositorio | Monorepo |
| Gestión del monorepo | npm workspaces |
| Backend | Monolito modular con NestJS |
| Comunicación | API REST |
| Web | React, Vite y TypeScript |
| Escritorio | Tauri 2 + React/Vite/TypeScript implementados en `apps/desktop` |
| Persistencia | PostgreSQL |
| Acceso a datos | Prisma 7.10.0; no actualizar a Prisma 8 sin decisión explícita |
| Lenguaje | TypeScript |
| Autenticación | JWT Access Token y Refresh Token |
| Autorización | RBAC |
| Control de versiones | Git y GitHub |
| Despliegue lógico inicial | Sin microservicios |
| Integración de clientes | Web y Desktop consumen el mismo backend; no acceden directamente a PostgreSQL |
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


## Sprint 8: integraciones externas

- Resend será el primer proveedor de correo transaccional (HU-039), encapsulado mediante un adaptador de backend.
- Google OAuth/OpenID Connect será un método adicional de autenticación (HU-040), sin sustituir RBAC, sesiones ni el contexto institucional de CitaJusta.
- Google Calendar (HU-041) recibe una copia explícitamente autorizada de una cita propia AGENDADA futura en `primary`, mediante GIS popup/code y el scope `calendar.events.owned`. El backend usa tokens sólo en memoria y un event ID determinista por UUID; no requiere migración ni sincronización posterior. CitaJusta/PostgreSQL sigue siendo la fuente de verdad. Validación automática y manual real PASS el 06-10-2026: creación de evento, idempotencia sin duplicados y cierre del consentimiento sin cambiar la cita AGENDADA.
- HU-042 concreta la visualización con iframe oficial OpenStreetMap y Google Maps URLs para indicaciones, sin Maps JavaScript/Embed/Places API, API key ni facturación Google Maps Platform. Se consumen datos reales de dirección/coordenadas ya existentes; sin migración, SDK ni geocodificación. Coordenadas JSON number/null, validación finita/rangos, URLs de dominio fijo y panel bajo demanda. El fallback de dirección exige texto/número, comuna y país, sin garantizar precisión de geocodificación externa. Mantener atribución OSM y respetar sus términos/políticas; los servicios públicos no tienen disponibilidad o gratuidad ilimitada garantizada.
- HU-043 / RF-043 (WhatsApp Cloud API) se descarta definitivamente del alcance entregable el 15-10-2026 por restricciones empresariales de Meta para el contexto académico. Se retira la integración experimental, sin sustituirla por otra API en esta tarea. Resend, Google OAuth, Google Calendar, OpenStreetMap/Google Maps y notificaciones internas se conservan.
- Los contratos exactos se definen al refinar cada HU; no se agregan endpoints, dependencias ni persistencia por anticipado.

### Retiro HU-043 y reconciliación local pendiente

La inspección READ ONLY de `citajusta_dev` del 15-10-2026 confirma 13 migraciones aplicadas, sin registros de migración inconclusos. `20261012193504_whatsapp_notifications_consent` figura aplicada desde el 12-10-2026. Permanecen la tabla `entregas_whatsapp_notificacion`, el enum `estado_entrega_whatsapp` y tres columnas de `usuarios`: `whatsapp_consentimiento`, `whatsapp_consentimiento_at` y `whatsapp_revision_consentimiento`, con sus índices/FK. No se consultaron datos personales.

Se verificaron los 28 archivos del respaldo externo `CitaJusta-HU043-backup-20261015-120401` por SHA-256 y la existencia de `citajusta_dev_antes_retirar_whatsapp.dump`. El archivo de migración experimental, nunca incorporado mediante commit, se retira únicamente del árbol local. Las 12 migraciones anteriores se conservan sin cambios. Esto NO revierte la base: su historial conserva una migración ausente del repositorio y su esquema difiere del esquema Prisma restaurado. `prisma validate`/`generate` no acreditan reconciliación de la base. No ejecutar `migrate dev`, despliegues ni E2E sobre esta base hasta acordar la reconciliación.

Opciones pendientes de autorización: (1) preparar otra base local aislada desde las 12 migraciones conservadas, validarla y cambiar la conexión local manualmente, manteniendo `citajusta_dev` y el dump intactos; o (2) restaurar primero el dump en una base aislada para ensayar una reconciliación explícita: recuperar del respaldo la migración aplicada sin alterarla, revisar y probar una migración compensatoria antes de autorizar cualquier aplicación a desarrollo. La segunda opción exige acordar cómo conservar el historial aplicado en el repositorio; no borrar ni editar filas de `_prisma_migrations`. En esta retirada no se ejecutan estas opciones, SQL destructivo, reset, db push, resolve ni restauraciones. Prisma permanece en 7.10.0.

El valor preexistente `NotificationChannel.WHATSAPP` y su migración histórica no forman parte de la implementación experimental y se conservan sin uso activo; eliminarlos alteraría el modelo/historial anterior. Los documentos Office de Fase 2 requieren una actualización de alcance versionada, conservando las versiones y evidencias Scrum históricas.

## Sprint 9: cierre técnico

Docker/Docker Compose, OpenAPI, hardening, rendimiento y cierre documental/académico se planifican después de las integraciones externas.
