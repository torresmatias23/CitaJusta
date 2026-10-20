import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mock, test } from 'node:test';
import { Prisma } from '../dist/generated/prisma/client.js';
import { UsersService } from '../dist/users/users.service.js';
import { UsersController } from '../dist/users/users.controller.js';
import { parseProfileUpdate, parsePreferencesUpdate } from '../dist/users/users.schemas.js';
import { NotificationsService } from '../dist/notifications/notifications.service.js';

const principal = { userId: randomUUID(), sessionId: randomUUID() };
const context = { userId: principal.userId, roleCodes: [], permissions: [] };
const enabled = { appointmentEmailsEnabled: true, offerEmailsEnabled: true };
const conflict = () => new Prisma.PrismaClientKnownRequestError('private SQL', { code: 'P2034', clientVersion: '7.10.0' });
function fixture(options = {}) {
  let state = { user: { id: principal.userId, email: 'profile@example.test', firstNames: 'Ana', lastNames: 'Pérez',
    phone: null, status: 'ACTIVE', ...enabled, ...options.user }, audits: [], deliveries: options.deliveries ?? [] };
  const calls = [];
  const prisma = { $transaction: mock.fn(async (operation, settings) => {
    assert.equal(settings.isolationLevel, 'Serializable');
    if (options.conflicts-- > 0) throw conflict();
    const draft = structuredClone(state);
    const tx = { user: {
      findFirst: async (args) => { calls.push(args); return options.missing ? null : draft.user; },
      updateMany: async ({ where, data }) => { assert.deepEqual(where, { id: principal.userId, status: 'ACTIVE', deletedAt: null }); Object.assign(draft.user, data); return { count: 1 }; },
    }, auditEvent: { create: async ({ data }) => { if (options.failAudit) throw new TypeError('private failure'); draft.audits.push(data); } },
    notificationEmailDelivery: { updateMany: async ({ where, data }) => {
      assert.deepEqual(where.status.in, ['PENDING', 'PROCESSING']);
      assert.equal(where.notification.recipientUserId, principal.userId);
      for (const row of draft.deliveries) if (where.status.in.includes(row.status) && row.userId === principal.userId && where.notification.type.in.includes(row.type)) {
        Object.assign(row, data, { payload: null });
      }
      return { count: 1 };
    } } };
    const result = await operation(tx); state = draft; return result;
  }) };
  return { service: new UsersService(prisma), prisma, calls, state: () => state };
}

