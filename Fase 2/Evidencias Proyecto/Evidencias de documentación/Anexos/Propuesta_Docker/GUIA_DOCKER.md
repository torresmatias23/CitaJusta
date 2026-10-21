# Docker y Docker Compose — propuesta de integración

Entorno reproducible de CitaJusta con PostgreSQL, API NestJS y Web React servida por nginx. La aplicación Desktop (Tauri) es nativa y se ejecuta fuera de Docker contra la API publicada en `http://localhost:3000/api/v1`.

Configuración Docker preparada y verificada el 17-10-2026 sobre `865a7d0` con Docker 29.4.0 y Docker Compose v5.1.1: build completo en 1 min 05 s, todos los servicios `healthy`, 12 migraciones aplicadas, bootstrap y seed demo correctos, y flujo principal reserva → lista de espera → cancelación → oferta → aceptación probado a través de nginx.

**Estado:** se entrega en esta carpeta (`Fase 2/Entrega Final Fase 2/Anexos/Propuesta_Docker/`) para que el responsable del código, Matías Torres, la integre en el repositorio. Todavía no forma parte de la raíz del repositorio.

## Integración en el repositorio

El anexo replica la estructura del repositorio. Copiar cada archivo a su ruta de destino, relativa a la raíz:

| Archivo en este anexo | Ruta de destino |
| --- | --- |
| `docker-compose.yml` | `docker-compose.yml` |
| `.env.example` | `.env.example` (plantilla de Compose; no reemplaza a `apps/api/.env.example`) |
| `.dockerignore` | `.dockerignore` |
| `apps/api/Dockerfile` | `apps/api/Dockerfile` |
| `apps/web/Dockerfile` | `apps/web/Dockerfile` |
| `apps/web/nginx.conf` | `apps/web/nginx.conf` |
| `GUIA_DOCKER.md` | `docs/development/DOCKER.md` (opcional; enlazar desde la sección Docker del README) |

Después de copiar los archivos, los comandos de esta guía se ejecutan desde la raíz del repositorio.

## Servicios

| Servicio | Imagen / build | Puerto en el host | Función |
| --- | --- | --- | --- |
| `db` | `postgres:18-alpine` | `127.0.0.1:5433` | Base `citajusta_dev`; volumen `pgdata`; healthcheck `pg_isready` |
| `migrate` | `apps/api/Dockerfile`, etapa `tools` | — | Tarea única: `prisma migrate deploy` + `bootstrap-appointment-status` + `bootstrap-waitlist` |
| `api` | `apps/api/Dockerfile`, etapa `runtime` | `3000` | `node dist/main.js` como usuario `node`; healthcheck `GET /health` |
| `web` | `apps/web/Dockerfile` | `8080` | nginx sirve la SPA y publica `/api/v1` en el mismo origen |
| `seed` | imagen `tools` (perfil `demo`) | — | Datos demo opcionales; comparte la red de `db` |

Orden de arranque: `db` healthy → `migrate` termina con código 0 → `api` healthy → `web`.

## Primer arranque

```powershell
Copy-Item .env.example .env
# Completar POSTGRES_PASSWORD (sin caracteres especiales de URL), JWT_ACCESS_SECRET y JWT_REFRESH_SECRET.
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
docker compose up -d --build
docker compose ps
```

Sin `POSTGRES_PASSWORD` o sin los secretos JWT, Compose se detiene con un mensaje como `required variable POSTGRES_PASSWORD is missing a value`. El archivo `.env` está ignorado por Git.

- Web: `http://localhost:8080`
- API: `http://localhost:3000/health` y `http://localhost:3000/api/v1`
- PostgreSQL desde el host: `127.0.0.1:5433`, base `citajusta_dev`

## Datos demo

```powershell
docker compose --profile demo run --rm seed
docker compose --profile demo run --rm seed node scripts/seed-booking-demo.mjs
```

El primero crea Institución Demo CitaJusta, Sede Centro Demo y Atención General Demo. El segundo crea un profesional y cupos futuros mediante los servicios administrativos. Ambos son idempotentes.

El servicio `seed` usa `network_mode: service:db` para conectarse por `127.0.0.1`. Así conserva la protección de `seed:dev`, que sólo acepta `NODE_ENV=development`, host loopback y base `citajusta_dev`.

Los seeds de perfiles Desktop requieren una cuenta ya registrada desde la Web:

```powershell
docker compose --profile demo run --rm -e DESKTOP_CATALOG_ADMIN_EMAIL=persona@example.test seed node scripts/seed-desktop-catalog-admin.mjs
```

