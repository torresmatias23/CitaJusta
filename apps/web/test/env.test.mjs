import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readApiBaseUrl } from '../src/lib/env.ts';

test('API usa /api/v1 por defecto y normaliza la barra final', () => {
  assert.equal(readApiBaseUrl(undefined), '/api/v1');
  assert.equal(readApiBaseUrl('/api/v1/'), '/api/v1');
  assert.equal(readApiBaseUrl('https://api.example.test/api/v1/'), 'https://api.example.test/api/v1');
});

test('rechaza configuración inválida, credenciales y prefijos no versionados sin revelarlos', () => {
  for (const value of ['', 3, ' /api/v1', '//evil.test/api/v1', '/auth', 'javascript:alert(1)', 'https://user:example-secret@api.test/api/v1', 'https://api.test/api/v1?token=example-secret', 'https://api.test/api/v1#secret']) {
    assert.throws(() => readApiBaseUrl(value), (error) => {
      assert.match(error.message, /VITE_API_BASE_URL/);
      assert.doesNotMatch(error.message, /example-secret|evil\.test/);
      return true;
    });
  }
});
