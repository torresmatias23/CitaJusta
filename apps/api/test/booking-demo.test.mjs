import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareBookingDemo } from '../dist/database/booking-demo.js';
import { demo } from '../dist/database/development.js';

const options = { connectionString: 'postgresql://USER:PASSWORD@localhost/citajusta_dev', nodeEnv: 'development' };
function setup() {
  const state = { users: [], roles: [], permissions: [], grants: [], links: [], professional: null,
    availabilities: [], slots: [], audits: [], calls: [], block: false, holiday: false, extraGrant: false };
  const technical = (key) => ({
    findMany: async ({ where }) => state[key].filter((row) => where.OR.some((clause) => Object.entries(clause).every(([k, v]) => row[k] === v))),
    create: async ({ data }) => { state[key].push(structuredClone(data)); return data; },
  });
  const prisma = {
    $transaction: async (fn) => {
      const snapshot = structuredClone(state);
      try { return await fn(prisma); }
      catch (error) { Object.assign(state, snapshot); throw error; }
    },
    $queryRaw: async (parts) => parts.join('').includes('current_database') ? [{ database: 'citajusta_dev' }] : [{ acquired: true }],
    institution: { findUnique: async () => ({ ...demo.institution, timeZone: 'America/Santiago' }) },
    branch: { findUnique: async () => ({ ...demo.branch }) },
    service: { findUnique: async () => ({ ...demo.service }) },
    serviceBranch: { findUnique: async () => ({ active: true }) },
    appointmentStatus: { findUnique: async () => ({ code: 'AGENDADA', active: true, isFinal: false }) },
    user: technical('users'), role: technical('roles'),
    permission: { findUnique: async ({ where }) => state.permissions.find((row) => row.code === where.code),
      create: async ({ data }) => { state.permissions.push(data); return data; } },
    rolePermission: { count: async () => 0, upsert: async ({ create, update }) => {
      assert.deepEqual(update, {});
      if (!state.links.some((row) => row.permissionId === create.permissionId)) state.links.push(create);
    } },
    userRole: { ...technical('grants'), count: async () => Number(state.extraGrant) },
    professional: { findUnique: async () => state.professional, findUniqueOrThrow: async () => state.professional },
    professionalService: { findMany: async () => [{ serviceId: demo.service.id, active: true, customDurationMinutes: null }] },
    professionalBranch: { findMany: async () => [{ branchId: demo.branch.id, active: true }] },
    auditEvent: { count: async ({ where }) => state.audits.filter((row) => Object.entries(where).every(([key, value]) => row[key] === value)).length },
    availability: { count: async ({ where }) => state.availabilities.filter((row) => +row.date === +where.date).length },
    agendaSlot: {
      findMany: async ({ where, orderBy }) => {
        assert.equal(where.status, 'AVAILABLE'); assert.equal(where.blockedUntilAt, null);
        assert.deepEqual(where.appointment, { is: null }); assert.deepEqual(where.reassignments, { none: {} });
        assert.equal(where.availability.professionalId, state.professional.id);
        assert.equal(where.availability.branchId, demo.branch.id); assert.equal(where.availability.serviceId, demo.service.id);
        assert.deepEqual(orderBy, [{ startsAt: 'asc' }, { id: 'asc' }]);
        return state.slots.filter((slot) => slot.status === 'AVAILABLE' && slot.startsAt > where.startsAt.gt && !slot.blockedUntilAt && !slot.appointment && !slot.reassignment);
      },
      count: async ({ where }) => state.slots.filter((slot) => slot.startsAt < where.startsAt.lt && slot.endsAt > where.endsAt.gt).length,
    },
    holiday: { count: async () => Number(state.holiday) },
    scheduleBlock: { count: async () => Number(state.block) },
  };
  const audit = (actionCode, resourceId, context) => state.audits.push({ actionCode, resourceId, actorUserId: context.userId, institutionId: context.institutionId });
  const domain = {
    professionals: { create: async (input, context) => {
      state.calls.push('professional');
      assert.deepEqual(input.branchIds, [demo.branch.id]); assert.deepEqual(input.serviceIds, [demo.service.id]);
      assert.deepEqual(context.permissions, ['professionals.create', 'availability.create']);
      const { branchIds, serviceIds, ...fields } = input;
      state.professional = { ...fields, id: 'professional', institutionId: context.institutionId, status: 'ACTIVE', deletedAt: null };
      audit('PROFESSIONAL_CREATED', 'professional', context);
      return { data: { id: 'professional' } };
    } },
    availability: { create: async (input, context) => {
      state.calls.push('availability');
      const id = `availability-${state.availabilities.length}`;
      const start = new Date(input.startsAt), end = new Date(input.endsAt);
      assert.ok(start > new Date()); assert.equal(+end - +start, 120 * 60_000);
      // Simulate the domain result, not a tooling-side materialization API.
      state.availabilities.push({ id, date: new Date(start.toISOString().slice(0, 10)) });
      for (let n = 0; n < 4; n++) state.slots.push({ id: `${id}-${n}`, availabilityId: id,
        startsAt: new Date(+start + n * 30 * 60_000), endsAt: new Date(+start + (n + 1) * 30 * 60_000), status: 'AVAILABLE' });
      audit('AVAILABILITY_CREATED', id, context);
      return { data: { id } };
    } },
  };
  return { prisma, domain, state, run: () => prepareBookingDemo(prisma, domain, options) };
}

