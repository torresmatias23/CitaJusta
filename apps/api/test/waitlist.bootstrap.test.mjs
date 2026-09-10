import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mock, test } from 'node:test';
import { bootstrapWaitlist } from '../dist/database/waitlist.bootstrap.js';

function setup() {
  const institution = { id: randomUUID() };
  let state = { statuses: [], priorities: [] };
  const prisma = { $transaction: mock.fn(async (fn, options) => {
    assert.equal(options.isolationLevel, 'Serializable');
    const staged = structuredClone(state);
    const result = await fn({
      institution: { findMany: async ({ where }) => {
        assert.equal(where.status, 'ACTIVE'); assert.equal(where.deletedAt, null);
        return !where.id || where.id === institution.id ? [institution] : [];
      } },
      waitlistStatus: {
        createMany: async ({ data, skipDuplicates }) => {
          assert.equal(skipDuplicates, true);
          for (const row of data) if (!staged.statuses.some((s) => s.code === row.code)) staged.statuses.push(row);
        },
        findUniqueOrThrow: async ({ where }) => staged.statuses.find((s) => s.code === where.code),
      },
      priority: {
        findUnique: async ({ where }) => staged.priorities.find((p) => p.code === where.institutionId_code.code && p.institutionId === where.institutionId_code.institutionId),
        create: async ({ data }) => {
          if (staged.priorities.some((p) => p.institutionId === data.institutionId && p.level === data.level)) throw { code: 'P2002' };
          staged.priorities.push(data);
        },
      },
    });
    state = staged;
    return result;
  }) };
  return { prisma, institution, state: () => state };
}
test('bootstrap is repeatable and STANDARD is institutional, never global', async () => {
  const s = setup();
  await bootstrapWaitlist(s.prisma);
  const before = structuredClone(s.state());
  await bootstrapWaitlist(s.prisma);
  assert.deepEqual(s.state(), before);
  assert.equal(before.statuses[0].code, 'ACTIVE');
  assert.equal(before.statuses[0].name, 'Activa');
  assert.equal(before.statuses[0].isFinal, false);
  assert.equal(before.priorities[0].institutionId, s.institution.id);
  assert.equal(before.priorities[0].code, 'STANDARD');
  assert.equal(before.priorities[0].level, 0);
});
test('bootstrap preserves compatible configured labels and priority level', async () => {
  const s = setup();
  await bootstrapWaitlist(s.prisma);
  s.state().priorities[0].level = 12;
  s.state().priorities[0].name = 'Configured label';
  s.state().statuses[0].name = 'Configured state';
  const before = structuredClone(s.state());
  await bootstrapWaitlist(s.prisma, s.institution.id);
  assert.deepEqual(s.state(), before);
});
for (const incompatible of ['status inactive', 'status final', 'priority inactive']) test(`bootstrap does not overwrite ${incompatible}`, async () => {
  const s = setup(); await bootstrapWaitlist(s.prisma);
  if (incompatible === 'status inactive') s.state().statuses[0].active = false;
  if (incompatible === 'status final') s.state().statuses[0].isFinal = true;
  if (incompatible === 'priority inactive') s.state().priorities[0].active = false;
  const before = structuredClone(s.state());
  await assert.rejects(bootstrapWaitlist(s.prisma), /Incompatible/);
  assert.deepEqual(s.state(), before);
});
test('level collision rolls back bootstrap and does not invent another level', async () => {
  const s = setup(); s.state().priorities.push({ institutionId: s.institution.id, code: 'OTHER', level: 0 });
  const before = structuredClone(s.state());
  await assert.rejects(bootstrapWaitlist(s.prisma));
  assert.deepEqual(s.state(), before);
  assert.equal(s.prisma.$transaction.mock.callCount(), 2);
});
test('bootstrap rejects an explicit missing or inactive institution', async () => {
  const s = setup();
  await assert.rejects(bootstrapWaitlist(s.prisma, randomUUID()), /Active institution not found/);
  assert.deepEqual(s.state(), { statuses: [], priorities: [] });
});
