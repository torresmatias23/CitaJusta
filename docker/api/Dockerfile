# syntax=docker/dockerfile:1
FROM node:24.11.0-bookworm-slim AS node-base
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates openssl \
    && rm -rf /var/lib/apt/lists/* \
    && test "$(npm --version)" = "11.6.1"
WORKDIR /workspace

FROM node-base AS workspace
COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/package.json
COPY apps/web/package.json ./apps/web/package.json
COPY apps/desktop/package.json ./apps/desktop/package.json
COPY packages/client-core/package.json ./packages/client-core/package.json

FROM workspace AS dependencies
RUN PRISMA_SKIP_POSTINSTALL_GENERATE=true npm ci --workspace @citajusta/api --include-workspace-root --no-audit --no-fund

FROM dependencies AS build
COPY apps/api/tsconfig*.json apps/api/prisma.config.ts ./apps/api/
COPY apps/api/prisma ./apps/api/prisma
COPY apps/api/src ./apps/api/src
COPY apps/api/assets ./apps/api/assets
# Generate needs config values, not a reachable database. No host .env enters this build.
RUN DATABASE_URL=postgresql://unused:unused@127.0.0.1:1/build \
    SHADOW_DATABASE_URL=postgresql://unused:unused@127.0.0.1:1/build_shadow \
    npm run prisma:generate -w @citajusta/api \
    && npm run build -w @citajusta/api

FROM build AS tooling
COPY docker/api/migrate.mjs ./docker/api/migrate.mjs
COPY apps/api/scripts/bootstrap-appointment-status.mjs apps/api/scripts/bootstrap-waitlist.mjs ./apps/api/scripts/
COPY apps/api/scripts/provision-docker-demo.mjs ./apps/api/scripts/
USER node
CMD ["node", "docker/api/migrate.mjs"]

FROM workspace AS production-dependencies
RUN PRISMA_SKIP_POSTINSTALL_GENERATE=true npm ci --omit=dev --workspace @citajusta/api --include-workspace-root --no-audit --no-fund

FROM node-base AS runtime
ENV NODE_ENV=production PORT=3000
WORKDIR /workspace/apps/api
COPY --from=production-dependencies --chown=node:node /workspace/node_modules /workspace/node_modules
COPY --from=build --chown=node:node /workspace/apps/api/dist ./dist
COPY --from=build --chown=node:node /workspace/apps/api/assets ./assets
COPY --from=build --chown=node:node /workspace/apps/api/prisma/migrations ./prisma/migrations
COPY --chown=node:node apps/api/package.json ./package.json
COPY --chown=node:node docker/api/migrate.mjs docker/api/start.sh /workspace/docker/api/
USER node
EXPOSE 3000
ENTRYPOINT ["sh", "/workspace/docker/api/start.sh"]
CMD ["node", "dist/main.js"]
