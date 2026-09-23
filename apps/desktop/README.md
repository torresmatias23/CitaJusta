# CitaJusta Desktop

Cliente institucional del monorepo npm, construido con Tauri 2, React,
TypeScript, Vite y Rust. Estado: fundación de HU-027.

Tauri/Rust actúa como host nativo. Desktop consumirá la misma API REST que Web;
el backend conserva la autoridad de autenticación, autorización, aislamiento
tenant, disponibilidad, reasignaciones y auditoría. Desktop no accede
directamente a PostgreSQL ni Prisma.

## Desarrollo

Desde la raíz, con las dependencias del workspace y los prerrequisitos locales
de Tauri/Rust disponibles:

```powershell
npm run build -w @citajusta/desktop
npm run tauri -w @citajusta/desktop -- dev
```

Vite utiliza el puerto 1420. La capability mantiene únicamente `core:default`.
`src-tauri/Cargo.lock` debe versionarse por ser una aplicación ejecutable;
`target/` y `gen/schemas` son generados e ignorados. npm utiliza el lock de la raíz.

## Alcance actual

Shell institucional con selección visual local, sin autenticación, llamadas API
ni operaciones de dominio. Se incorporarán progresivamente sedes y servicios,
profesionales, agenda, asistencia, reasignaciones, reportes y auditoría.
