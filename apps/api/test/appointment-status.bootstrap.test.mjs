import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { bootstrapAppointmentStatus } from '../dist/database/appointment-status.bootstrap.js';

function database(existing) {
  const stored = new Map(existing ? [[existing.code, existing]] : []);
  const appointmentStatus = {
    createMany: mock.fn(async ({ data, skipDuplicates }) => {
      assert.equal(skipDuplicates, true);
      for (const row of data) {
        if (!stored.has(row.code)) stored.set(row.code, structuredClone(row));
      }
    }),
    findUniqueOrThrow: mock.fn(async ({ where }) => {
      assert.ok(stored.has(where.code));
      return { code: where.code };
    }),
  };
  return { appointmentStatus, stored: (code = 'AGENDADA') => stored.get(code) };
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

test('cancellation status bootstrap creates one final, active, non-cancelable CANCELADA', async () => {
  const db = database();
  await bootstrapAppointmentStatus(db);
  const first = structuredClone(db.stored('CANCELADA'));
  await bootstrapAppointmentStatus(db);
  assert.deepEqual(db.stored('CANCELADA'), first);
  const { id, ...configuration } = first;
  assert.match(id, /^[0-9a-f-]{36}$/);
  assert.deepEqual(configuration, {
    code: 'CANCELADA', name: 'Cancelada', isFinal: true, active: true,
    allowsCancellation: false, allowsConfirmation: false,
  });
});

test('cancellation status bootstrap never overwrites existing CANCELADA configuration', async () => {
  const existing = {
    id: 'existing-cancellation-id', code: 'CANCELADA', name: 'Custom', active: false,
    isFinal: false, allowsCancellation: true, allowsConfirmation: true, order: 9,
  };
  const db = database(structuredClone(existing));
  await bootstrapAppointmentStatus(db);
  assert.deepEqual(db.stored('CANCELADA'), existing);
  assert.equal(db.stored().code, 'AGENDADA');
});
