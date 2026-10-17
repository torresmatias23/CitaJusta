import 'reflect-metadata';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { MODULE_METADATA } from '@nestjs/common/constants.js';
import { AvailabilityModule } from '../dist/availability/availability.module.js';
import { NagerDateHolidaysAdapter } from '../dist/availability/nager-date-holidays.adapter.js';

const holiday = (overrides = {}) => ({ date: '2026-01-01', name: "New Year's Day", countryCode: 'CL',
  nationalHoliday: true, subdivisionCodes: null, holidayTypes: ['Public'], ...overrides });
const adapter = () => new NagerDateHolidaysAdapter();
const failsWith = (status, message) => (error) => {
  assert.equal(error.getStatus(), status);
  assert.equal(error.message, message);
  assert.ok(!JSON.stringify(error.getResponse()).includes('private-provider-data'));
  return true;
};
const invalid = failsWith(502, 'Invalid holiday provider response');
const unavailable = failsWith(503, 'Holiday provider unavailable');

test('Nager adapter is available through existing AvailabilityModule without a new controller', () => {
  assert.ok(Reflect.getMetadata(MODULE_METADATA.PROVIDERS, AvailabilityModule).includes(NagerDateHolidaysAdapter));
  assert.deepEqual(Reflect.getMetadata(MODULE_METADATA.EXPORTS, AvailabilityModule), [NagerDateHolidaysAdapter]);
  assert.equal(Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, AvailabilityModule).length, 2);
});

test('query uses fixed public v4 CL/year URL, no credentials, redirects or tenant/actor input', async (t) => {
  const fetch = t.mock.method(globalThis, 'fetch', async () => Response.json([holiday({ private: 'private-provider-data', localName: 'not-v4' })]));
  const rows = await adapter().findByYear(2026);
  assert.deepEqual(rows, [holiday()]);
  const [url, options] = fetch.mock.calls[0].arguments;
  assert.equal(url, 'https://nagerholidays.com/api/v4/Holidays/CL/2026');
  assert.deepEqual(Object.keys(options).sort(), ['headers', 'method', 'redirect', 'signal']);
  assert.equal(options.method, 'GET'); assert.equal(options.redirect, 'error');
  assert.deepEqual(options.headers, { accept: 'application/json' });
  assert.ok(options.signal instanceof AbortSignal);
});

for (const year of [undefined, null, '', '2026', true, NaN, Infinity, 1899, 2101, 2026.5, 'https://private-provider-data.test', { institutionId: 'private-provider-data' }]) {
  test(`invalid year rejected before HTTP: ${JSON.stringify(year)}`, async (t) => {
    const fetch = t.mock.method(globalThis, 'fetch', () => assert.fail('Must not perform HTTP'));
    await assert.rejects(adapter().findByYear(year), failsWith(400, 'Holiday year must be an integer between 1900 and 2100'));
    assert.equal(fetch.mock.callCount(), 0);
  });
}
for (const year of [1900, 2100]) test(`technical year boundary ${year} accepted`, async (t) => {
  t.mock.method(globalThis, 'fetch', async () => Response.json([holiday({ date: `${year}-01-01` })]));
  assert.equal((await adapter().findByYear(year))[0].date, `${year}-01-01`);
});

test('national, regional and observance classifications remain informational, with no closing policy', async (t) => {
  const rows = [holiday(), holiday({ date: '2026-02-01', name: 'Regional event', nationalHoliday: false,
    subdivisionCodes: ['CL-NB', 'CL-AP'], holidayTypes: ['Observance', 'Optional', 'School', 'Authorities', 'Bank'] })];
  t.mock.method(globalThis, 'fetch', async () => Response.json(rows));
  const result = await adapter().findByYear(2026);
  assert.equal(result[0].nationalHoliday, true); assert.equal(result[0].subdivisionCodes, null);
  assert.equal(result[1].nationalHoliday, false);
  assert.deepEqual(result[1].subdivisionCodes, ['CL-AP', 'CL-NB']);
  assert.deepEqual(result[1].holidayTypes, ['Authorities', 'Bank', 'Observance', 'Optional', 'School']);
  assert.ok(result.every((row) => !('blocksEntireDay' in row) && !('institutionId' in row) && !('branchId' in row)));
});

