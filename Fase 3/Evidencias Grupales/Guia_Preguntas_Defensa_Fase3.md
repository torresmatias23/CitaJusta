# Guía de preguntas para la defensa — Fase 3

Preparación para los aspectos que, según la reunión del 19/11/2026, pueden preguntar los evaluadores: seguridad, APIs propias y públicas, modelado de la base de datos, consultas utilizadas, metodología, lenguaje y preguntas de desarrollo. **Tener el código abierto** en los archivos indicados en cada sección.

Corte de las cifras: 24/11/2026, rama `main` después de la PR #257.

---

## 1. Seguridad

| Control | Cómo está implementado | Dónde mostrarlo |
| --- | --- | --- |
| Contraseñas | Hash **Argon2id**. En login con un correo inexistente también se verifica contra un hash ficticio, para no revelar qué cuentas existen por diferencia de tiempo. | `apps/api/src/auth/auth.service.ts` |
| Sesiones | JWT de acceso de corta duración (900 s por defecto) y refresh token rotado. En la base (`sesiones_autenticacion`) solo se guarda el **hash SHA-256** del refresh token, nunca el token. | `auth.service.ts`, `config/environment.validation.ts` |
| Fuerza bruta (CJ-SEC-02) | Cuota por operación y origen en los endpoints públicos de auth: login 20/5 min, registro 5/15 min, Google 20/5 min, refresh y logout 60/min. Excederla responde `429` con `Retry-After`. El origen se guarda como **HMAC**, no como IP en claro. | README raíz, sección CJ-SEC-02 |
| Autorización (RBAC) | Tres guards en cadena: `AccessTokenGuard` (token válido), `AuthorizationContextGuard` (institución y sede del header coinciden con asignaciones vigentes) y `PermissionsGuard` (permiso `módulo.acción`, por ejemplo `reports.read`). Los alcances son GLOBAL, INSTITUTION y BRANCH. | `apps/api/src/authorization/` |
| Multi-institución | Cada consulta filtra por la institución del contexto autorizado. Un recurso de otra institución responde `404` no divulgativo (no confirma que existe). | `reports/reports.scope.ts` |
| Validación de entrada | Esquemas **zod** estrictos: se rechazan campos desconocidos, fechas imposibles y rangos fuera de límite (`400`). | `*.schemas.ts` |
| Inyección SQL | Prisma ORM. El SQL manual usa `Prisma.sql` con **parámetros enlazados**; ningún valor se concatena al texto SQL (hay pruebas que lo verifican). | `reports/reports-dashboard.service.ts`, `test/reports-dashboard.test.mjs` |
| Cabeceras HTTP (CJ-SEC-07) | Sin `X-Powered-By`; `nosniff`, `Referrer-Policy` y `Cache-Control: no-store` en toda la API, también en respuestas de error. | `main.ts`, README raíz CJ-SEC-07 |
| Concurrencia | Transacciones `Serializable` y bloqueo optimista (`lockVersion`) en reserva, cancelación y reasignación, con un reintento ante conflicto. | `appointments/appointments.service.ts` |
| Trazabilidad | Tabla `eventos_auditoria` con actor, acción, resultado y entidad, consultable desde Desktop con `audit.read`. | Desktop → Auditoría |
| Secretos | `.env` fuera del repositorio (solo `.env.example` con placeholders). La configuración se valida al arrancar y la API no inicia si falta un secreto. | `.gitignore`, `config/environment.validation.ts` |

**Pregunta probable:** *¿Qué pasa si alguien cambia el header `x-institution-id` por otra institución?*
→ `AuthorizationContextGuard` compara el header con las asignaciones de rol vigentes del usuario en la base. Si no tiene un rol en esa institución, responde `403` y no se ejecuta ninguna consulta.

---

## 2. APIs

### API propia (REST, NestJS)

- Base `/api/v1`, **75 handlers** HTTP en 19 módulos: auth, users, institutions, services, professionals, availability, agenda, appointments, waitlist, reassignments, reassignment-policy, notifications, reports, audit, entre otros.
- Contratos documentados en el README raíz y en `Evidencias Proyecto/Evidencias de documentación/CitaJusta_Arquitectura_APIs_F3_20261025(version2).docx`.
- Ejemplo de la Fase 3: `GET /api/v1/reports/dashboard?from=2026-11-01&to=2026-11-30` con headers `Authorization: Bearer …` y `x-institution-id`.

### APIs públicas o externas integradas

