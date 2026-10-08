import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { Prisma } from '../dist/generated/prisma/client.js';
import { InstitutionsService } from '../dist/institutions/institutions.service.js';
import { AppointmentsService } from '../dist/appointments/appointments.service.js';
import { branchLocation } from '../dist/institutions/branch-location.js';

const geo = { addressLine1: 'Calle 123', addressLine2: null, municipality: 'Santiago', region: 'Metropolitana', country: 'Chile',
  latitude: new Prisma.Decimal('-33.4500000'), longitude: new Prisma.Decimal('-70.6600000') };
test('Decimal(10,7) serialized as controlled numbers and missing values as null', () => {
  assert.deepEqual(branchLocation(geo), { ...geo, latitude: -33.45, longitude: -70.66 });
  assert.deepEqual(branchLocation({ ...geo, latitude: null, longitude: null }), { ...geo, latitude: null, longitude: null });
});
test('catalog returns geo fields without weakening active institution/branch tenant filters', async () => {
  const institutionId = randomUUID(); let query;
  const branch = { id: randomUUID(), institutionId, name: 'Centro', code: 'CENTRO', status: 'ACTIVE', deletedAt: null, ...geo, phone: null, email: null };
  const result = await new InstitutionsService({ institution: { findFirst: async (args) => { query = args; return { status: 'ACTIVE', deletedAt: null,
    branches: [branch, { ...branch, institutionId: randomUUID() }, { ...branch, status: 'INACTIVE' }, { ...branch, deletedAt: new Date() }] }; } } }).findBranches(institutionId);
  assert.equal(result.data.length, 1); assert.equal(result.data[0].latitude, -33.45); assert.equal(result.data[0].longitude, -70.66);
  assert.deepEqual(query.where, { id: institutionId, status: 'ACTIVE', deletedAt: null });
  assert.deepEqual(query.select.branches.where, { status: 'ACTIVE', deletedAt: null });
});
test('own historical appointments include controlled geography, retain owner filter and hide inconsistent tenants', async () => {
  const institutionId = randomUUID(), userId = randomUUID(); let query;
  const row = { id: randomUUID(), institutionId, startsAt: new Date(0), endsAt: new Date(60000), origin: 'WEB', status: { code: 'CANCELADA' },
    branch: { id: randomUUID(), institutionId, name: 'Centro', ...geo }, service: { id: randomUUID(), institutionId, name: 'Atención' },
    professional: { id: randomUUID(), institutionId, user: { firstNames: 'Ana', lastNames: 'Pérez', passwordHash: 'private' } } };
  const result = await new AppointmentsService({ appointment: { findMany: async (args) => { query = args; return [row, { ...row, branch: { ...row.branch, institutionId: randomUUID() } }]; } } }).findMine({ userId });
  assert.deepEqual(query.where, { userId, deletedAt: null }); assert.equal(result.data.length, 1); assert.equal(result.data[0].branch.latitude, -33.45);
  assert.doesNotMatch(JSON.stringify(result), /passwordHash|private/);
});
