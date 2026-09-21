# Entorno y preparación local

## Estado actual

| Componente | Versión verificada |
| --- | --- |
| Sistema operativo | Windows |
| Node.js | 24.11.0 |
| npm | 11.6.1 |
| Git | 2.49.0.windows.1 |
| Rust | 1.91.0 |
| Cargo | 1.91.0 |
| PostgreSQL (`psql`) | 18.0 |

`.nvmrc` contiene `24.11.0`. PostgreSQL está instalado, pero su directorio `bin` todavía no está agregado a `PATH`.

## Comprobación de versiones

Ejecutar desde PowerShell en la raíz del repositorio:

```powershell
Get-Content .nvmrc
node --version
npm --version
git --version
rustc --version
cargo --version
& 'C:\Program Files\PostgreSQL\18\bin\psql.exe' --version
```

La última ruta corresponde a la instalación actualmente verificada. `Get-Command psql -ErrorAction SilentlyContinue` no devuelve un comando mientras `psql` permanezca fuera de `PATH`.

El monorepo contiene API NestJS y Web React/Vite, con npm workspaces. Prisma permanece en 7.10.0.

## Primera preparación

1. Desde la raíz: `npm ci`.
2. Comprobar `Get-Service postgresql-x64-18`. Si está detenido, iniciar desde Servicios o con permisos adecuados: `Start-Service postgresql-x64-18`.
3. Preparar las bases locales `citajusta_dev` y `citajusta_shadow` y su usuario mediante las herramientas de PostgreSQL. No reutilizar producción.
4. Copiar las plantillas sin sobrescribir archivos locales:

```powershell
if (-not (Test-Path apps/api/.env)) { Copy-Item apps/api/.env.example apps/api/.env }
if (-not (Test-Path apps/web/.env)) { Copy-Item apps/web/.env.example apps/web/.env }
```

5. Editar `apps/api/.env`: `NODE_ENV=development`, conexión local `DATABASE_URL`, `SHADOW_DATABASE_URL` separada y secretos JWT propios, distintos y aleatorios. Los valores de plantilla no son credenciales utilizables. No versionar secretos.
6. Generar cliente y comprobar/aplicar las migraciones existentes:

```powershell
npm run prisma:generate -w @citajusta/api
npm exec -w @citajusta/api -- prisma migrate status
npm exec -w @citajusta/api -- prisma migrate deploy
npm exec -w @citajusta/api -- prisma migrate status
npm run prisma:validate -w @citajusta/api
```

`status` puede devolver código no exitoso si faltan migraciones. Revisar el destino antes de `deploy`; no generar migraciones ni resetear la base.

7. Preparar catálogos y demo:

```powershell
npm run bootstrap:appointment-status -w @citajusta/api
npm run seed:dev -w @citajusta/api
npm run check:dev -w @citajusta/api
```

8. En `apps/web/.env`, mantener `VITE_API_BASE_URL=/api/v1` y configurar `API_PROXY_TARGET=http://localhost:3000`. Ajustar el puerto si corresponde. Reiniciar Vite al cambiar variables.
9. Arrancar API y Web en terminales separadas:

```powershell
npm run build -w @citajusta/api
npm run start -w @citajusta/api
# Otra terminal:
npm run dev -w @citajusta/web
```

10. Comprobar `http://localhost:3000/health`, abrir `http://127.0.0.1:5173`, registrar un usuario y probar Lista de espera con Atención General Demo / Sede Centro Demo: alta, preferencias y retiro. No se asignan roles institucionales al registro público.

## Migraciones, bootstrap, seed y fixtures

- **Migraciones:** estructura versionada; no sustituyen catálogos ni seed.
- **Bootstrap:** estados de citas; `bootstrap:waitlist` provisiona `ACTIVE`, `WITHDRAWN`, `FULFILLED` y `STANDARD` para instituciones activas existentes. Repetirlo después de añadir instituciones.
- **Seed:** crea sólo Institución Demo CitaJusta, Sede Centro Demo, Atención General Demo (30 minutos, Waitlist habilitada), vínculo activo y reutiliza el bootstrap Waitlist para esa institución. Conserva IDs `d1000000-...-0001/0002/0003` y códigos `DEMO-CENTRO` / `DEMO-ATENCION`. No crea usuarios, roles ni agenda.
- **Check:** transacción PostgreSQL `READ ONLY`; comprueba conexión, migraciones/checksums, catálogo demo, estados y STANDARD. Devuelve código 1 si falta preparación; no repara nada ni certifica ausencia completa de drift SQL.
- **Fixtures E2E:** datos temporales identificados, con limpieza propia; no son seed. Actualmente usan `DATABASE_URL` y admiten bases locales dev/test/e2e. Ejecutar suites secuencialmente; la base E2E dedicada queda para fase 2.