Variables disponibles: `DESKTOP_CATALOG_ADMIN_EMAIL`, `DESKTOP_PROFESSIONAL_ADMIN_EMAIL`, `DESKTOP_AGENDA_READER_EMAIL`, `DESKTOP_AVAILABILITY_ADMIN_EMAIL`, `DESKTOP_ATTENDANCE_OPERATOR_EMAIL`, `DESKTOP_REASSIGNMENT_SUPERVISOR_EMAIL`, `DESKTOP_REPORTS_READER_EMAIL` y `DESKTOP_AUDIT_READER_EMAIL`; cada una tiene su script `scripts/seed-desktop-*.mjs`.

## Operación

```powershell
docker compose logs -f api web          # registros
docker compose stop                     # detener conservando datos
docker compose up -d                    # reanudar
docker compose up -d --build            # reconstruir tras cambios de código
docker compose run --rm migrate         # reaplicar migraciones y bootstrap (idempotente)
docker compose down                     # eliminar contenedores, conservar el volumen
docker compose down -v                  # ¡borra el volumen pgdata y toda la base!
```

Respaldo y restauración (probados el 17-10-2026 en una base temporal, con conteos idénticos de tablas, migraciones, usuarios, citas y cupos). El archivo se genera dentro del contenedor y se copia con `docker compose cp`: redirigir con `>` en Windows PowerShell 5.1 corrompe un dump binario.

```powershell
# Respaldo
docker compose exec db sh -c 'pg_dump -U "$POSTGRES_USER" -Fc -f /tmp/citajusta_dev.dump citajusta_dev'
docker compose cp db:/tmp/citajusta_dev.dump ./citajusta_dev.dump

# Restauración en una base nueva
docker compose cp ./citajusta_dev.dump db:/tmp/citajusta_dev.dump
docker compose exec db sh -c 'createdb -U "$POSTGRES_USER" citajusta_restore && pg_restore -U "$POSTGRES_USER" -d citajusta_restore --no-owner /tmp/citajusta_dev.dump'
```

Los respaldos contienen datos personales: guardarlos fuera del repositorio y con acceso restringido.

## Variables de Compose

Plantilla: `.env.example` de la raíz (incluida en este anexo).

| Variable | Default | Uso |
| --- | --- | --- |
| `POSTGRES_USER` | `citajusta` | Usuario del contenedor PostgreSQL |
| `POSTGRES_PASSWORD` | obligatorio | Contraseña; se interpola en `DATABASE_URL` |
| `POSTGRES_HOST_PORT` | `5433` | Puerto del host (sólo loopback) |
| `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` | obligatorios | ≥ 32 caracteres y distintos entre sí |
| `API_HOST_PORT` / `WEB_HOST_PORT` | `3000` / `8080` | Puertos publicados |
| `EMAIL_DELIVERY_ENABLED`, `RESEND_API_KEY`, `RESEND_FROM` | deshabilitado | Correo Resend (HU-039) |
| `GOOGLE_AUTH_ENABLED`, `GOOGLE_CLIENT_ID` | deshabilitado | Google OAuth (HU-040); el client ID también se incrusta en la Web |
| `GOOGLE_CALENDAR_ENABLED`, `GOOGLE_CALENDAR_CLIENT_SECRET`, `GOOGLE_CALENDAR_REDIRECT_URI` | deshabilitado, `http://localhost:8080` | Google Calendar (HU-041); el origen debe coincidir exactamente con la Web |

La API valida su configuración al arrancar (`apps/api/src/config/environment.validation.ts`) y se detiene con `Invalid environment configuration` si algún valor es inválido.

## Decisiones

- **Mismo origen:** la API no habilita CORS, así que nginx publica `/api/v1` junto a la SPA. La Web se compila con `VITE_API_BASE_URL=/api/v1`.
- **Imagen `tools` vs. `runtime`:** las migraciones necesitan Prisma CLI, `prisma.config.ts` y `dotenv` (devDependencies). La imagen `runtime` sólo lleva dependencias de producción, `dist/` y `assets/`, y se ejecuta como usuario no root.
- **Puerto 5433:** evita el choque con un PostgreSQL local en 5432 y sólo escucha en `127.0.0.1`.
- **Desktop fuera de Docker:** su capability Tauri permite únicamente `http://localhost:3000/api/v1/**`, por eso la API se publica en el puerto 3000.

## Limitaciones

- Sin HTTPS: para un despliegue público se necesita un proxy inverso con TLS delante de `web`.
- Tamaño de imágenes: `api` 926 MB, `tools` 1,21 GB y `web` 97,5 MB.
- Los secretos se entregan por `.env`; no hay gestor de secretos.
- No hay CORS explícito, rate limiting ni cabeceras de seguridad en la API; nginx agrega `X-Content-Type-Options`, `X-Frame-Options` y `Referrer-Policy`.
- `GET /health` no comprueba la conexión a PostgreSQL.
