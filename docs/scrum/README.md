# Daily Scrum — CitaJusta

Este directorio contiene la evidencia y documentación relacionada con el proceso de Daily Scrum del proyecto CitaJusta.

## Objetivo

El Daily Scrum permite registrar de manera breve y trazable el avance diario del equipo, identificando:

- trabajo realizado desde la última Daily;
- trabajo planificado;
- impedimentos o bloqueos;
- evidencia asociada al desarrollo;
- acuerdos y próximos pasos.

El registro se integra con GitHub Issues, Pull Requests, commits y GitHub Projects.

## Equipo

- Matías Torres
- Bastian Sepúlveda
- Diego Simón

Ingeniería en Informática
Duoc UC — Puente Alto
Capstone 2026

---

## Formato del Daily

Cada Daily Scrum utiliza la siguiente estructura:

### ¿Qué completaste desde la última Daily?

Trabajo realizado por cada integrante desde el último registro.

### ¿Qué harás ahora?

Trabajo que se realizará durante la siguiente jornada o iteración.

### Bloqueos

Problemas técnicos, académicos u organizacionales que dificultan el avance.

Cuando no existan impedimentos se registra:

`Ninguno.`

### Evidencia

Siempre que sea posible se debe asociar evidencia verificable:

- Issue de GitHub;
- Pull Request;
- commit;
- rama;
- resultado de pruebas;
- documento actualizado;
- movimiento en el tablero Kanban.

---

## Registro en GitHub Issues

Los Daily Scrum se registran mediante GitHub Issues.

La plantilla se encuentra en:

`.github/ISSUE_TEMPLATE/daily-scrum.md`

El título utilizado es:

`Daily Scrum · YYYY-MM-DD`

Ejemplo:

`Daily Scrum · 2026-09-10`

Los Issues utilizan la etiqueta:

`daily-scrum`

---

## Automatización

El workflow:

`.github/workflows/daily-scrum.yml`

crea automáticamente un Issue de Daily Scrum de lunes a viernes.

El workflow:

- utiliza la zona horaria `America/Santiago` para determinar la fecha;
- crea la etiqueta `daily-scrum` cuando sea necesario;
- verifica si ya existe un Daily para esa fecha;
- evita la creación de registros duplicados;
- utiliza únicamente permisos mínimos sobre Issues;
- también puede ejecutarse manualmente mediante `workflow_dispatch`.

El cron de GitHub Actions se ejecuta en UTC.

La programación está configurada alrededor de las 12:00 UTC, equivalente aproximadamente a las 08:00 o 09:00 en Chile, dependiendo del horario estacional.

---

## Ejecución manual

Si el Daily automático no se ejecuta, existen dos alternativas.

### Desde GitHub Actions

1. Ir a `Actions`.
2. Seleccionar `Daily Scrum`.
3. Seleccionar `Run workflow`.
4. Ejecutar sobre la rama `main`.

### Desde GitHub Issues

1. Ir a `Issues`.
2. Seleccionar `New issue`.
3. Seleccionar la plantilla `Daily Scrum`.
4. Completar la información del día.
5. Crear el Issue.

---

## GitHub Projects

Los Issues de Daily Scrum pueden incorporarse automáticamente al tablero de GitHub Projects.

Se recomienda configurar un workflow de GitHub Projects utilizando:

`Auto-add to project`

con un filtro basado en la etiqueta:

`label:daily-scrum`

De esta forma, cada nuevo Daily Scrum quedará incorporado al Project utilizado por CitaJusta.

---

## Historial anterior a la automatización

El equipo comenzó a formalizar el uso de Daily Scrum mediante GitHub Issues el 10 de septiembre de 2026.

El archivo:

`docs/scrum/DAILY_SCRUM_HISTORY.md`

contiene una reconstrucción histórica de avances anteriores utilizando evidencia verificable del repositorio.

Las fuentes consideradas incluyen:

- commits;
- Pull Requests;
- Issues;
- Kanban;
- resultados de pruebas;
- documentación técnica y académica.

## Importante

Los registros históricos reconstruidos NO representan necesariamente reuniones Daily realizadas en esas fechas.

Se mantienen identificados expresamente como registros retrospectivos para conservar la transparencia y trazabilidad académica.

La reunión del 3 de septiembre de 2026 sí corresponde a una reunión real del equipo, realizada mediante Discord y respaldada por la minuta del proyecto.

---

## Uso desde el 10 de septiembre de 2026

Desde esta fecha, el objetivo es registrar formalmente el Daily Scrum en GitHub y utilizarlo como fuente principal de evidencia.

El flujo recomendado es:

Daily Scrum
→ GitHub Issue
→ Evidencia de Issues / PR / commits
→ GitHub Projects
→ Registro académico del proyecto

Esto permite mantener alineados el proceso Scrum, el desarrollo técnico y la documentación académica de CitaJusta.
