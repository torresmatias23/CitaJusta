# Entorno de desarrollo verificado

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

Todavía no hay dependencias, frameworks, workspaces ni scripts del proyecto que configurar o ejecutar.
