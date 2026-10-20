# Arquitectura de CitaJusta

## Perfil y preferencias globales (RF-004)

Users conserva la autoridad de identidad: las escrituras propias reutilizan principal,
AuthorizationContext y los tres guards existentes, sin aceptar UUID/roles del cliente.
El DTO GET es aditivo; PATCH construye explícitamente los campos personales permitidos.
Las dos preferencias booleanas residen en User, no en tenant ni WaitlistPreference.
Auditoría mínima `ACCOUNT_PROFILE_UPDATED` / `ACCOUNT_EMAIL_PREFERENCES_UPDATED` contiene
actor, recurso AUTH/UUID y resultado, nunca valores personales ni payloads.

Los productores crean siempre Notification dentro de su transacción Serializable y leen
allí las preferencias. Un evento elegible deshabilitado crea una entrega FAILED con
`EMAIL_PREFERENCE_DISABLED`: es una supresión intencional terminal, no un fallo Resend.
El tombstone y la unicidad de entrega por notificación impiden replay tras reactivación.
La desactivación actualiza User y suprime PENDING/PROCESSING por usuario/categoría,
retirando payload/claim/lease y auditando atómicamente. El predicado se ejecuta incluso
sin filas pendientes; las dependencias de lectura/escritura Serializable y retries
acotados de conflictos reconocidos cubren productores concurrentes entre instancias.

El worker comprueba preferencias después del claim y en la actualización condicional
final de payload/lease inmediatamente previa al HTTP. Conserva ownership, payload
congelado y clave Resend. No mantiene una transacción durante HTTP. Existe una ventana
inevitable entre esa autorización y una llamada externa iniciada/aceptada: desactivar
no puede retirar retroactivamente un correo aceptado por Resend. Una completion tardía
sin ownership no puede resucitar una entrega suprimida. RF-003 usa su outbox cifrado
independiente y no consulta estas preferencias. Web refresca el perfil compartido sin
rotar tokens por guardar nombres; respuestas tardías de logout/contexto no lo reemplazan.

## Administración general de instituciones (RF-005)

El Administrador general de instituciones es una autoridad de plataforma limitada, no un superusuario. Su rol dedicado GLOBAL contiene únicamente `institutions.read/create/update`; no concede acceso implícito a catálogo institucional, citas, reportes o auditoría. La autoridad persiste mediante Role, Permission, RolePermission y UserRole. No se concede desde registro, login ni parámetros HTTP.

Los nuevos endpoints administrativos reutilizan AccessTokenGuard, AuthorizationContextGuard y PermissionsGuard. El servicio revalida usuario ACTIVE, vigencia y permiso en asignaciones GLOBAL no contextualizadas; no combina permisos INSTITUTION/BRANCH con otro rol GLOBAL. Rechaza contexto institucional/sede en estas operaciones. El catálogo GET autenticado anterior permanece compatible.

Alta/edición y auditoría se confirman en la misma transacción Serializable, con un reintento completo sólo ante conflictos reconocidos. Sin tablas, migraciones ni cambios en reasignación. Estados y zona horaria de instituciones existentes no se modifican; esa semántica queda fuera de este incremento. Desktop separa el área general y sólo muestra formularios tras verificar capacidades con la API.

La provisión inicial es un procedimiento administrativo explícito (`provision:institution-admin`), nunca parte del startup ni de Docker: cuenta existente ACTIVE verificada por email/UUID y destino local confirmado. Conserva roles/grants ajenos, rechaza configuración incompatible y registra `INSTITUTION_ADMINISTRATOR_PROVISIONED` como SYSTEM con referencia a UserRole. El wrapper sólo admite desarrollo local; habilitar DEMO/producción requiere otro procedimiento de destino aprobado, sin relajar protecciones.

## Resumen técnico

### Recuperación de cuenta (RF-003)

Auth incorpora un módulo explícito de recuperación sin trasladar autoridad a los clientes.
`recuperaciones_cuenta` contiene el hash SHA-256 de un token opaco aleatorio de 256 bits,
vigencia, consumo e invalidación, y una entrega cifrada AES-256-GCM con nonce aleatorio,
tag, key ID y AAD ligada al UUID. No utiliza los payloads JSON en claro de notificaciones.
El hash único y un índice único parcial por usuario protegen una sola recuperación
abierta; una solicitud admitida invalida la anterior en la misma transacción.
`limites_recuperacion_cuenta` usa HMAC de correo normalizado, con ventana/contador e
intervalo persistentes, también para cuentas inexistentes. No agrega datos de dominio.

Solicitud y reset usan transacciones Serializable con hasta tres intentos sólo ante
conflictos reconocidos. El reset consume condicionalmente, cambia Argon2id, invalida otras
recuperaciones, revoca todas las sesiones previas y audita atómicamente. El login local
revalida el hash verificado dentro de su transacción de creación de sesión; una verificación
previa al reset no puede crear posteriormente una sesión con la contraseña antigua.
AccessTokenGuard comprueba también propiedad, vigencia y revocación de `AuthSession.sid`.

