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
  app = await NestFactory.create(AppModule, { logger: false });
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
