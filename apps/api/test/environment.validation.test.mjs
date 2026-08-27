import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateEnvironment } from '../dist/config/environment.validation.js';

const databaseUrl = 'postgresql://USER:PASSWORD@localhost:5432/DATABASE';

test('environment validation applies safe defaults', () => {
  assert.deepEqual(validateEnvironment({ DATABASE_URL: databaseUrl }), {
    NODE_ENV: 'development',
    PORT: 3000,
    DATABASE_URL: databaseUrl,
  });
});

test('environment validation accepts and coerces valid values', () => {
  assert.deepEqual(
    validateEnvironment({
      NODE_ENV: 'test',
      PORT: '4100',
      DATABASE_URL: databaseUrl,
    }),
    {
      NODE_ENV: 'test',
      PORT: 4100,
      DATABASE_URL: databaseUrl,
    },
  );
});

test('environment validation rejects an invalid NODE_ENV without echoing it', () => {
  const invalidValue = 'invalid-environment';

  assert.throws(
    () =>
      validateEnvironment({
        NODE_ENV: invalidValue,
        DATABASE_URL: databaseUrl,
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
      () => validateEnvironment({ PORT: port, DATABASE_URL: databaseUrl }),
      /Invalid environment configuration: PORT:/,
    );
  }
});

test('environment validation requires DATABASE_URL', () => {
  assert.throws(
    () => validateEnvironment({}),
    /Invalid environment configuration: DATABASE_URL:/,
  );
});

test('environment validation rejects non-PostgreSQL URLs without echoing them', () => {
  const invalidValue =
    'mysql://USER:do-not-log-this@localhost:3306/DATABASE';

  assert.throws(
    () => validateEnvironment({ DATABASE_URL: invalidValue }),
    (error) => {
      assert.match(error.message, /DATABASE_URL/);
      assert.equal(error.message.includes(invalidValue), false);
      assert.equal(error.message.includes('do-not-log-this'), false);
      return true;
    },
  );
});