| API | Uso | Por qué así |
| --- | --- | --- |
| **Google OAuth / OpenID Connect** (`google-auth-library`) | Inicio de sesión con Google. | Se verifica el ID token en el backend; RBAC y sesiones siguen siendo propios. |
| **Google Calendar API** | Agregar una cita confirmada al calendario del usuario, con autorización explícita. | CitaJusta sigue siendo la fuente de verdad; Calendar es una copia. |
| **Resend** | Correo transaccional de reserva, cancelación y ofertas de reasignación. | Adaptador propio; cada entrega queda registrada en `entregas_email_notificacion`. |
| **Nager.Date** (`/api/v4/Holidays/CL/{año}`) | Consulta de feriados de Chile. | Pública y sin credenciales. Tiene timeout de 5 s, límite de tamaño y validación estricta. |
| **OpenStreetMap + Google Maps URLs** | Mapa de la sede y botón «Cómo llegar». | Sin API key ni facturación. |
| WhatsApp Cloud API | **Descartada** el 15/10/2026 por restricciones empresariales de Meta en el contexto académico. | Decisión documentada; no está pendiente. |

Todas las integraciones son **adaptadores** del backend: si el proveedor falla, se responde un error controlado (`502`/`503`) y el dominio (reservas y cupos) no depende de ellos.

---

## 3. Modelado de la base de datos

- **PostgreSQL 18** con **Prisma 7.10.0** (adaptador `PrismaPg`). Las tablas y columnas están en español con `snake_case` (`@@map`).
- Conteo verificado el 24/11/2026 sobre una base recién migrada (Docker E2E, PostgreSQL 18.7):

| Objeto | Cantidad |
| --- | --- |
| Modelos Prisma | 44 |
| Tablas físicas en `public` | 45 (44 del dominio + `_prisma_migrations`, la tabla de control de Prisma) |
| Tipos ENUM | 20 |
| Claves foráneas | 91 |
| Índices | 171 |
| Migraciones aplicadas | 14 |

- Núcleo del dominio: `instituciones` → `sedes` → `servicios` / `profesionales` → `disponibilidades` → `cupos_agenda` → `citas` → `historial_cambios_cita`, con `cancelaciones`, `listas_espera` (y sus preferencias), `reasignaciones` → `candidatos_reasignacion` → `ofertas_cita`, `notificaciones` y `eventos_auditoria`. Seguridad: `usuarios`, `roles`, `permisos`, `roles_permisos`, `usuarios_roles`, `sesiones_autenticacion`.
- Integridad: FKs con `ON DELETE RESTRICT` (no se borra historial en cascada), `UNIQUE` en `citas.cupo_id` (un cupo tiene como máximo una cita), FKs compuestas en reasignaciones (candidato ↔ reasignación, reasignación ↔ cupo, institución ↔ política), restricciones `CHECK` y triggers que impiden modificar versiones de la política de reasignación. La coherencia de sede, servicio y profesional de una cita con su institución se valida en la transacción de reserva y se vuelve a exigir en las consultas de reportes.
- Diagrama: `Evidencias Proyecto/Evidencias de sistema/Base de datos/`.

---

## 4. Consultas utilizadas (tener abiertas)

**a) Reserva sin doble asignación** — `appointments.service.ts`. Es una actualización condicional dentro de una transacción `Serializable`: el cupo solo pasa a `RESERVED` si sigue disponible y nadie lo cambió (`lockVersion`).

```ts
const reserved = await tx.agendaSlot.updateMany({
  where: { id: agendaSlotId, status: SlotStatus.AVAILABLE, lockVersion: slot.lockVersion,
           startsAt: { gt: writeTime }, appointment: { is: null } },
  data: { status: SlotStatus.RESERVED, lockVersion: { increment: 1 } },
});
if (reserved.count !== 1) throw new ConflictException('Agenda slot changed; retry availability');
```

**b) Alcance del panel de gestión** — `reports.scope.ts`. Es un CTE compartido por indicadores y panel; los joins exigen que sede, servicio, profesional y disponibilidad sean coherentes con la institución.

```sql
scoped_appointments AS (
  SELECT a.* FROM citas a
  JOIN sedes b ON b.id = a.sede_id AND b.institucion_id = a.institucion_id
  JOIN servicios s ON s.id = a.servicio_id AND s.institucion_id = a.institucion_id
  ...
  WHERE a.institucion_id = $1::uuid [AND a.sede_id = $2::uuid ...]
)
```

**c) Agregación con `FILTER`** — `reports-dashboard.service.ts`. Una sola pasada cuenta cada estado:

```sql
SELECT count(*) AS total,
       count(*) FILTER (WHERE st.codigo = 'ATENDIDA')     AS attended,
       count(*) FILTER (WHERE st.codigo = 'INASISTENCIA') AS "noShows",
       count(*) FILTER (WHERE st.codigo = 'CANCELADA')    AS cancelled
FROM scoped_appointments ...
```

**d) Tendencia por día en la zona horaria de la institución.** Las fechas se convierten con `AT TIME ZONE` y se agrupan por día civil. Si el período supera 62 días, el backend agrupa por semanas ISO (lunes).

