# syntax=docker/dockerfile:1
FROM node:24.11.0-bookworm-slim AS build
WORKDIR /workspace
RUN test "$(npm --version)" = "11.6.1"
COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/package.json
COPY apps/web/package.json ./apps/web/package.json
COPY apps/desktop/package.json ./apps/desktop/package.json
COPY packages/client-core/package.json ./packages/client-core/package.json
RUN npm ci --workspace @citajusta/web --include-workspace-root --no-audit --no-fund
COPY packages/client-core/src ./packages/client-core/src
COPY apps/web/src ./apps/web/src
COPY apps/web/public ./apps/web/public
COPY apps/web/config ./apps/web/config
COPY apps/web/index.html apps/web/tsconfig.json apps/web/vite.config.ts ./apps/web/
# Public build configuration only; production requests use the same-origin reverse proxy.
ENV VITE_API_BASE_URL=/api/v1 VITE_GOOGLE_CLIENT_ID="" VITE_GOOGLE_CALENDAR_ENABLED=false
RUN npm run build -w @citajusta/web

FROM nginx:stable-alpine AS runtime
COPY docker/web/nginx.conf /etc/nginx/nginx.conf
COPY --from=build /workspace/apps/web/dist /usr/share/nginx/html
USER nginx
EXPOSE 8080
ENTRYPOINT ["nginx", "-g", "daemon off;"]