test('stable query results deduplicate exact records, normalize arrays and keep distinct same-date events', async (t) => {
  const regional = holiday({ name: 'Regional event', nationalHoliday: false, subdivisionCodes: ['CL-NB', 'CL-AP'], holidayTypes: ['Public', 'Bank'] });
  const rows = [holiday({ date: '2026-12-25' }), regional, holiday(), { ...regional, subdivisionCodes: ['CL-AP', 'CL-NB', 'CL-AP'], holidayTypes: ['Bank', 'Public', 'Bank'] }, holiday()];
  const original = structuredClone(rows);
  const fetch = t.mock.method(globalThis, 'fetch', async () => Response.json(rows));
  const service = adapter();
  const first = await service.findByYear(2026), second = await service.findByYear(2026);
  assert.deepEqual(first, second); assert.equal(fetch.mock.callCount(), 2);
  assert.equal(first.length, 3);
  assert.deepEqual(first.map((row) => row.date), ['2026-01-01', '2026-01-01', '2026-12-25']);
  assert.deepEqual(first.slice(0, 2).map((row) => row.name), ["New Year's Day", 'Regional event']);
  assert.deepEqual(rows, original);
});

test('accepts real leap date as civil date without timezone conversion', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => Response.json([holiday({ date: '2000-02-29' })]));
  assert.equal((await adapter().findByYear(2000))[0].date, '2000-02-29');
});
for (const date of ['2026-02-29', '2026-02-30', '2026-04-31', '2026-13-01', '2026-00-01', '2026-01-00', '2025-01-01', '2026-01-01T00:00:00Z', '2026-1-1']) {
  test(`rejects invalid or wrong-year date ${date}`, async (t) => {
    t.mock.method(globalThis, 'fetch', async () => Response.json([holiday({ date })]));
    await assert.rejects(adapter().findByYear(2026), invalid);
  });
}
test('1900 is not a leap year', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => Response.json([holiday({ date: '1900-02-29' })]));
  await assert.rejects(adapter().findByYear(1900), invalid);
});

for (const field of ['date', 'name', 'countryCode', 'nationalHoliday', 'subdivisionCodes', 'holidayTypes']) {
  test(`rejects incomplete response missing ${field}, even after valid rows`, async (t) => {
    const incomplete = holiday(); delete incomplete[field];
    t.mock.method(globalThis, 'fetch', async () => Response.json([holiday(), incomplete]));
    await assert.rejects(adapter().findByYear(2026), invalid);
  });
}
for (const [label, data] of [
  ['wrong country', holiday({ countryCode: 'AT' })], ['blank name', holiday({ name: '  ' })],
  ['oversized name', holiday({ name: 'a'.repeat(181) })], ['untyped national flag', holiday({ nationalHoliday: 'true' })],
  ['unknown type', holiday({ holidayTypes: ['Closure'] })], ['empty types', holiday({ holidayTypes: [] })],
  ['regional without subdivisions', holiday({ nationalHoliday: false })],
  ['regional empty subdivisions', holiday({ nationalHoliday: false, subdivisionCodes: [] })],
  ['national with subdivisions', holiday({ subdivisionCodes: ['CL-AP'] })],
  ['wrong subdivision country', holiday({ nationalHoliday: false, subdivisionCodes: ['AR-B'] })],
  ['invalid subdivision', holiday({ nationalHoliday: false, subdivisionCodes: ['CL/../../../'] })],
]) test(`rejects ${label}`, async (t) => {
  t.mock.method(globalThis, 'fetch', async () => Response.json([data]));
  await assert.rejects(adapter().findByYear(2026), invalid);
});

for (const [label, body] of [['empty', []], ['null', null], ['envelope', { data: [holiday()] }], ['oversized count', Array.from({ length: 501 }, () => holiday())]]) {
  test(`rejects ${label} collection without partial results`, async (t) => {
    t.mock.method(globalThis, 'fetch', async () => Response.json(body));
    await assert.rejects(adapter().findByYear(2026), invalid);
  });
}
test('national empty subdivision array accepted without inventing a region', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => Response.json([holiday({ subdivisionCodes: [] })]));
  assert.deepEqual((await adapter().findByYear(2026))[0].subdivisionCodes, []);
});