**e) Lectura consistente.** Las 8 consultas del panel corren en **una transacción `RepeatableRead`**, así todos los números corresponden al mismo instante.

---

## 5. Reportería para la toma de decisiones (Panel de gestión)

- Desktop → Análisis → **Panel de gestión** muestra, en orden de lectura:
  1. Recomendaciones.
  2. Indicadores clave.
  3. Tendencia.
  4. Estado de citas y uso de agenda.
  5. Servicios con más demanda.
  6. Profesionales.
  7. Lista de espera.
- **Cómo ayuda a decidir.** Las recomendaciones son reglas transparentes con umbrales y muestras mínimas fijas, no un modelo de caja negra:

| Señal | Umbral (media / alta) | Decisión sugerida |
| --- | --- | --- |
| Inasistencia | ≥ 8 % / ≥ 15 % (mín. 10 citas cerradas) | Exigir confirmación anticipada y reforzar recordatorios por correo |
| Cancelación | ≥ 15 % / ≥ 25 % | Mantener activa la lista de espera de los servicios afectados y revisar motivos |
| Recuperación de cupos | < 50 % (mín. 3 liberados) | Revisar la política de reasignación y promover la inscripción en lista de espera |
| Ofertas expiradas | ≥ 40 % (mín. 5 ofertas) | Evaluar otro plazo de oferta y confirmar que el aviso llegue por correo |
| Ocupación | ≥ 85 % con personas esperando / < 40 % | Abrir disponibilidad en el servicio con más personas esperando / redistribuir o difundir bloques con baja demanda |

- Para evitar conclusiones con poca información, si no se alcanza la muestra mínima no se emite la alerta.

---

## 6. Metodología

- **Scrum** con 9 sprints considerados terminados y revisados por el equipo. Artefactos en `Evidencias Proyecto/Evidencias de documentación/Scrum/`: Product Vision, Product Backlog, Sprint Backlogs, Definition of Done, Daily Scrum, retrospectivas, Release Plan y Kanban.
- **Flujo Git:** cada historia en su rama, Pull Request y merge a `main`. Al 24/11/2026: **113 PRs fusionadas** y 256 commits en `main`.
- **Definition of Done** aplicada: pruebas unitarias y E2E en verde, documentación del contrato y validación manual cuando corresponde.

## 7. Lenguaje y stack

| Capa | Tecnología |
| --- | --- |
| Lenguaje | **TypeScript** 6 de punta a punta (Rust solo en el contenedor nativo de Tauri) |
| Backend | NestJS 12, Prisma 7.10, PostgreSQL 18, zod, argon2 |
| Web (pacientes) | React 19 + Vite |
| Desktop (personal) | Tauri 2 + React 19 |
| Compartido | `packages/client-core` (cliente HTTP, sesión y tipos) |
| Infraestructura | Docker Compose (DEMO y E2E aislado en `127.0.0.1:15432`) |

**Pruebas al 24/11/2026:** API **1107/1107**, Web **172/172**, Desktop **236/236**, client-core **6/6**; 24 suites E2E contra PostgreSQL real (por ejemplo, reportes **16/16**).

---

## 8. Preguntas de desarrollo frecuentes

**¿Por qué Web y Desktop?** El paciente necesita acceso desde cualquier dispositivo (Web). El personal trabaja en estaciones fijas con más información y permisos (Desktop). Ambos usan la misma API y el mismo `client-core`.

**¿Qué pasa si dos pacientes reservan el mismo cupo al mismo tiempo?** La actualización condicional con `lockVersion` dentro de `Serializable` deja pasar solo una reserva. La otra recibe `409` y vuelve a buscar. Hay una prueba E2E de concurrencia real.

**¿Cómo se recupera una hora cancelada?** Al cancelar, el cupo queda `RELEASED` y se inicia automáticamente la reasignación. Los candidatos se ordenan por prioridad y luego por antigüedad en la lista de espera (o al revés, según la política institucional). La oferta tiene un tiempo de expiración; si vence, pasa al siguiente candidato.

**¿Por qué el panel no usa una librería de gráficos?** Los gráficos son SVG propios. Así no se agregan dependencias, se controla la accesibilidad (leyenda, texto alternativo y tabla de datos) y se usa una paleta apta para daltonismo.

**¿Cómo se asegura que los indicadores son correctos?** El CTE de alcance es el mismo para indicadores y panel, y una prueba E2E compara ambos totales con datos reales. Además, conteos inconsistentes responden `503` en lugar de mostrar números erróneos.

**¿Qué mejorarían?** Notificaciones por un canal adicional autorizado, importación aprobada de feriados como bloqueos, exportación del panel a PDF/Excel y despliegue productivo con monitoreo.