Seed/check aceptan únicamente `NODE_ENV=development` (o ausente), host loopback y base `citajusta_dev` o `citajusta_dev_<sufijo alfanumérico>`. Rechazan producción, shadow y parámetros alternativos de conexión (sólo se admite `schema=public`). Verifican el nombre real de la base conectada.

El seed es transaccional e idempotente: no actualiza registros compatibles ni sus timestamps. Si un ID demo tiene otra identidad, relación o configuración incompatible, falla sin sobrescribir. Colisiones de códigos/nivel también provocan rollback. Revisar la colisión; no sortearla con SQL manual.

`seed:dev` no prepara booking. Para el escenario acotado de reserva/cancelación/reasignación existe el tooling opcional descrito abajo; una agenda demo general sigue fuera de ese seed.

## Escenario local de reasignación para HU-022

Tooling opcional; `check:dev` no exige tener un escenario preparado. Reutiliza las protecciones de `seed:dev`: sólo NODE_ENV development (o ausente), loopback y base `citajusta_dev`/sufijo permitido, verificando además el nombre real de la base. No modifica `.env`, contraseñas, sesiones ni roles del destinatario. No hay cleanup global ni reset.

Desde la raíz, con PostgreSQL y configuración API preparados:

```powershell
npm run check:dev -w @citajusta/api
$env:REASSIGNMENT_DEMO_RECIPIENT_EMAIL = 'Usuario1test@test.com'
npm run seed:reassignment-demo -w @citajusta/api -- --scenario=reject
# Repetir antes de responder debe mostrar el mismo offerId/expiresAt:
npm run seed:reassignment-demo -w @citajusta/api -- --scenario=reject
```

El email se normaliza igual que en Auth. La cuenta debe existir, estar ACTIVE y no estar eliminada; no se registra una cuenta ni se obtiene su password/token. Las identidades técnicas tienen un marcador no verificable como password hash: no hay contraseña utilizable ni login emitido. El rol técnico se asigna sólo al operador demo, con permisos mínimos en la institución demo.

Se reutilizan Institución Demo CitaJusta y Sede Centro Demo. Cada combinación destinatario/escenario tiene códigos `DEMO-REASSIGN-*`, servicio de 30 minutos, usuario origen, usuario profesional y profesional propios. Así no cambia una espera/preferencia previa en Atención General Demo ni compite con otra persona en ese servicio. Servicio/relaciones, profesional/relaciones y agenda se crean mediante los servicios administrativos reales; éstos materializan un único cupo para una semana después. Sólo usuarios técnicos, rol y asignaciones/permisos fundacionales se crean directamente mediante Prisma.

La secuencia usa servicios reales de reserva → cancelación (`RELEASED`) y entrada/preferencias Waitlist → generación HU-009. No inserta ofertas/procesos ni acepta/rechaza por fuera del dominio. El destinatario recibe preferencias compatibles sólo para el nuevo servicio demo; si fueron modificadas, el tooling falla sin sobrescribirlas.

Si la institución demo no tiene política ni historial, HU-018 configura explícitamente `PRIORITY_THEN_WAITING` y **30 minutos** para pruebas locales. Si ya tiene política, se conserva intacta y HU-009 utiliza su TTL real. Nunca se fija `expiresAt` en el tooling. La política demo afecta futuros procesos de esa institución; no modifica políticas de otras instituciones.

La preparación se serializa mediante un advisory lock PostgreSQL propio del tooling; las transacciones de dominio no se sustituyen. Un fallo puede dejar recursos DEMO intermedios: la siguiente ejecución reanuda lo compatible, sin deshacer historia. Detecta colisiones por códigos, identidad, relaciones y auditoría de creación. Si la oferta ya existe, muestra esa misma; si está finalizada o venció, informa que fue consumida, sin renovar su plazo. No crea una segunda oferta ni desplaza una agenda que ya pasó.

Prueba manual de REJECT: iniciar API/Web, entrar con el destinatario en `/ofertas`, localizar **Atención Demo Reasignación REJECT**, comprobar horario/vigencia y pulsar **No puedo asistir**. Debe mostrarse Rechazada después de consultar el backend; no debe aparecer una cita transferida. No hay siguiente candidato en este servicio aislado.

Después de rechazar manualmente, preparar el escenario separado:

```powershell
npm run seed:reassignment-demo -w @citajusta/api -- --scenario=accept
```

En `/ofertas`, aceptar **Atención Demo Reasignación ACCEPT** y comprobar su cita real en `/mis-citas`. El comando nunca responde automáticamente ninguna oferta. Si el TTL venció, no lo revive: detener la prueba y revisar antes de preparar otra iteración.

Pruebas del tooling (secuenciales con otros E2E): `node --test apps/api/test/reassignment-demo.test.mjs` después del build, y `node --test --test-concurrency=1 apps/api/test/e2e/reassignment-demo.e2e.test.mjs`. El E2E usa una identidad temporal, elimina sólo sus dos escenarios/cuentas de test y conserva la fundación demo reutilizable. Nunca responde ofertas del usuario manual.

