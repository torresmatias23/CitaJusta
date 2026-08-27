# CitaJusta: memoria operativa

## Arquitectura

- Monorepo administrado con npm workspaces.
- Clientes web y de escritorio consumen la misma API REST.
- Backend NestJS como monolito modular y autoridad de las reglas de negocio.
- Persistencia PostgreSQL mediante Prisma.
- No usar microservicios en la etapa inicial.

## Stack

- TypeScript.
- Backend: NestJS.
- Web: React y Vite.
- Escritorio: Tauri y React.
- Datos: PostgreSQL y Prisma.
- Autenticación: JWT Access Token y Refresh Token; autorización RBAC.
- Control de versiones: Git y GitHub.

## Estructura prevista del repositorio

```text
apps/
  backend/   # API y lógica de negocio
  web/       # cliente React/Vite
  desktop/   # cliente Tauri/React
packages/    # código compartido solo cuando exista una necesidad real
docs/
  development/
```

Esta estructura aún no está creada; debe incorporarse de forma incremental.

## Convenciones

- Respetar `.editorconfig`: UTF-8, LF, indentación de 2 espacios y newline final.
- Mantener la lógica crítica y las transiciones de estado en el backend.
- Evitar duplicar reglas de dominio entre clientes.
- Mantener límites modulares explícitos y dependencias entre módulos controladas.
- Limitar cada cambio al alcance solicitado.

## Eficiencia de contexto y CodeGraph

- Cuando CodeGraph esté disponible, usarlo primero para comprender módulos, símbolos, dependencias, callers/callees, impacto y contexto de edición.
- No leer archivos completos innecesariamente cuando CodeGraph pueda entregar contexto preciso.
- Antes de modificar código existente:

  1. Consultar el contexto relevante.
  2. Identificar dependencias.
  3. Identificar pruebas relacionadas.
  4. Evaluar el impacto.
  5. Recién entonces editar.

- CodeGraph sirve para navegación y comprensión, pero no es la única fuente de verdad.
- Antes de editar un archivo crítico, comprobar siempre el código fuente real.
- Si CodeGraph no está disponible, usar búsqueda dirigida, `rg`/ripgrep, árbol de directorios, lectura parcial, `git diff` y `git status`.
- No volver a leer archivos conocidos si no cambiaron ni cargar todo el repositorio en contexto.
- Excluir `node_modules`, `dist`, `build`, `coverage`, `.git`, `.vite`, `target`, archivos generados, binarios y logs.

## Comandos conocidos actualmente

```powershell
node --version
npm --version
git --version
rustc --version
cargo --version
& 'C:\Program Files\PostgreSQL\18\bin\psql.exe' --version
```

Todavía no existen `package.json`, workspaces ni scripts del proyecto.

## Reglas críticas de seguridad e integridad

- Mantener secretos fuera del código y nunca registrar tokens ni passwords.
- Validar entradas, autenticación, autorización RBAC y pertenencia institucional en el backend.
- Aplicar aislamiento multi-tenant en cada acceso a datos.
- Configurar CORS explícito, rate limiting y auditoría.
- Ejecutar reservas, cancelaciones, ofertas y reasignaciones críticas con transacciones y constraints de base de datos.
- Impedir siempre la doble asignación de un mismo cupo, incluso ante concurrencia.
- El backend decide scoring, elegibilidad, expiraciones y transiciones de estado; los clientes no son autoridad.

## Reglas de trabajo incremental

- No añadir dependencias, scaffolding o abstracciones sin una necesidad solicitada.
- Hacer cambios pequeños, verificables y compatibles con la arquitectura acordada.
- Preservar cambios ajenos y revisar el estado del repositorio antes y después de trabajar.
- No hacer commits ni cambiar de rama salvo solicitud explícita.
- Actualizar documentación técnica solo cuando cambie una decisión o el comportamiento real.
