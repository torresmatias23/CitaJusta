import assert from 'node:assert/strict';
import test from 'node:test';
import { developmentProxy } from '../config/development-proxy.ts';

test('dev exige proxy con instrucción accionable y no revela valores inválidos', () => {
  assert.throws(() => developmentProxy('serve', false, undefined), /Copia apps\/web\/\.env.example/);
  for (const target of ['not-a-url', 'ftp://localhost', 'http://user:secret@localhost', 'http://localhost/path', 'http://localhost?token=secret', 'http://localhost#secret']) {
    assert.throws(() => developmentProxy('serve', false, target), (error) => !error.message.includes('secret') && /API_PROXY_TARGET/.test(error.message));
  }
});
test('dev configura únicamente el prefijo real de API', () => {
  assert.deepEqual(developmentProxy('serve', false, 'http://localhost:3000'), { proxy: { '/api/v1': { target: 'http://localhost:3000', changeOrigin: true } } });
});
test('build y preview no requieren ni utilizan el proxy dev', () => {
  for (const target of [undefined, 'invalid']) {
    assert.deepEqual(developmentProxy('build', false, target), {});
    assert.deepEqual(developmentProxy('serve', true, target), {});
  }
});
