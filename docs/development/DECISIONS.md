# Decisiones técnicas

| Área | Decisión acordada |
| --- | --- |
| Repositorio | Monorepo |
| Gestión del monorepo | npm workspaces |
| Backend | Monolito modular con NestJS |
| Comunicación | API REST |
| Web | React, Vite y TypeScript |
| Escritorio | Tauri, React y TypeScript |
| Persistencia | PostgreSQL |
| Acceso a datos | Prisma |
| Lenguaje | TypeScript |
| Autenticación | JWT Access Token y Refresh Token |
| Autorización | RBAC |
| Control de versiones | Git y GitHub |
| Despliegue lógico inicial | Sin microservicios |
| Integración de clientes | Web y desktop consumen el mismo backend |
| Autoridad de negocio | La lógica crítica reside en el backend |

## HU-023: disparador interno de expiración

La expiración utiliza un provider NestJS con temporizador nativo, sin scheduler externo ni dependencias adicionales. El disparador descubre IDs vencidos; el dominio resuelve cada oferta y continúa la reasignación en una transacción `Serializable`, compartiendo la lógica de continuidad con el rechazo. PostgreSQL conserva la autoridad ante múltiples instancias; el control local de solapamiento es sólo operativo.

Los procesos válidos sin candidatos terminan `EXHAUSTED`; cambios operativos que impiden continuar terminan `CANCELLED`; inconsistencias reales de procesos activos terminan `FAILED`. Errores transitorios hacen rollback y permiten reintentos, nunca un cierre automático `FAILED`. No se cambia `expectedSlotVersion` para acomodar una oferta obsoleta ni se crea una segunda cita. Configuración, arranque y cierre se documentan en `SETUP.md`.
