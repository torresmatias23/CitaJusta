import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateEnvironment } from '../dist/config/environment.validation.js';

const databaseUrl = 'postgresql://USER:PASSWORD@localhost:5432/DATABASE';
const jwtAccessSecret = 'test-access-secret-with-at-least-32-characters';
const jwtRefreshSecret =
  'test-refresh-secret-with-at-least-32-characters';
const validEnvironment = {
  DATABASE_URL: databaseUrl,
  JWT_ACCESS_SECRET: jwtAccessSecret,
  JWT_REFRESH_SECRET: jwtRefreshSecret,
};

test('environment validation applies safe defaults', () => {
  assert.deepEqual(validateEnvironment(validEnvironment), {
    NODE_ENV: 'development',
    PORT: 3000,
    DATABASE_URL: databaseUrl,
    JWT_ACCESS_SECRET: jwtAccessSecret,
    JWT_REFRESH_SECRET: jwtRefreshSecret,
    JWT_ACCESS_TTL_SECONDS: 900,
    JWT_REFRESH_TTL_SECONDS: 2_592_000,
  });
});

test('environment validation accepts and coerces valid values', () => {
  assert.deepEqual(
    validateEnvironment({
      ...validEnvironment,
      NODE_ENV: 'test',
      PORT: '4100',
      JWT_ACCESS_TTL_SECONDS: '1200',
      JWT_REFRESH_TTL_SECONDS: '3600',
    }),
    {
      NODE_ENV: 'test',
      PORT: 4100,
      DATABASE_URL: databaseUrl,
      JWT_ACCESS_SECRET: jwtAccessSecret,
      JWT_REFRESH_SECRET: jwtRefreshSecret,
      JWT_ACCESS_TTL_SECONDS: 1200,
      JWT_REFRESH_TTL_SECONDS: 3600,
    },
  );
});

test('environment validation rejects an invalid NODE_ENV without echoing it', () => {
  const invalidValue = 'invalid-environment';

  assert.throws(
    () =>
      validateEnvironment({
        ...validEnvironment,
        NODE_ENV: invalidValue,
      }),
    (error) => {
      assert.match(error.message, /NODE_ENV/);
      assert.doesNotMatch(error.message, new RegExp(invalidValue));
      return true;
    },
  );
});

test('environment validation rejects invalid ports', () => {
  for (const port of ['0', '65536', '1.5', 'not-a-port']) {
    assert.throws(
      () => validateEnvironment({ ...validEnvironment, PORT: port }),
      /Invalid environment configuration: PORT:/,
    );
  }
});

test('environment validation requires DATABASE_URL', () => {
  assert.throws(
    () =>
      validateEnvironment({
        JWT_ACCESS_SECRET: jwtAccessSecret,
        JWT_REFRESH_SECRET: jwtRefreshSecret,
      }),
    /Invalid environment configuration: DATABASE_URL:/,
  );
});

test('environment validation rejects non-PostgreSQL URLs without echoing them', () => {
  const invalidValue =
    'mysql://USER:do-not-log-this@localhost:3306/DATABASE';

  assert.throws(
    () =>
      validateEnvironment({
        ...validEnvironment,
        DATABASE_URL: invalidValue,
      }),
    (error) => {
      assert.match(error.message, /DATABASE_URL/);
      assert.equal(error.message.includes(invalidValue), false);
      assert.equal(error.message.includes('do-not-log-this'), false);
      return true;
    },
  );
});

test('environment validation rejects missing or unsafe JWT secrets', () => {
  for (const key of ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET']) {
    const environment = { ...validEnvironment };
    delete environment[key];

    assert.throws(
      () => validateEnvironment(environment),
      new RegExp(`Invalid environment configuration: ${key}:`),
    );
  }

  for (const [key, value] of [
    ['JWT_ACCESS_SECRET', 'too-short-access-secret'],
    ['JWT_REFRESH_SECRET', 'too-short-refresh-secret'],
    ['JWT_REFRESH_SECRET', jwtAccessSecret],
  ]) {
    assert.throws(
      () => validateEnvironment({ ...validEnvironment, [key]: value }),
      (error) => {
        assert.match(error.message, new RegExp(key));
        assert.equal(error.message.includes(value), false);
        return true;
      },
    );
  }
});

test('environment validation rejects invalid JWT TTL values', () => {
  for (const key of [
    'JWT_ACCESS_TTL_SECONDS',
    'JWT_REFRESH_TTL_SECONDS',
  ]) {
    for (const value of ['0', '-1', '1.5', 'not-a-number']) {
      assert.throws(
        () => validateEnvironment({ ...validEnvironment, [key]: value }),
        new RegExp(`Invalid environment configuration: ${key}:`),
      );
    }
  }
});
