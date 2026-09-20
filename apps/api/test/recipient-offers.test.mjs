import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { RecipientOffersService } from '../dist/reassignments/recipient-offers.service.js';
import { ReassignmentsController } from '../dist/reassignments/reassignments.controller.js';
import { AccessTokenGuard } from '../dist/auth/guards/access-token.guard.js';

const principal = { userId: randomUUID(), sessionId: randomUUID() };
function offer() {
  const institutionId = randomUUID(); const serviceId = randomUUID();
  return {
    id: randomUUID(), status: 'PENDING', createdAt: new Date('2026-01-01T00:00:00Z'),
    expiresAt: new Date('2026-01-01T00:07:00Z'), respondedAt: null,
    candidate: { waitlistEntry: { userId: principal.userId, institutionId, serviceId } },
    reassignment: { institutionId, serviceId, agendaSlot: {
      startsAt: new Date('2026-01-02T10:00:00Z'), endsAt: new Date('2026-01-02T10:30:00Z'),
      availability: {
        service: { id: serviceId, institutionId, name: 'Atención' },
        branch: { id: randomUUID(), institutionId, name: 'Centro' },
        professional: { id: randomUUID(), institutionId, user: { firstNames: 'Ana', lastNames: 'Pérez' } },
      },
    } },
  };
}

test('recipient list scopes by principal, caps and orders at DB; selects no contacts or ranking', async () => {
  const row = offer(); let query;
  const service = new RecipientOffersService({ appointmentOffer: { findMany: async (args) => { query = args; return [row]; } } });
  const result = await service.findMine(principal);
  assert.deepEqual(query.where, { candidate: { userId: principal.userId } });
  assert.deepEqual(query.orderBy, [{ createdAt: 'desc' }, { id: 'desc' }]); assert.equal(query.take, 100);
  assert.doesNotMatch(JSON.stringify(query.select), /email|phone|ranking|priority|snapshot|sourceUser/i);
  assert.deepEqual(Object.keys(result.data[0]).sort(), ['id', 'status', 'createdAt', 'expiresAt', 'respondedAt', 'startsAt', 'endsAt', 'service', 'branch', 'professional'].sort());
  assert.equal(result.data[0].expiresAt, row.expiresAt.toISOString());
  assert.equal(result.data[0].status, 'PENDING');
});

test('all persisted offer states are retained, even past expiry and inactive catalogs', async () => {
  for (const status of ['PENDING', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'INVALIDATED', 'CANCELLED']) {
    const row = offer(); row.status = status;
    row.reassignment.agendaSlot.availability.branch.active = false;
    const before = structuredClone(row);
    const service = new RecipientOffersService({ appointmentOffer: { findMany: async () => [row] } });
    assert.equal((await service.findMine(principal)).data[0].status, status);
    assert.deepEqual(row, before);
  }
});

test('incoherent tenant/service/recipient relations are not exposed', async () => {
  for (const mutate of [
    (r) => { r.reassignment.agendaSlot.availability.branch.institutionId = randomUUID(); },
    (r) => { r.reassignment.agendaSlot.availability.service.id = randomUUID(); },
    (r) => { r.reassignment.agendaSlot.availability.professional.institutionId = randomUUID(); },
    (r) => { r.candidate.waitlistEntry.userId = randomUUID(); },
    (r) => { r.candidate.waitlistEntry.institutionId = randomUUID(); },
  ]) {
    const row = offer(); mutate(row);
    const service = new RecipientOffersService({ appointmentOffer: { findMany: async () => [row] } });
    assert.deepEqual(await service.findMine(principal), { data: [] });
  }
});

test('unexpected persistence errors are sanitized', async () => {
  const service = new RecipientOffersService({ appointmentOffer: { findMany: async () => { throw new Error('private SQL'); } } });
  await assert.rejects(service.findMine(principal), (error) => error.getStatus() === 500 && !JSON.stringify(error.getResponse()).includes('private SQL'));
});

test('recipient controller rejects extras, requires principal, and only uses AccessTokenGuard', async () => {
  const controller = new ReassignmentsController(null, null, { findMine: async (actor) => { assert.equal(actor, principal); return { data: [] }; } });
  assert.throws(() => controller.findMine({}, undefined, {}), (e) => e.getStatus() === 401);
  for (const query of [{ userId: principal.userId }, { institutionId: randomUUID() }, { limit: 100 }]) {
    assert.throws(() => controller.findMine(query, undefined, { principal }), (e) => e.getStatus() === 400);
  }
  assert.throws(() => controller.findMine({}, { userId: principal.userId }, { principal }), (e) => e.getStatus() === 400);
  assert.deepEqual(Reflect.getMetadata('__guards__', ReassignmentsController.prototype.findMine), [AccessTokenGuard]);
  assert.deepEqual(await controller.findMine({}, undefined, { principal }), { data: [] });
});