test('profile strict partial input trims names/phone and accepts nullable phone', () => {
  assert.deepEqual(parseProfileUpdate({ firstName: '  Ana  ', phone: ' +56 (2) 123 ' }, {}), { firstName: 'Ana', phone: '+56 (2) 123' });
  assert.deepEqual(parseProfileUpdate({ phone: null }, {}), { phone: null });
  assert.deepEqual(parseProfileUpdate({ lastName: 'x'.repeat(120), phone: 'x'.repeat(30) }, {}), { lastName: 'x'.repeat(120), phone: 'x'.repeat(30) });
});
test('profile rejects protected fields, empty PATCH, query and invalid bounds without echoing input', () => {
  const bad = [{}, null, [], { firstName: ' ' }, { lastName: 'x'.repeat(121) }, { phone: '' }, { phone: 'x'.repeat(31) }, { phone: 123 }];
  for (const key of ['id', 'userId', 'email', 'rut', 'password', 'passwordHash', 'status', 'roles', 'permissions', 'institutionId', 'appointmentEmailsEnabled']) bad.push({ firstName: 'Ana', [key]: 'secret' });
  for (const body of bad) assert.throws(() => parseProfileUpdate(body, {}), error => error.getStatus() === 400 && !error.message.includes('secret'));
  assert.throws(() => parseProfileUpdate({ firstName: 'Ana' }, { userId: randomUUID() }), error => error.getStatus() === 400);
});
test('preferences require exactly two independent real booleans', () => {
  for (const appointmentEmailsEnabled of [true, false]) for (const offerEmailsEnabled of [true, false]) {
    const body = { appointmentEmailsEnabled, offerEmailsEnabled }; assert.deepEqual(parsePreferencesUpdate(body, {}), body);
  }
  for (const body of [{}, { appointmentEmailsEnabled: true }, { ...enabled, userId: randomUUID() }, { ...enabled, offerEmailsEnabled: 'false' }])
    assert.throws(() => parsePreferencesUpdate(body, {}), error => error.getStatus() === 400);
  assert.throws(() => parsePreferencesUpdate(enabled, { institutionId: randomUUID() }), error => error.getStatus() === 400);
});
test('PATCH writes only supplied fields, returns minimal DTO, audits effective changes without PII', async () => {
  const f = fixture();
  assert.deepEqual(await f.service.updateMe({ firstName: 'Nueva' }, principal, context), { data: { firstName: 'Nueva', lastName: 'Pérez', phone: null } });
  assert.equal(f.state().user.email, 'profile@example.test');
  assert.equal(f.state().audits.length, 1);
  const audit = f.state().audits[0];
  assert.equal(audit.actionCode, 'ACCOUNT_PROFILE_UPDATED'); assert.equal(audit.actorUserId, principal.userId);
  assert.doesNotMatch(JSON.stringify(audit), /Nueva|Pérez|profile@example|firstName|phone|password/);
  await f.service.updateMe({ firstName: 'Nueva' }, principal, context); assert.equal(f.state().audits.length, 1);
  await f.service.updateMe({ phone: '123' }, principal, context); await f.service.updateMe({ phone: null }, principal, context);
  assert.equal(f.state().user.phone, null);
});
test('identity mismatch and inactive/deleted user cannot write', async () => {
  for (const method of ['updateMe', 'updatePreferences']) {
    const f = fixture(); const body = method === 'updateMe' ? { firstName: 'Otra' } : enabled;
    await assert.rejects(f.service[method](body, principal, { ...context, userId: randomUUID() }), error => error.getStatus() === 401);
    assert.equal(f.prisma.$transaction.mock.callCount(), 0);
    const missing = fixture({ missing: true });
    await assert.rejects(missing.service[method](body, principal, context), error => error.getStatus() === 401);
    assert.deepEqual(missing.calls[0].where, { id: principal.userId, status: 'ACTIVE', deletedAt: null });
  }
});
test('controller requires principal/context and never takes client identity', async () => {
  const updateMe = mock.fn(async () => ({ data: {} })), updatePreferences = mock.fn(async () => ({ data: enabled }));
  const controller = new UsersController({ updateMe, updatePreferences });
  assert.throws(() => controller.updateMe({ firstName: 'Ana' }, {}, {}), error => error.getStatus() === 401);
  await controller.updateMe({ firstName: ' Ana ' }, {}, { principal, authorization: context });
  assert.deepEqual(updateMe.mock.calls[0].arguments, [{ firstName: 'Ana' }, principal, context]);
  await controller.updatePreferences(enabled, {}, { principal, authorization: context });
  assert.deepEqual(updatePreferences.mock.calls[0].arguments, [enabled, principal, context]);
});
test('disable suppresses only owned categories and pending/claimed deliveries, clears sensitive payload and leases', async () => {
  const rows = ['PENDING', 'PROCESSING', 'SENT', 'FAILED'].flatMap(status => ['APPOINTMENT_BOOKED', 'OFFER_CREATED'].map(type =>
    ({ status, type, userId: principal.userId, payload: { to: 'private' }, claimToken: 'old', lockedUntil: new Date() })));
  rows.push({ status: 'PENDING', type: 'APPOINTMENT_BOOKED', userId: randomUUID(), payload: { to: 'other' } });
  const f = fixture({ deliveries: rows });
  const prefs = { appointmentEmailsEnabled: false, offerEmailsEnabled: true };
  assert.deepEqual(await f.service.updatePreferences(prefs, principal, context), { data: prefs });
  for (const row of f.state().deliveries.slice(0, 4).filter(row => row.type === 'APPOINTMENT_BOOKED')) {
    assert.equal(row.status, 'FAILED'); assert.equal(row.lastErrorCode, 'EMAIL_PREFERENCE_DISABLED');
    assert.equal(row.payload, null); assert.equal(row.claimToken, null); assert.equal(row.lockedUntil, null);
  }
  assert.equal(f.state().deliveries[1].status, 'PENDING'); assert.equal(f.state().deliveries[4].status, 'SENT');
  assert.equal(f.state().deliveries.at(-1).status, 'PENDING');
  assert.equal(f.state().audits[0].actionCode, 'ACCOUNT_EMAIL_PREFERENCES_UPDATED');
  assert.doesNotMatch(JSON.stringify(f.state().audits), /appointmentEmailsEnabled|offerEmailsEnabled|profile@example/);
  await f.service.updatePreferences(prefs, principal, context); assert.equal(f.state().audits.length, 1);
  await f.service.updatePreferences(enabled, principal, context);
  assert.equal(f.state().deliveries[0].status, 'FAILED'); assert.equal(f.state().deliveries[0].payload, null);
});
test('audit failure rolls back user preferences and suppression', async () => {
  const f = fixture({ failAudit: true, deliveries: [{ userId: principal.userId, type: 'OFFER_CREATED', status: 'PENDING', payload: { to: 'private' } }] });
  await assert.rejects(f.service.updatePreferences({ appointmentEmailsEnabled: true, offerEmailsEnabled: false }, principal, context), error => error.getStatus() === 500);
  assert.equal(f.state().user.offerEmailsEnabled, true); assert.equal(f.state().deliveries[0].status, 'PENDING'); assert.equal(f.state().audits.length, 0);
});
test('bounded retries rerun entire Serializable transaction; arbitrary errors are not 409', async () => {
  const f = fixture({ conflicts: 2 }); await f.service.updateMe({ firstName: 'Nueva' }, principal, context);
  assert.equal(f.prisma.$transaction.mock.callCount(), 3); assert.equal(f.state().audits.length, 1);
  const persistent = fixture({ conflicts: 3 });
  await assert.rejects(persistent.service.updatePreferences(enabled, principal, context), error => error.getStatus() === 409);
  assert.equal(persistent.prisma.$transaction.mock.callCount(), 3);
  const error = fixture(); error.prisma.$transaction.mock.mockImplementation(async () => { throw new TypeError('secret SQL'); });
  await assert.rejects(error.service.updateMe({ phone: null }, principal, context), value => value.getStatus() === 500 && !value.message.includes('secret'));
  assert.equal(error.prisma.$transaction.mock.callCount(), 1);
});
test('enqueue persists internal events and terminal tombstones for disabled categories; replay cannot revive', async () => {
  const deliveries = new Map(), notifications = new Map();
  const prefs = { appointmentEmailsEnabled: false, offerEmailsEnabled: false };
  const tx = { user: { findUniqueOrThrow: async () => prefs }, notification: {
    createMany: async ({ data }) => { for (const row of data) if (!notifications.has(row.dedupeKey)) notifications.set(row.dedupeKey, row); },
    findUniqueOrThrow: async ({ where }) => notifications.get(where.recipientUserId_dedupeKey.dedupeKey),
  }, notificationEmailDelivery: { createMany: async ({ data, skipDuplicates }) => { assert.equal(skipDuplicates, true); for (const row of data) if (!deliveries.has(row.notificationId)) deliveries.set(row.notificationId, row); } } };
  for (const type of ['APPOINTMENT_BOOKED', 'APPOINTMENT_CANCELLED', 'OFFER_CREATED', 'OFFER_ACCEPTED', 'OFFER_REJECTED', 'OFFER_EXPIRED', 'WAITLIST_ENTERED', 'WAITLIST_WITHDRAWN']) {
    const resourceId = randomUUID();
    const input = { recipientUserId: principal.userId, institutionId: null, branchId: null, type, resourceId, dedupeKey: `${type}:${resourceId}`,
      resourceType: type.startsWith('APPOINTMENT') ? 'APPOINTMENT' : type.startsWith('OFFER') ? 'OFFER' : 'WAITLIST_ENTRY',
      data: ['APPOINTMENT_BOOKED', 'APPOINTMENT_CANCELLED', 'OFFER_CREATED', 'OFFER_ACCEPTED'].includes(type) ? { startsAt: '2030-01-01T12:00:00.000Z', ...(type === 'OFFER_CREATED' ? { expiresAt: '2029-12-31T12:00:00.000Z' } : {}) } : {} };
    await NotificationsService.create(tx, input); prefs.appointmentEmailsEnabled = true; prefs.offerEmailsEnabled = true;
    await NotificationsService.create(tx, input); prefs.appointmentEmailsEnabled = false; prefs.offerEmailsEnabled = false;
  }
  assert.equal(notifications.size, 8); assert.equal(deliveries.size, 6);
  for (const row of deliveries.values()) { assert.equal(row.status, 'FAILED'); assert.equal(row.lastErrorCode, 'EMAIL_PREFERENCE_DISABLED'); }
});
