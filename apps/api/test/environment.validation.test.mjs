import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateEnvironment } from '../dist/config/environment.validation.js';

test('environment validation applies safe defaults', () => {
  assert.deepEqual(validateEnvironment({}), {
    NODE_ENV: 'development',
    PORT: 3000,
  });
});

test('environment validation accepts and coerces valid values', () => {
  assert.deepEqual(
    validateEnvironment({ NODE_ENV: 'test', PORT: '4100' }),
    {
      NODE_ENV: 'test',
      PORT: 4100,
    },
  );
});

test('environment validation rejects an invalid NODE_ENV without echoing it', () => {
  const invalidValue = 'invalid-environment';

  assert.throws(
    () => validateEnvironment({ NODE_ENV: invalidValue }),
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
      () => validateEnvironment({ PORT: port }),
      /Invalid environment configuration: PORT:/,
    );
  }
});