test('unsafe destinations fail before any DB/domain operation without exposing secrets', async () => {
  for (const patch of [{ nodeEnv: 'production' }, { nodeEnv: 'test' }, { connectionString: undefined },
    { connectionString: options.connectionString.replace('localhost', 'remote') },
    { connectionString: options.connectionString.replace('citajusta_dev', 'citajusta_shadow') },
    { connectionString: `${options.connectionString}?host=remote` }]) {
    await assert.rejects(prepareBookingDemo({}, {}, { ...options, ...patch }), (error) => !error.message.includes('PASSWORD'));
  }
});

test('real DB identity and advisory lock are checked before catalog access', async () => {
  for (const [database, acquired] of [['wrong', true], ['citajusta_dev', false]]) {
    const prisma = { $transaction: (fn) => fn({ $queryRaw: async (parts) => parts.join('').includes('current_database') ? [{ database }] : [{ acquired }] }) };
    await assert.rejects(prepareBookingDemo(prisma, {}, options));
  }
});

test('requires existing compatible demo catalog before creating technical infrastructure', async () => {
  for (const key of ['institution', 'branch', 'service', 'serviceBranch', 'appointmentStatus']) {
    const fixture = setup(); fixture.prisma[key].findUnique = async () => null;
    await assert.rejects(fixture.run(), /seed:dev/);
    assert.equal(fixture.state.users.length, 0); assert.equal(fixture.state.calls.length, 0);
  }
});

test('two runs delegate materialization once and reuse four slots; only technical users/minimal RBAC written directly', async () => {
  const fixture = setup();
  const first = await fixture.run(); const before = structuredClone(fixture.state);
  const second = await fixture.run();
  assert.equal(first.reused, false); assert.equal(second.reused, true);
  assert.deepEqual(first.slots, second.slots); assert.deepEqual(fixture.state, before);
  assert.equal(second.slots.length, 4); assert.equal(second.professional, 'Profesional Demo Booking');
  assert.deepEqual(fixture.state.calls, ['professional', 'availability']);
  assert.equal(fixture.state.users.length, 2); assert.equal(fixture.state.grants.length, 1);
  assert.ok(fixture.state.users.every((user) => user.passwordHash.startsWith('!') && user.email.endsWith('@example.invalid')));
});

test('one remaining slot is reused without replacing consumed slots', async () => {
  const fixture = setup(); await fixture.run();
  fixture.state.slots.slice(0, 3).forEach((slot) => { slot.status = 'RESERVED'; });
  const before = structuredClone(fixture.state);
  assert.equal((await fixture.run()).slots.length, 1); assert.deepEqual(fixture.state, before);
});

test('consumed, blocked, expired, historical or linked slots are never revived', async () => {
  for (const mutation of [
    (slot) => { slot.status = 'RESERVED'; }, (slot) => { slot.status = 'BLOCKED'; },
    (slot) => { slot.status = 'EXPIRED'; }, (slot) => { slot.status = 'RELEASED'; },
    (slot) => { slot.startsAt = new Date(0); slot.endsAt = new Date(60_000); },
    (slot) => { slot.blockedUntilAt = new Date(Date.now() + 60_000); },
    (slot) => { slot.appointment = {}; }, (slot) => { slot.reassignment = {}; },
  ]) {
    const fixture = setup(); await fixture.run(); fixture.state.slots.forEach(mutation);
    const previous = structuredClone(fixture.state.slots);
    const result = await fixture.run();
    assert.equal(result.reused, false); assert.equal(result.slots.length, 4);
    assert.deepEqual(fixture.state.slots.slice(0, 4), previous);
    assert.equal(fixture.state.availabilities.length, 2);
  }
});

test('foreign identity/configuration and unowned resources stop without overwriting', async () => {
  for (const mutate of [
    (s) => { s.users[0].passwordHash = 'foreign'; }, (s) => { s.professional.description = 'foreign'; },
    (s) => { s.extraGrant = true; }, (s) => { s.audits = []; },
  ]) {
    const fixture = setup(); await fixture.run(); mutate(fixture.state);
    const before = structuredClone(fixture.state);
    await assert.rejects(fixture.run()); assert.deepEqual(fixture.state, before);
  }
});

test('blocked dates/holidays are skipped without creating availability or changing blocks', async () => {
  for (const flag of ['holiday', 'block']) {
    const fixture = setup(); fixture.state[flag] = true;
    await assert.rejects(fixture.run(), /No hay cupos/);
    assert.equal(fixture.state.availabilities.length, 0);
  }
});
