import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { bootstrapAppointmentStatus } from '../dist/database/appointment-status.bootstrap.js';

function database(existing) {
  let stored = existing;
  const appointmentStatus = {
    createMany: mock.fn(async ({ data, skipDuplicates }) => {
      assert.equal(skipDuplicates, true);
      if (!stored) stored = structuredClone(data[0]);
    }),
    findUniqueOrThrow: mock.fn(async ({ where }) => {
      assert.equal(where.code, 'AGENDADA');
      return { code: stored.code };
    }),
  };
  return { appointmentStatus, stored: () => stored };
}

test('appointment status bootstrap is idempotent and delegates allowsConfirmation to the model default', async () => {
  const db = database();
  await bootstrapAppointmentStatus(db);
  const first = structuredClone(db.stored());
  await bootstrapAppointmentStatus(db);
  assert.deepEqual(db.stored(), first);
  const { id, ...configuration } = first;
  assert.match(id, /^[0-9a-f-]{36}$/);
  assert.deepEqual(configuration, {
    code: 'AGENDADA', name: 'Agendada', isFinal: false, allowsCancellation: true, active: true,
  });
  assert.equal(Object.hasOwn(first, 'allowsConfirmation'), false);
});

test('appointment status bootstrap preserves existing identifiers and custom configuration', async () => {
  const existing = {
    id: 'existing-id', code: 'AGENDADA', name: 'Custom', active: false,
    isFinal: true, allowsCancellation: false, allowsConfirmation: true, order: 9,
  };
  const db = database(structuredClone(existing));
  await bootstrapAppointmentStatus(db);
  assert.deepEqual(db.stored(), existing);
});
