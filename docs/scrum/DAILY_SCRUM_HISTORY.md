# Historial Daily Scrum — CitaJusta

Este documento consolida retrospectivamente avances verificables del proyecto CitaJusta a partir de commits, Pull Requests, Issues, Kanban y documentación existente.

Los registros anteriores a la implementación formal del Daily Scrum en GitHub corresponden a una reconstrucción histórica y no deben interpretarse como reuniones Daily realizadas en esas fechas.

---

## 2026-08-27

### Trabajo realizado

- Inicio del desarrollo técnico del proyecto.
- Configuración inicial del monorepo con npm workspaces.
- Creación de la base de la API con NestJS.
- Implementación del endpoint de salud.
- Creación de documentación inicial de arquitectura y configuración.

### Resultado

Base técnica inicial del proyecto preparada.

### Bloqueos documentados

Ninguno registrado.

---

## 2026-08-28

### Trabajo realizado

- Configuración e inicialización de CodeGraph.
- Creación y actualización de reglas de trabajo en `AGENTS.md`.
- Actualización de documentación de arquitectura, decisiones y setup.
- Exclusión de `.codegraph` del repositorio.

### Resultado

Mejora del flujo de desarrollo y reducción del contexto necesario para análisis del código.

### Bloqueos documentados

Ninguno registrado.

---

## 2026-08-29

### Trabajo realizado

- Implementación de validación del entorno del backend mediante Zod.
- Configuración de variables `NODE_ENV` y `PORT`.
- Ajuste de scripts de build, start y test.

### Resultado

API con configuración de entorno validada y reproducible.

### Bloqueos documentados

Ninguno registrado.

---

## 2026-08-31

### Trabajo realizado

- Avance del módulo de Agenda Base.
- Implementación de catálogos, profesionales y disponibilidad.
- Integración de trabajo correspondiente al Sprint 4.
- Preparación de checkpoint E2E con PostgreSQL real.

### Resultado

Agenda Base funcional a nivel de backend y preparada para validación real.

### Bloqueos documentados

PostgreSQL local aún no se encontraba disponible para ejecutar el checkpoint real.

---

## 2026-09-03

### Trabajo realizado

Reunión real del equipo realizada por Discord aproximadamente a las 20:00.

Acuerdos:

- Matías Torres: coordinación y revisión general de documentación.
- Bastian Sepúlveda: avance y revisión documental.
- Diego Simón: preparación de la presentación de la primera evaluación.
- Revisión final conjunta antes de la entrega.

### Resultado

Distribución de responsabilidades para completar la primera evaluación.

### Bloqueos documentados

Además, el entorno local de PostgreSQL se encontraba detenido, impidiendo ejecutar el checkpoint E2E real en ese momento.

---

## 2026-09-06

### Trabajo realizado

- Implementación de HU-004: Reservar una cita.
- Reserva mediante transacción Serializable.
- Protección contra doble asignación.
- Uso de `lockVersion`.
- Integración mediante PR #35.

### Resultado

Reserva de citas implementada y protegida frente a concurrencia.

### Bloqueos documentados

Ninguno registrado.

---

## 2026-09-07

### Trabajo realizado

- Implementación de HU-005: Consultar mis citas.
- Validación del checkpoint E2E con PostgreSQL real.

### Resultado

- Consulta autenticada de citas propias disponible.
- Agenda Base validada con PostgreSQL real.

### Evidencia

- Backend: 96/96 pruebas al momento del cierre de HU-005.
- E2E appointments: 14/14.

### Bloqueos documentados

Ninguno registrado.

---

## 2026-09-08

### Trabajo realizado

- Implementación de HU-006: Cancelar una cita.
- Cancelación transaccional e idempotente.
- Cambio de AgendaSlot desde `RESERVED` a `RELEASED`.
- Avance de la aplicación web React/Vite/TypeScript.

### Resultado

Núcleo de reserva, consulta y cancelación de citas disponible.

### Bloqueos documentados

Ninguno registrado.

---

## 2026-09-09

### Trabajo realizado

- Integración de frontend con autenticación.
- Integración de instituciones, sedes, servicios, profesionales y disponibilidad.
- Integración del flujo de reserva, confirmación y Mis citas.
- Validación E2E entre Web, API y PostgreSQL.
- Actualización de documentación académica y Capstone.
- Integración mediante PR #43 y PR #44.

### Resultado

Flujo principal web-backend validado de punta a punta.

### Evidencia

- Backend: 114/114 PASS.
- Web: 39/39 PASS.
- E2E appointments: 22/22 PASS.
- Web/API/PostgreSQL: 13/13 PASS.
- Sprint 5: 6/8 tareas completadas.

### Bloqueos documentados

Ninguno registrado.

---

## 2026-09-10

### Trabajo realizado

- Incorporación de evidencias individuales de Fase 1.
- Evidencias individuales completadas: 9/9.
- Implementación de HU-007: Ingresar a lista de espera.
- Implementación de consulta de solicitudes activas propias.
- Bootstrap de estado `ACTIVE` y prioridad `STANDARD`.
- Prevención de duplicados activos.
- Validación de concurrencia real con PostgreSQL.
- Integración mediante PR #46.
- Actualización del Kanban.
- HU-007 movida a Done.
- HU-008 movida a Ready.
- HU-009 permanece en Backlog.
- Inicio de formalización del Daily Scrum dentro de GitHub.

### Resultado

Sprint 5 queda en 7/8 tareas completadas.

### Evidencia

- Backend: 144/144 PASS.
- HU-007/bootstrap: 34/34 PASS.
- E2E waitlist PostgreSQL: 17/17 PASS.
- E2E appointments: 22/22 PASS.
- Checkpoint PostgreSQL: 1/1 PASS.
- Kanban: 15 elementos acumulados en Done.

### Bloqueos documentados

Se alcanzó el límite de uso de Codex durante la preparación de la automatización del Daily Scrum. La configuración continuó manualmente.

---

# Estado actual

## Sprint 5

**7/8 tareas completadas.**

### Done

- HU-004 Reservar una cita.
- HU-005 Consultar mis citas.
- HU-006 Cancelar una cita.
- HU-007 Ingresar a lista de espera.
- Fundación de aplicación web.
- Integración frontend con Auth, catálogos y disponibilidad.
- Validación Web/API/PostgreSQL del núcleo de citas.

### Ready

- HU-008 Gestionar preferencias de lista de espera.

### Backlog

- HU-009 Generar oferta de cupo.

---

Desde el 10 de septiembre de 2026, el equipo utilizará GitHub Issues como registro formal del Daily Scrum.
