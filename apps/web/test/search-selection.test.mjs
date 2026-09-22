import assert from 'node:assert/strict';
import { test } from 'node:test';
import { changeSelection, initialSelection, localDateValue, searchParameters } from '../src/features/availability/search-selection.ts';

const selection = { ...initialSelection, institutionId: 'institution', branchId: 'branch', serviceId: 'service' };
const specific = (date) => ({ ...selection, mode: 'specific', date });
function inTimezone(timezone, run) {
  const previous = process.env.TZ;
  process.env.TZ = timezone;
  try { run(); } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
}

for (const days of ['7', '14', '30']) {
  test(`flexible conserva el intervalo actual de ${days} días`, () => {
    const now = new Date('2026-03-07T17:00:00Z');
    const params = searchParameters({ ...selection, days }, now);
    assert.equal(params.get('from'), now.toISOString());
    assert.equal(params.get('to'), new Date(now.getTime() + Number(days) * 86_400_000).toISOString());
    assert.deepEqual([...params.keys()], ['institutionId', 'branchId', 'serviceId', 'from', 'to']);
    for (const key of ['institutionId', 'branchId', 'serviceId']) assert.equal(params.get(key), selection[key]);
  });
}

test('fecha futura usa medianoche local y el comienzo del siguiente día', () => inTimezone('Asia/Tokyo', () => {
  const params = searchParameters(specific('2026-12-31'), new Date('2026-12-20T15:00:00Z'));
  assert.equal(params.get('from'), '2026-12-30T15:00:00.000Z');
  assert.equal(params.get('to'), '2026-12-31T15:00:00.000Z');
}));

test('hoy usa now aunque el día UTC sea diferente al local', () => inTimezone('America/New_York', () => {
  const now = new Date('2026-06-02T02:30:00Z');
  assert.equal(localDateValue(now), '2026-06-01');
  const params = searchParameters(specific('2026-06-01'), now);
  assert.equal(params.get('from'), now.toISOString());
  assert.equal(params.get('to'), '2026-06-02T04:00:00.000Z');
  assert.equal(searchParameters(specific('2026-06-02'), now).get('from'), '2026-06-02T04:00:00.000Z');
  assert.equal(now.toISOString(), '2026-06-02T02:30:00.000Z');
}));

for (const [date, from, to, hours] of [
  ['2026-03-08', '2026-03-08T05:00:00.000Z', '2026-03-09T04:00:00.000Z', 23],
  ['2026-11-01', '2026-11-01T04:00:00.000Z', '2026-11-02T05:00:00.000Z', 25],
]) {
  test(`fecha específica respeta el día local de ${hours} horas por DST`, () => inTimezone('America/New_York', () => {
    const params = searchParameters(specific(date), new Date('2026-01-01T12:00:00Z'));
    assert.equal(params.get('from'), from);
    assert.equal(params.get('to'), to);
    assert.equal((Date.parse(to) - Date.parse(from)) / 3_600_000, hours);
  }));
}

test('fechas vacías, inválidas o pasadas no permiten buscar', () => inTimezone('America/New_York', () => {
  const now = new Date('2026-06-02T02:30:00Z');
  for (const date of ['', '2026-05-31', '2026-02-30', '2027-02-29', '2026-13-01', '2026-06-00', '2026-6-2', '2026-06-02T00:00:00Z', 'texto']) {
    assert.equal(searchParameters(specific(date), now), null, date);
  }
  assert.equal(searchParameters(specific('2026-06-01'), new Date('2026-06-02T04:00:00Z')), null);
  assert.equal(searchParameters(specific('2026-06-02'), new Date(NaN)), null);
}));

test('cambiar de modo descarta la fecha anterior y conserva catálogos y rango flexible', () => {
  const flexible = { ...selection, days: '14' };
  let next = changeSelection(flexible, 'mode', 'specific');
  assert.equal(searchParameters(next), null);
  next = changeSelection(next, 'date', '2030-06-02');
  const params = searchParameters(next, new Date(2030, 5, 1, 12));
  assert.equal(params.get('to'), new Date(2030, 5, 3).toISOString());
  assert.deepEqual([...params.keys()], ['institutionId', 'branchId', 'serviceId', 'from', 'to']);
  assert.deepEqual(changeSelection(next, 'mode', 'flexible'), flexible);
  assert.equal(changeSelection(changeSelection(next, 'mode', 'flexible'), 'mode', 'specific').date, '');
});

test('cambiar catálogos mantiene la fecha y reinicia las selecciones dependientes', () => {
  const current = specific('2030-06-02');
  assert.deepEqual(changeSelection(current, 'institutionId', 'other'), { ...current, institutionId: 'other', branchId: '', serviceId: '' });
  assert.deepEqual(changeSelection(current, 'branchId', 'other'), { ...current, branchId: 'other', serviceId: '' });
});