El ciclo de email existente procesa también esta entrega durable utilizando ResendClient:
claim/lease y comprobación de vigencia antes del envío, HTTP fuera de transacción y
payload cifrado congelado con clave de idempotencia estable por recuperación. Se elimina
el material cifrado al enviar, consumir, invalidar, agotar reintentos o procesar su expiración.
Reinicios retoman leases vencidos; una confirmación incierta reintenta el mismo contenido,
nunca después del plazo del enlace ni de la ventana de idempotencia del proveedor.
El mismo runner ejecuta limpieza acotada al arrancar y entre ciclos de
`EMAIL_DELIVERY_INTERVAL_MS`, aunque recuperación o envío estén deshabilitados.
Elimina material cifrado vencido y límites vencidos tras el cooldown, sin borrar las
filas de recuperación ni su trazabilidad. No necesita claves criptográficas ni Resend.
Ambas banderas deben estar activas para enviar; expiración y uso único del reset no cambian.

La respuesta pública no distingue inexistencia, inactividad, identidad Google-only o límite.
Sólo ACTIVE con credencial Argon2id local recuperable es elegible, incluso si está vinculada
a Google. No se modifican identidades, roles ni grants. Auditoría registra únicamente códigos
`ACCOUNT_RECOVERY_REQUESTED` / `ACCOUNT_PASSWORD_RESET` y referencias mínimas; Desktop
reconoce esos códigos sin incorporar un flujo propio de recuperación.
Web recibe el token por fragmento, lo retira con `replaceState` y lo mantiene sólo en memoria.
Un email puede llegar después de un consumo/invalidez concurrente: el servidor rechaza
ese enlace; no se promete atomicidad entre PostgreSQL y el proveedor externo.

CitaJusta es un monorepo con npm workspaces. Web y Desktop consumen una única API REST. El backend es un monolito modular y concentra las reglas de negocio; PostgreSQL es la fuente persistente de verdad y Prisma la capa de acceso a datos.

```text
Web React/Vite ---------\
                        > API REST NestJS -> Prisma -> PostgreSQL
Desktop Tauri 2/React --/
```

## Clientes web y desktop

- Web: React, Vite y TypeScript; MVP cerrado funcionalmente al 22-09-2026. Incluye autenticación, catálogos, disponibilidad, reserva, Mis citas, cancelación, lista de espera/preferencias, ofertas y notificaciones. HU-026 añade fecha específica con calendario y flexible 7/14/30, manteniendo `from`/`to` y el calendario local/DST del dispositivo.
- Desktop: Tauri 2, React, Vite y TypeScript implementados en `apps/desktop`; autenticación y módulos institucionales de catálogo, profesionales, agenda, disponibilidad/bloqueos, asistencia, reasignaciones, reportes y auditoría están operativos según permisos.
- Web y Desktop usan el mismo backend; ambos representan estado, recopilan intención del usuario y consumen resultados de la API.
- Ningún cliente decide autorización, disponibilidad final, scoring, expiraciones ni reasignaciones.

## Backend

NestJS expone la API REST como monolito modular. El backend valida las entradas y es responsable de autenticación JWT, autorización RBAC, aislamiento institucional, reglas de agenda y lista de espera, auditoría y coordinación transaccional. Docker/Compose dispone de configuración local API/Web/PostgreSQL aislado, pendiente de validación con Docker Engine; OpenAPI sigue pendiente. La Web Docker usa proxy inverso del mismo origen sin modificar la configuración de CORS existente. Los endpoints sensibles conservan su rate limiting.

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


## Integraciones externas

Sprint 8 incorpora adaptadores externos sin mover reglas de negocio fuera del backend: Resend (HU-039), Google OAuth/OIDC (HU-040), Google Calendar (HU-041) y ubicación con OpenStreetMap/Google Maps (HU-042). CitaJusta/PostgreSQL conserva la autoridad sobre usuarios, citas y estados. OAuth de Google se integra como método adicional de identidad y Calendar requiere autorización explícita del usuario.

HU-043 (WhatsApp Cloud API) se descarta del alcance entregable el 15-10-2026 por restricciones empresariales de Meta en el contexto académico. No hay adaptador, runner, outbox ni preferencias WhatsApp en la aplicación vigente. El retiro de código no elimina los objetos de la base local experimental: ver [decisión y reconciliación pendiente](DECISIONS.md#retiro-hu-043-y-reconciliación-local-pendiente).

HU-042 reutiliza catálogo de sedes y citas propias con DTO geográfico explícito: coordenadas Decimal serializadas como number/null y dirección pública. Web centraliza validación/URLs y un panel reutilizable en selección de sede y Mis citas. El iframe oficial de OpenStreetMap se carga sólo al desplegar ubicación; Cómo llegar abre Google Maps URLs sin API key, facturación ni origen del usuario. No hay geocodificación, geolocalización, nueva persistencia ni cambios transaccionales. Sin coordenadas no hay mapa; sólo una dirección suficientemente específica permite indicaciones. Atribución OSM visible y condiciones de servicio aplicables, sin garantía de disponibilidad.
