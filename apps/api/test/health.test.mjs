import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../dist/app.module.js';

let app;
let baseUrl;

before(async () => {
  app = await NestFactory.create(AppModule, { logger: false });
  await app.listen(0, '127.0.0.1');

  const address = app.getHttpServer().address();
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await app.close();
});

test('GET /health returns an ok status', async () => {
  const response = await fetch(`${baseUrl}/health`);

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: 'ok' });
});
