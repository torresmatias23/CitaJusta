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

Booking queda para fase 2: necesita identidad profesional, relaciones y disponibilidad mediante los servicios existentes de administración/materialización, sin insertar cupos manualmente.

## Validación del flujo

```powershell
npm test -w @citajusta/web
npm run build -w @citajusta/web
npm run test:e2e:waitlist -w @citajusta/api
git diff --check
```

Vite dev exige el proxy. Build/preview no lo usan: producción requiere reverse proxy para `/api/v1` o una URL API explícita con CORS autorizado. Nunca incluir secretos en variables `VITE_*`.
