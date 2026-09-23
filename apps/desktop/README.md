# CitaJusta Desktop

Cliente institucional del monorepo npm, construido con Tauri 2, React,
TypeScript, Vite y Rust. HU-028 incorpora login real mediante el núcleo compartido
`@citajusta/client-core`: HTTP, sesión, rotación de refresh y protección frente a
respuestas tardías. Web conserva sus adaptadores de almacenamiento y navegación.

Tauri/Rust actúa como host nativo. Desktop consume la misma API REST que Web;
el backend conserva la autoridad de autenticación, autorización, aislamiento
tenant, disponibilidad, reasignaciones y auditoría. Desktop no accede
directamente a PostgreSQL ni Prisma.

## Desarrollo

Desde la raíz, con las dependencias del workspace y los prerrequisitos locales
de Tauri/Rust disponibles:

```powershell
if (-not (Test-Path apps/desktop/.env)) { Copy-Item apps/desktop/.env.example apps/desktop/.env }
npm run build -w @citajusta/api
npm run start -w @citajusta/api
```

Con PostgreSQL y el entorno API ya preparados, mantener la API en la primera
terminal. En una segunda terminal, desde la raíz:

```powershell
npm run build -w @citajusta/desktop
npm run tauri -w @citajusta/desktop -- dev
```

Configurar `VITE_API_BASE_URL=http://localhost:3000/api/v1`. Debe ser una URL
absoluta HTTP(S), sin credenciales, query ni hash, con ruta `/api/v1`. Una
configuración ausente/inválida muestra un error controlado, sin exponer su valor.
Vite utiliza el puerto 1420. La capability conserva `core:default` y añade sólo
`http:default` con scope `http://localhost:3000/api/v1/**`. El fetch de Tauri HTTP
se inyecta al cliente compartido, sin proxy WebView ni cambios CORS en el backend.
No sigue redirecciones (`maxRedirections: 0`); el plugin también verifica el scope
de redirects. Rust utiliza TLS sin habilitar cookies, proxy de sistema ni opciones
inseguras. Otro host requerirá revisar explícitamente el scope antes de distribuir.
`src-tauri/Cargo.lock` debe versionarse por ser una aplicación ejecutable;
`target/` y `gen/schemas` son generados e ignorados. npm utiliza el lock de la raíz.

## Alcance actual

Access y refresh tokens viven únicamente en memoria; no hay persistencia segura
implementada ni almacenamiento en archivos, preferencias o almacenamiento Web.
Cerrar/reabrir la aplicación exige login nuevamente. Logout limpia inmediatamente
la sesión local e intenta revocar el refresh en la API. Un fallo de red no impide
el cierre local, aunque la revocación remota no pueda confirmarse.

La shell sólo se muestra tras login y `GET users/me` exitosos. Muestra nombre,
correo, contexto y roles reales. No tener institución/sede se representa como tal:
el cliente no inventa permisos. Las ocho secciones siguen siendo preparación;
sedes/servicios, profesionales, agenda, asistencia, reasignaciones, reportes y
auditoría se implementarán en HU posteriores. No hay registro Desktop.

## Validación manual

Usar una cuenta controlada ACTIVE ya creada por los mecanismos existentes, con
su contraseña conocida por el propietario. No usar usuarios técnicos demo sin
login ni inventar credenciales. Antes del login debe verse el formulario; después,
la shell y el perfil devuelto por la API. Sin contexto institucional debe indicarse
su ausencia. Cerrar sesión debe volver al formulario. Volver a iniciar sesión,
cerrar la ventana nativa y abrirla nuevamente debe exigir las credenciales.

```powershell
npm run typecheck -w @citajusta/client-core
npm test -w @citajusta/client-core
npm test -w @citajusta/desktop
cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml
```
