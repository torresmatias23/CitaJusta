import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { NestFactory } from '@nestjs/core';

let app;
let baseUrl;
const environmentValues = {
  DATABASE_URL: 'postgresql://USER:PASSWORD@localhost:5432/DATABASE',
  JWT_ACCESS_SECRET: 'test-access-secret-with-at-least-32-characters',
  JWT_REFRESH_SECRET: 'test-refresh-secret-with-at-least-32-characters',
};
const originalEnvironment = Object.fromEntries(
  Object.keys(environmentValues).map((key) => [key, process.env[key]]),
);

before(async () => {
  Object.assign(process.env, environmentValues);

  const { AppModule } = await import('../dist/app.module.js');
  const { configureApplication } = await import(
    '../dist/app.configuration.js'
  );
  app = await NestFactory.create(AppModule, { logger: false });
  configureApplication(app);
  await app.listen(0, '127.0.0.1');

  const address = app.getHttpServer().address();
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await app.close();

  for (const [key, value] of Object.entries(originalEnvironment)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

test('GET /health returns an ok status', async () => {
  const response = await fetch(`${baseUrl}/health`);

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: 'ok' });
});

test('GET /api/v1/health is not a route', async () => {
  const response = await fetch(`${baseUrl}/api/v1/health`);

  assert.equal(response.status, 404);
});

test('auth routes use only the /api/v1 prefix', async () => {
  for (const action of ['register', 'login', 'refresh', 'logout']) {
    const versionedResponse = await fetch(
      `${baseUrl}/api/v1/auth/${action}`,
      { method: 'POST' },
    );
    const legacyResponse = await fetch(`${baseUrl}/auth/${action}`, {
      method: 'POST',
    });

    assert.equal(versionedResponse.status, 400);
    assert.equal(legacyResponse.status, 404);
  }
});

test('users/me uses only the /api/v1 prefix', async () => {
  const versionedResponse = await fetch(`${baseUrl}/api/v1/users/me`);
  const legacyResponse = await fetch(`${baseUrl}/users/me`);

  assert.equal(versionedResponse.status, 401);
  assert.equal(legacyResponse.status, 404);
});

test('catalog routes require an access token', async () => {
  const id = '11111111-1111-4111-8111-111111111111';
  const paths = [
    '/api/v1/institutions',
    `/api/v1/institutions/${id}`,
    `/api/v1/institutions/${id}/branches`,
    `/api/v1/branches/${id}/services`,
    '/api/v1/services',
    `/api/v1/services/${id}`,
  ];

  for (const path of paths) {
    const response = await fetch(`${baseUrl}${path}`);

    assert.equal(response.status, 401, path);
  }
});