## Validación del flujo

HU-021 Web (lista de espera/preferencias) y HU-022 Web (ofertas) están implementadas. Para probar `/ofertas` con API/PostgreSQL:

1. Preparar entorno con `seed:dev` / `check:dev` como arriba. El seed no crea profesionales, agenda ni ofertas; no basta por sí solo para este escenario.
2. Con un operador autorizado, preparar profesional, relaciones y disponibilidad futura mediante los flujos institucionales existentes. No insertar cupos manualmente ni asignar roles a usuarios públicos automáticamente.
3. Registrar dos cuentas controladas de prueba. Una reserva y cancela una cita; la otra ingresa a la lista del servicio con preferencias compatibles (incluida aceptación de cualquier profesional).
4. El operador con `reassignments.generate` genera una oferta sobre el cupo `RELEASED` mediante `POST /api/v1/reassignments/:agendaSlotId/offers` y contexto institucional autorizado.
5. El destinatario abre `/ofertas`: consulta `GET /api/v1/reassignments/offers/me` sin permisos institucionales. Aceptar debe reflejar la cita transferida en Mis citas; rechazar sólo debe actualizar sus ofertas, nunca mostrar la siguiente oferta de otra persona. Para probar ambas acciones, preparar escenarios distintos.
6. Comprobar aislamiento con la otra cuenta y plazo vencido según `expiresAt`. Web no cambia estados ni expira ofertas automáticamente. El TTL lo resuelve backend desde la política institucional o el fallback global.

La consulta de ofertas es de sólo lectura, limitada a 100 recientes. No hay notificaciones automáticas ni datos demo que simulen ofertas. La prueba manual de interacción en navegador queda separada de los tests de contrato y renderizado.

```powershell
npm test -w @citajusta/web
npm run build -w @citajusta/web
npm run test:e2e:waitlist -w @citajusta/api
npm run test:e2e:reassignments -w @citajusta/api
git diff --check
```

Vite dev exige el proxy. Build/preview no lo usan: producción requiere reverse proxy para `/api/v1` o una URL API explícita con CORS autorizado. Nunca incluir secretos en variables `VITE_*`.

## HU-023: expiración automática de ofertas

El backend procesa ofertas `PENDING` con `expiresAt <= now`. Los GET de ofertas y supervisión siguen siendo de sólo lectura; el frontend no persiste expiraciones.

| Variable | Default | Valores |
| --- | --- | --- |
| `OFFER_EXPIRATION_ENABLED` | `true`, excepto `NODE_ENV=test` | `true` / `false` explícitos |
| `OFFER_EXPIRATION_INTERVAL_MS` | `30000` | Entero entre 1 y 2147483647 |
| `OFFER_EXPIRATION_BATCH_SIZE` | `50` | Entero entre 1 y 1000 |

Cuando está habilitado, el provider procesa un lote al arrancar y programa el siguiente ciclo después de terminar el anterior. Busca por vencimiento e ID ascendente; cada oferta se procesa secuencialmente en su propia transacción. Un error se registra sin payload privado y permite continuar con las demás ofertas; la pendiente vuelve a ser elegible en otro ciclo. La demora de resolución depende del intervalo y del backlog, no cambia `expiresAt`.

El runner sólo dispara la operación de dominio. La seguridad multi-instancia e idempotencia descansan en transacciones `Serializable`, actualizaciones condicionales por estado/versión y constraints PostgreSQL. Un conflicto reconocido reintenta la transacción una vez; un error transitorio persistente hace rollback y se reintentará en una ejecución posterior. No hay nuevas dependencias ni migración.

La expiración guarda `EXPIRED`, `resolvedAt` y auditoría `SYSTEM`, sin simular respuesta humana. Continúa usando ranking y política del proceso. Sin candidatos elegibles cierra `EXHAUSTED`; si el cupo/contexto ya no es utilizable cierra `CANCELLED`; una relación incoherente en un proceso activo cierra `FAILED`, sin reparar datos. Los motivos son códigos controlados. Una oferta pendiente ligada a un proceso ya terminal se considera inconsistente: rollback y aviso operativo, sin sobrescribir ese proceso.

Al cerrar NestJS se cancela el temporizador y se espera la operación en curso; Prisma se desconecta en `onApplicationShutdown`, después del drenaje. Para pruebas manuales que necesiten mantener una oferta vencida pendiente, configurar `OFFER_EXPIRATION_ENABLED=false` antes de arrancar la API. El helper de entorno E2E lo deshabilita explícitamente, incluso si `.env` lo habilita; las pruebas específicas del runner controlan su activación.

```powershell
npm run test:e2e:expiration -w @citajusta/api
```

Este E2E usa un namespace propio con UUID aleatorios, verifica carreras con PostgreSQL real y limpia sus datos y auditoría. No utiliza escenarios manuales ni IDs checkpoint.
