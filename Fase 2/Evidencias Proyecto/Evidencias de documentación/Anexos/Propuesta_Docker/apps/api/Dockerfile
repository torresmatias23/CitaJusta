# syntax=docker/dockerfile:1
# Contexto de build: raíz del repositorio (docker compose build api).
ARG NODE_IMAGE=node:24.11.0-bookworm-slim

# Manifiestos del monorepo: npm ci valida el lockfile contra todos los workspaces.
FROM ${NODE_IMAGE} AS manifests
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/desktop/package.json apps/desktop/
COPY packages/client-core/package.json packages/client-core/

# Compilación con dependencias de desarrollo (Prisma CLI, TypeScript).
FROM manifests AS build
# El motor de migraciones de Prisma requiere OpenSSL.
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
RUN npm ci --workspace @citajusta/api
COPY apps/api apps/api
# prisma.config.ts exige ambas URLs incluso para generate; no se conecta a ninguna base.
RUN DATABASE_URL=postgresql://build:build@localhost:5432/build \
    SHADOW_DATABASE_URL=postgresql://build:build@localhost:5432/build_shadow \
    npm run prisma:generate --workspace @citajusta/api \
 && npm run build --workspace @citajusta/api

# Herramientas operativas: migraciones, bootstrap de catálogos y seeds de desarrollo.
FROM build AS tools
WORKDIR /app/apps/api
CMD ["npx", "prisma", "migrate", "deploy"]

# Imagen de ejecución: sólo dependencias de producción y código compilado.
FROM manifests AS runtime
ENV NODE_ENV=production
RUN npm ci --workspace @citajusta/api --omit=dev && npm cache clean --force
COPY --from=build /app/apps/api/dist apps/api/dist
# email-logo.ts resuelve ../../assets desde dist/notifications.
COPY apps/api/assets apps/api/assets
WORKDIR /app/apps/api
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["node", "dist/main.js"]