for (const status of [301, 400, 401, 403, 404, 422, 408, 429, 500, 502, 503]) {
  test(`HTTP ${status} is sanitized and never retried`, async (t) => {
    let cancelled = false;
    const fetch = t.mock.method(globalThis, 'fetch', async () => new Response(new ReadableStream({
      start(controller) { controller.enqueue(new TextEncoder().encode('private-provider-data')); },
      cancel() { cancelled = true; },
    }), { status }));
    await assert.rejects(adapter().findByYear(2026), [408, 429].includes(status) || status >= 500
      ? unavailable : failsWith(502, 'Holiday provider rejected the query'));
    assert.equal(fetch.mock.callCount(), 1); assert.equal(cancelled, true);
  });
}
test('network failure never exposes provider error details', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => { throw new TypeError('private-provider-data'); });
  await assert.rejects(adapter().findByYear(2026), unavailable);
});
for (const [label, response] of [
  ['HTML', () => new Response('private-provider-data', { headers: { 'content-type': 'text/html' } })],
  ['invalid JSON', () => new Response('private-provider-data', { headers: { 'content-type': 'application/json' } })],
  ['truncated JSON', () => new Response('[{"date":', { headers: { 'content-type': 'application/json' } })],
  ['no body', () => new Response(null, { status: 204 })],
  ['invalid UTF-8', () => new Response(new Uint8Array([0xff]), { headers: { 'content-type': 'application/json' } })],
]) test(`rejects ${label} response`, async (t) => {
  t.mock.method(globalThis, 'fetch', async () => response());
  await assert.rejects(adapter().findByYear(2026), invalid);
});
test('bounds streamed body size and cancels the remaining response', async (t) => {
  let cancelled = false;
  t.mock.method(globalThis, 'fetch', async () => new Response(new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array(256 * 1024 + 1)); },
    cancel() { cancelled = true; },
  }), { headers: { 'content-type': 'application/json' } }));
  await assert.rejects(adapter().findByYear(2026), invalid);
  assert.equal(cancelled, true);
});
test('decodes UTF-8 correctly even across single-byte stream chunks', async (t) => {
  const data = [holiday({ name: 'Día de ejemplo' })];
  t.mock.method(globalThis, 'fetch', async () => new Response(new ReadableStream({ start(controller) {
    for (const byte of new TextEncoder().encode(JSON.stringify(data))) controller.enqueue(new Uint8Array([byte]));
    controller.close();
  } }), { headers: { 'content-type': 'application/json; charset=utf-8' } }));
  assert.deepEqual(await adapter().findByYear(2026), data);
});
test('body network failure is controlled rather than partial success', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response(new ReadableStream({ start(controller) {
    controller.error(new TypeError('private-provider-data'));
  } }), { headers: { 'content-type': 'application/json' } }));
  await assert.rejects(adapter().findByYear(2026), unavailable);
});
for (const phase of ['headers', 'body']) test(`five-second timeout covers ${phase}`, async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let signal;
  t.mock.method(globalThis, 'fetch', (_url, options) => {
    signal = options.signal;
    if (phase === 'headers') return new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new DOMException('private-provider-data', 'AbortError')), { once: true });
    });
    return Promise.resolve(new Response(new ReadableStream({ start(controller) {
      signal.addEventListener('abort', () => controller.error(new DOMException('private-provider-data', 'AbortError')), { once: true });
    } }), { headers: { 'content-type': 'application/json' } }));
  });
  const rejected = assert.rejects(adapter().findByYear(2026), unavailable);
  await Promise.resolve();
  t.mock.timers.tick(4999); assert.equal(signal.aborted, false);
  t.mock.timers.tick(1); await rejected;
  assert.equal(signal.aborted, true);
});
test('successful request clears its timeout and queries remain independent', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const signals = [];
  t.mock.method(globalThis, 'fetch', async (_url, { signal }) => {
    signals.push(signal);
    return Response.json([holiday({ name: `Query ${signals.length}` })]);
  });
  const service = adapter();
  assert.equal((await service.findByYear(2026))[0].name, 'Query 1');
  assert.equal((await service.findByYear(2026))[0].name, 'Query 2');
  t.mock.timers.tick(5000);
  assert.ok(signals.every((signal) => !signal.aborted));
});
for (const args of [[], ['2026', 'extra'], ['2026/../../secret'], ['1899'], ['2101']]) {
  test(`read-only CLI rejects invalid arguments ${JSON.stringify(args)} without loading database configuration`, () => {
    const result = spawnSync(process.execPath, [fileURLToPath(new URL('../scripts/query-chile-holidays.mjs', import.meta.url)), ...args], { encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /Uso:|Holiday year must be/);
    assert.doesNotMatch(result.stderr, /DATABASE_URL|password|stack|\bat file:/);
  });
}
