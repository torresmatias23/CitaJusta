# syntax=docker/dockerfile:1
# Contexto de build: raíz del repositorio (docker compose build web).
ARG NODE_IMAGE=node:24.11.0-bookworm-slim

FROM ${NODE_IMAGE} AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/desktop/package.json apps/desktop/
COPY packages/client-core/package.json packages/client-core/
RUN npm ci --workspace @citajusta/web
COPY packages/client-core packages/client-core
COPY apps/web apps/web
# Vite incrusta las variables VITE_* al compilar: son públicas, nunca secretos.
ARG VITE_API_BASE_URL=/api/v1
ARG VITE_GOOGLE_CLIENT_ID=
ARG VITE_GOOGLE_CALENDAR_ENABLED=false
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL} \
    VITE_GOOGLE_CLIENT_ID=${VITE_GOOGLE_CLIENT_ID} \
    VITE_GOOGLE_CALENDAR_ENABLED=${VITE_GOOGLE_CALENDAR_ENABLED}
RUN npm run build --workspace @citajusta/web

# nginx sirve la SPA y publica /api/v1 en el mismo origen (la API no habilita CORS).
FROM nginx:1.28-alpine AS runtime
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=15s --timeout=5s --retries=5 CMD ["wget", "-q", "-O", "/dev/null", "http://127.0.0.1/"]
