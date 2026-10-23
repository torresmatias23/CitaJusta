import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { test } from 'node:test';

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const compose = read('compose.yaml');
const api = read('docker/api/Dockerfile');
const web = read('docker/web/Dockerfile');
const nginx = read('docker/web/nginx.conf');

test('Compose database is private, uses PostgreSQL18 volume location and no host database URL', () => {
  const database = compose.split('  db:\n')[1].split('\n  api:')[0];
  assert.match(database, /image: postgres:18-bookworm/);
  assert.match(database, /postgres_data:\/var\/lib\/postgresql\n/);
  assert.doesNotMatch(database, /\bports:|host\.docker\.internal|citajusta_dev/);
  assert.match(database, /POSTGRES_DB: citajusta_docker/);
  assert.match(database, /001-identify\.sql:ro/);
  assert.doesNotMatch(compose, /\$\{DATABASE_URL|env_file:|external:\s*true|container_name:/);
  assert.match(compose, /127\.0\.0\.1:\$\{DOCKER_API_PORT:-3000\}:3000/);
  assert.match(compose, /127\.0\.0\.1:\$\{DOCKER_WEB_PORT:-8080\}:8080/);
});
test('healthchecks and explicit migration profile do not run migrations or seed on normal up', () => {
  assert.match(compose, /pg_isready -h 127\.0\.0\.1/);
  assert.match(compose, /fetch\('http:\/\/127\.0\.0\.1:3000\/health'\)/);
  assert.match(compose, /condition: service_healthy/);
  assert.match(compose.split('\n  migrate:')[1], /profiles: \[tools\]/);
  assert.match(read('docker/api/start.sh'), /migrate\.mjs --check\nexec "\$@"/);
  assert.doesNotMatch(read('docker/api/start.sh'), /migrate deploy|seed|bootstrap/);
});
test('database and JWT secrets are required, not baked into builds or copied from API/Web .env', () => {
  for (const key of ['DOCKER_DB_PASSWORD', 'DOCKER_JWT_ACCESS_SECRET', 'DOCKER_JWT_REFRESH_SECRET']) assert.match(compose, new RegExp(`\\$\\{${key}:\\?`));
  assert.match(compose, /EMAIL_DELIVERY_ENABLED: "false"/);
  assert.match(compose, /GOOGLE_AUTH_ENABLED: "false"/);
  assert.match(compose, /GOOGLE_CALENDAR_ENABLED: "false"/);
  assert.doesNotMatch(api + web, /COPY\s+\.\s|COPY[^\n]*\.env|ARG[^\n]*(SECRET|PASSWORD|TOKEN)/);
  assert.match(read('docker/.env.example'), /DOCKER_DB_PASSWORD=\n/);
  const ignore = read('.dockerignore');
  for (const rule of ['**/.env', '**/.env.*', '**/node_modules', '**/src/generated', '.git', '.codegraph', '**/*.dump']) assert.ok(ignore.split('\n').includes(rule));
});
test('workspace build graph uses lockfile/npm ci, Linux generation and exact Node/npm/Prisma versions', () => {
  for (const file of [api, web]) {
    assert.match(file, /FROM node:24\.11\.0-bookworm-slim/);
    assert.match(file, /COPY package\.json package-lock\.json/);
    assert.match(file, /npm ci .*--workspace @citajusta\//);
    assert.match(file, /npm --version/);
    assert.match(file, /COPY packages\/client-core\/package\.json/);
  }
  assert.match(api, /npm run prisma:generate -w @citajusta\/api/);
  assert.match(api, /npm ci --omit=dev/);
  assert.match(web, /COPY packages\/client-core\/src/);
  const dependencies = JSON.parse(read('apps/api/package.json'));
  for (const key of ['@prisma/client', '@prisma/adapter-pg']) assert.equal(dependencies.dependencies[key], '7.10.0');
  assert.equal(dependencies.devDependencies.prisma, '7.10.0');
});
test('runtime omits optional Prisma CLI without omitting required peers or changing tooling installation', () => {
  const production = api.split('FROM workspace AS production-dependencies\n')[1].split('\nFROM node-base AS runtime')[0];
  assert.match(production, /npm ci --omit=dev --omit=optional --workspace @citajusta\/api --include-workspace-root --no-audit --no-fund/);
  assert.doesNotMatch(production, /--omit=peer|--legacy-peer-deps/);
  const buildDependencies = api.split('FROM workspace AS dependencies\n')[1].split('\nFROM dependencies AS build')[0];
  assert.match(buildDependencies, /npm ci --workspace @citajusta\/api --include-workspace-root --no-audit --no-fund/);
  assert.doesNotMatch(buildDependencies, /--omit/);
  assert.match(api, /FROM build AS tooling\n/);
});
test('runtime preserves ESM package, compiled Prisma and notification logo path with unprivileged users', () => {
  assert.match(api, /\/workspace\/apps\/api\/dist \.\/dist/);
  assert.match(api, /\/workspace\/apps\/api\/assets \.\/assets/);
  assert.match(api, /COPY --chown=node:node apps\/api\/package.json \.\/package.json/);
  assert.match(api, /USER node/); assert.match(api, /CMD \["node", "dist\/main\.js"\]/);
  assert.match(web, /USER nginx/); assert.match(nginx, /pid \/tmp\/nginx.pid/);
  assert.ok(existsSync(new URL('../../apps/api/assets/logo-citajusta.png', import.meta.url)));
});
test('Web API proxy preserves prefix, auth headers, health route and SPA navigation without Vite dev', () => {
  assert.match(web, /VITE_API_BASE_URL=\/api\/v1/);
  assert.match(web, /COPY --from=build \/workspace\/apps\/web\/dist \/usr\/share\/nginx\/html/);
  assert.match(nginx, /location \^~ \/api\/v1\//);
  assert.match(nginx, /location = \/health/);
  assert.match(nginx, /proxy_pass http:\/\/citajusta_api;/);
  assert.doesNotMatch(nginx, /proxy_pass http:\/\/citajusta_api\//);
  assert.doesNotMatch(nginx, /proxy_set_header (Authorization|Origin)/);
  assert.match(nginx, /try_files \$uri \$uri\/ \/index.html/);
  assert.match(nginx, /access_log off/);
});
