import assert from 'node:assert/strict';
import { after, before, mock, test } from 'node:test';
import { Module } from '@nestjs/common';
import { MODULE_METADATA } from '@nestjs/common/constants';
import { NestFactory } from '@nestjs/core';
import { DatabaseModule } from '../dist/database/database.module.js';
import { PrismaService } from '../dist/database/prisma.service.js';
import { Prisma } from '../dist/generated/prisma/client.js';

let app;
let baseUrl;
let storageError;
const originalProviders = Reflect.getMetadata(MODULE_METADATA.PROVIDERS, DatabaseModule);
// Keep the real AppModule, routes, guards and rate limiter. Only storage is a
// double: PrismaService is never constructed and cannot open a DB connection.
const storage = { $queryRaw: mock.fn(async query => {
  assert.match(query.sql, /INSERT INTO "limites_recuperacion_cuenta"/);
  if (storageError) throw storageError;
  return [{ allowed: true, retryAfterSeconds: 60 }];
}) };
const environmentValues = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://USER:PASSWORD@localhost:5432/DATABASE',
  JWT_ACCESS_SECRET: 'test-access-secret-with-at-least-32-characters',
  JWT_REFRESH_SECRET: 'test-refresh-secret-with-at-least-32-characters',
  OFFER_EXPIRATION_ENABLED: 'false',
  EMAIL_DELIVERY_ENABLED: 'false',
  ACCOUNT_RECOVERY_ENABLED: 'false',
  GOOGLE_AUTH_ENABLED: 'false',
  GOOGLE_CALENDAR_ENABLED: 'false',
};
const originalEnvironment = Object.fromEntries(
  Object.keys(environmentValues).map((key) => [key, process.env[key]]),
);

before(async () => {
  Object.assign(process.env, environmentValues);
  assert.ok(originalProviders.includes(PrismaService));
  // Provider metadata is local to this test process; restore it during teardown.
  Module({ providers: originalProviders.map(provider => provider === PrismaService
    ? { provide: PrismaService, useValue: storage } : provider) })(DatabaseModule);

  const { AppModule } = await import('../dist/app.module.js');
  const { configureApplication } = await import(
    '../dist/app.configuration.js'
  );
  app = await NestFactory.create(AppModule, { logger: false, abortOnError: false });
  assert.equal(app.get(PrismaService), storage);
  configureApplication(app);
  await app.listen(0, '127.0.0.1');

  const address = app.getHttpServer().address();
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  try { await app?.close(); }
  finally {
    Module({ providers: originalProviders })(DatabaseModule);
    for (const [key, value] of Object.entries(originalEnvironment)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
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
  const queriesBefore = storage.$queryRaw.mock.callCount();
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
  assert.equal(storage.$queryRaw.mock.callCount() - queriesBefore, 4, 'each versioned request must run the real limiter');
});

test('auth routes retain fail-closed 503 when rate limit storage is unavailable', async () => {
  const queriesBefore = storage.$queryRaw.mock.callCount();
  storageError = new Prisma.PrismaClientInitializationError('Synthetic storage unavailable', '7.10.0', 'P1001');
  try {
    const response = await fetch(`${baseUrl}/api/v1/auth/login`, { method: 'POST' });
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { message: 'Authentication unavailable', error: 'Service Unavailable', statusCode: 503 });
    assert.equal(storage.$queryRaw.mock.callCount() - queriesBefore, 1);
  } finally { storageError = undefined; }
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
    '/api/v1/professionals',
    `/api/v1/professionals/${id}`,
    `/api/v1/branches/${id}/professionals`,
    `/api/v1/services/${id}/professionals`,
    `/api/v1/branches/${id}/services/${id}/professionals`,
    `/api/v1/branches/${id}/services/${id}/availability`,
    `/api/v1/branches/${id}/services/${id}/professionals/${id}/availability`,
  ];

  for (const path of paths) {
    const response = await fetch(`${baseUrl}${path}`);

    assert.equal(response.status, 401, path);
  }
});
