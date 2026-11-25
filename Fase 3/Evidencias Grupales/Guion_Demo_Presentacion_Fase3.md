# Guion de demostración — Presentación final Fase 3

**Fecha de presentación:** 03/12/2026 (bloque de las 13:00 h aprox.)
**Duración objetivo de la demo:** 4 minutos
**Acuerdo de origen:** reunión de coordinación del 19/11/2026 (mostrar la aplicación con dos casos de uso, uno Web y uno Desktop, y la reportería para la toma de decisiones).

## Antes de la presentación (checklist)

| Ítem | Responsable | Listo |
| --- | --- | --- |
| API, Web y Desktop levantados con el mismo entorno DEMO | Equipo | ☐ |
| Cuenta paciente creada y verificada (Web) | Equipo | ☐ |
| Cuenta funcionario con `agenda.read`, `appointments.attendance`, `reassignments.read` y `reports.read` en la institución demo | Equipo | ☐ |
| Contexto institucional aplicado en Desktop (Sedes y servicios) | Equipo | ☐ |
| Cupos futuros disponibles (`seed:booking-demo`) y al menos una persona en lista de espera para el servicio demo | Equipo | ☐ |
| Historial con citas atendidas, canceladas e inasistencias para que el Panel de gestión muestre tendencias y recomendaciones | Equipo | ☐ |
| Bandeja del correo de prueba abierta (Resend) y Google Calendar de la cuenta de prueba abierto | Equipo | ☐ |
| Editor con el código abierto en: `apps/api/src/appointments/appointments.service.ts`, `apps/api/src/reports/reports-dashboard.service.ts`, `apps/api/prisma/schema.prisma` | Equipo | ☐ |
| Plan de contingencia: video demo de emergencia acordado en la reunión del 19/11 | Equipo | ☐ |

> Usar solo cuentas y datos de prueba. No mostrar `.env`, tokens ni datos personales reales en pantalla.

## Caso 1 — Web: el paciente reserva y libera una hora (≈ 1 min 40 s)

| Tiempo | Acción en pantalla | Qué decir |
| --- | --- | --- |
| 0:00 – 0:20 | Portada / Inicio Web | «CitaJusta reduce las horas perdidas: cuando alguien cancela, el cupo se ofrece automáticamente a quien espera.» |
| 0:20 – 0:45 | Iniciar sesión (correo o Google) → Inicio → elegir institución, sede y servicio → **Ver ubicación** | «La sede muestra mapa OpenStreetMap y el botón Cómo llegar usa Google Maps URLs, sin API key.» |
| 0:45 – 1:10 | Buscar disponibilidad «Próximos 7 días» → elegir cupo → **Reservar** | «La reserva es atómica: si dos personas eligen el mismo cupo, solo una lo obtiene; la otra recibe un conflicto y vuelve a buscar.» |
| 1:10 – 1:30 | **Mis citas** → Agregar a Google Calendar → mostrar correo de confirmación | «El correo transaccional sale por Resend y la cita se agrega al calendario del usuario; CitaJusta sigue siendo la fuente de verdad.» |
| 1:30 – 1:40 | **Cancelar** la cita | «Al cancelar, el cupo queda liberado y entra al proceso de reasignación.» |

## Caso 2 — Desktop: el funcionario gestiona y decide (≈ 2 min)

| Tiempo | Acción en pantalla | Qué decir |
| --- | --- | --- |
| 1:40 – 2:00 | Desktop → Inicio con contexto institucional aplicado | «La aplicación Desktop es para el personal: cada acción exige un permiso y queda limitada a su institución o sede.» |
| 2:00 – 2:25 | **Reasignaciones** → proceso del cupo liberado → candidato ofertado | «El ranking ordena por prioridad y luego por tiempo de espera según la política vigente; la oferta expira si no se responde.» |
| 2:25 – 2:45 | **Asistencia** → marcar una cita como Atendida y otra como Inasistencia | «El cambio de estado queda en el historial de la cita y en la auditoría.» |
| 2:45 – 3:35 | **Análisis → Panel de gestión** → leer primero **Recomendaciones**, luego KPIs, tendencia y servicios con más demanda; cambiar a «Últimos 90 días» | «Este panel resume toda la operación para decidir. Por ejemplo: si la inasistencia supera el umbral, recomienda exigir confirmación; si hay personas esperando y la ocupación es alta, recomienda abrir cupos en el servicio con más demanda.» |
| 3:35 – 3:45 | **Auditoría** → filtrar por la acción recién realizada | «Toda acción sensible es trazable.» |

## Cierre (≈ 15 s)

| Tiempo | Qué decir |
| --- | --- |
| 3:45 – 4:00 | «En resumen: reserva justa y concurrente, recuperación automática de cupos y un panel que convierte los datos en decisiones. Quedamos atentos a sus preguntas.» |

## Si algo falla

- **Sin red o proveedor externo caído:** omitir Google/Resend y seguir con el flujo interno; explicar que las integraciones son adaptadores y no bloquean la reserva.
- **Panel sin datos:** cambiar a «Últimos 90 días» o quitar filtros; si sigue vacío, mostrar la recomendación «Sin actividad en el período» y explicar los umbrales.
- **Falla general:** reproducir el video demo de emergencia acordado el 19/11.

## Material relacionado

- Guía de preguntas: [Guia_Preguntas_Defensa_Fase3.md](Guia_Preguntas_Defensa_Fase3.md)
- Panel de gestión (contrato y uso): [README raíz — HU-037 Fase 3](../../README.md#hu-037-fase-3-panel-de-gestión-para-la-toma-de-decisiones) y [README Desktop](../../apps/desktop/README.md#panel-de-gestión-hu-037-fase-3)
