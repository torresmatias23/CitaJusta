import assert from 'node:assert/strict';
import { test } from 'node:test';
import { coordinates, parseBranchLocation, directionsUrl, osmEmbedUrl } from '../src/features/locations/branch-location.ts';
import { createCatalogApi } from '../src/features/availability/catalog-api.ts';
import { parseAppointment } from '../src/features/appointments/appointments-api.ts';

const empty = parseBranchLocation({});
const location = { ...empty, addressLine1: 'Av. Libertador 123', municipality: 'Santiago', country: 'Chile', latitude: -33.45, longitude: -70.66 };
test('finite coordinates including zero and geographic bounds; incomplete/invalid pairs never create map', () => {
  for (const [latitude, longitude] of [[0, 0], [-90, -180], [90, 180], [-33.45, -70.66]]) {
    assert.deepEqual(coordinates({ ...empty, latitude, longitude }), { latitude, longitude });
  }
  for (const [latitude, longitude] of [[null, 1], [1, null], [NaN, 1], [1, Infinity], [91, 0], [0, -181], ['', 1], ['-33', 1]]) {
    assert.equal(coordinates({ ...empty, latitude, longitude }), null); assert.equal(osmEmbedUrl({ ...empty, latitude, longitude }), null);
  }
});
test('OSM URL has fixed HTTPS origin, correct bounding box/marker and no PII', () => {
  const url = new URL(osmEmbedUrl(location));
  assert.equal(url.origin, 'https://www.openstreetmap.org'); assert.equal(url.pathname, '/export/embed.html');
  assert.equal(url.searchParams.get('marker'), '-33.45,-70.66'); assert.equal(url.searchParams.get('layer'), 'mapnik');
  const [west, south, east, north] = url.searchParams.get('bbox').split(',').map(Number);
  assert.ok(west < location.longitude && east > location.longitude && south < location.latitude && north > location.latitude);
  assert.equal(url.searchParams.has('origin'), false); assert.ok(!url.href.includes('Libertador'));
});
test('Google directions prioritize coordinates even without address; never set origin', () => {
  const url = new URL(directionsUrl({ ...empty, latitude: 0, longitude: 0 }));
  assert.equal(url.origin, 'https://www.google.com'); assert.equal(url.pathname, '/maps/dir/');
  assert.equal(url.searchParams.get('api'), '1'); assert.equal(url.searchParams.get('destination'), '0,0');
  assert.deepEqual([...url.searchParams.keys()], ['api', 'destination']);
});
test('address fallback requires street/number, municipality and country; safely encodes text', () => {
  const address = { ...location, latitude: null, longitude: null, addressLine1: 'Av. José 123 & destination=https://evil.test', addressLine2: 'Piso 2' };
  const url = new URL(directionsUrl(address));
  assert.equal(url.origin, 'https://www.google.com'); assert.equal(url.searchParams.getAll('destination').length, 1);
  assert.match(url.searchParams.get('destination'), /José 123 & destination=https:\/\/evil.test, Piso 2, Santiago, Chile/);
  for (const missing of [empty, { ...empty, country: 'Chile' }, { ...address, municipality: null },
    { ...address, addressLine1: 'Centro' }, { ...address, addressLine1: '123' }, { ...address, country: null }]) assert.equal(directionsUrl(missing), null);
  assert.equal(osmEmbedUrl(address), null);
  assert.ok(directionsUrl({ ...location, latitude: 91 })); // Invalid coordinates can still use a specific real address.
  assert.equal(directionsUrl({ ...address, addressLine1: 'Calle 123 ' + 'x'.repeat(2100) }), null);
});
test('transport preserves geo fields, ignores private fields and handles missing or malformed coordinates', async () => {
  assert.deepEqual(parseBranchLocation({ latitude: '12', longitude: Infinity }), empty);
  assert.throws(() => parseBranchLocation({ addressLine1: {} }), /ubicación inválida/);
  const id = '10000000-0000-4000-8000-000000000001';
  const branch = { id, name: 'Centro', institutionId: id, ...location, passwordHash: 'private' };
  const result = await createCatalogApi({ request: async () => ({ data: [branch] }) }).branches(id);
  assert.deepEqual(result, [{ id, name: 'Centro', institutionId: id, ...location }]);
  const appointment = parseAppointment({ id, institutionId: id, status: 'AGENDADA', startsAt: '2030-01-01T00:00:00Z',
    endsAt: '2030-01-01T00:30:00Z', origin: 'WEB', branch, service: { id, name: 'Atención' }, professional: { id, firstNames: 'Ana', lastNames: 'Pérez' } });
  assert.deepEqual(appointment.branch, { id, name: 'Centro', ...location });
});
