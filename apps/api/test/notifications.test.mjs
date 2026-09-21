import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { NotificationsService } from '../dist/notifications/notifications.service.js';
import { NotificationsController } from '../dist/notifications/notifications.controller.js';
import { notificationContent } from '../dist/notifications/notification-content.js';
import { parseNotification, parseNotificationQuery, decodeNotificationCursor, encodeNotificationCursor, emptyInput } from '../dist/notifications/notifications.schemas.js';

const types = ['APPOINTMENT_BOOKED', 'APPOINTMENT_CANCELLED', 'WAITLIST_ENTERED', 'WAITLIST_WITHDRAWN', 'OFFER_CREATED', 'OFFER_ACCEPTED', 'OFFER_REJECTED', 'OFFER_EXPIRED'];
function event(type = 'APPOINTMENT_BOOKED') {
  const id = randomUUID();
  return { recipientUserId: randomUUID(), institutionId: null, branchId: null, type,
    resourceType: type.startsWith('APPOINTMENT') ? 'APPOINTMENT' : type.startsWith('WAITLIST') ? 'WAITLIST_ENTRY' : 'OFFER',
    resourceId: id, dedupeKey: `${type}:${id}`,
    data: ['APPOINTMENT_BOOKED', 'APPOINTMENT_CANCELLED', 'OFFER_ACCEPTED', 'OFFER_CREATED'].includes(type)
      ? { startsAt: '2030-01-01T12:00:00.000Z', ...(type === 'OFFER_CREATED' ? { expiresAt: '2029-12-31T12:00:00.000Z' } : {}) } : {} };
}
test('eight typed events create only controlled data through the supplied transaction', async () => {
  for (const type of types) {
    const input = event(type); let write;
    await NotificationsService.create({ notification: { createMany: async (args) => { write = args; return { count: 1 }; } } }, input);
    assert.equal(write.skipDuplicates, true); assert.equal(write.data.length, 1);
    const { id, ...saved } = write.data[0]; assert.match(id, /^[\da-f-]{36}$/); assert.deepEqual(saved, input);
    assert.ok(!('readAt' in saved));
    const content = notificationContent(input);
    assert.ok(content.title && content.message); assert.ok(['/mis-citas', '/lista-de-espera', '/ofertas'].includes(content.path));
    assert.deepEqual(Object.keys(content).sort(), ['message', 'path', 'title']);
  }
});
test('helper rejects unknown/private content, incoherent keys and resources before any write', async () => {
  const input = event();
  for (const invalid of [{ ...input, type: 'EMAIL' }, { ...input, title: 'arbitrary' }, { ...input, data: { ...input.data, email: 'secret' } },
    { ...input, data: { startsAt: 'bad' } }, { ...input, branchId: randomUUID() }, { ...input, resourceType: 'OFFER' },
    { ...input, dedupeKey: `APPOINTMENT_BOOKED:${randomUUID()}` }]) {
    await assert.rejects(NotificationsService.create({ notification: { createMany: () => assert.fail('must not write') } }, invalid));
  }
  assert.doesNotThrow(() => parseNotification({ ...event('APPOINTMENT_CANCELLED'), dedupeKey: `APPOINTMENT_CANCELLED:${randomUUID()}` }));
});
test('replays do not perform updates and non-duplicate storage failures propagate', async () => {
  await NotificationsService.create({ notification: { createMany: async () => ({ count: 0 }) } }, event());
  const error = new Error('FK failure');
  await assert.rejects(NotificationsService.create({ notification: { createMany: async () => { throw error; } } }, event()), (value) => value === error);
});
test('strict query, default/max limit and canonical timestamp/UUID cursor', () => {
  assert.deepEqual(parseNotificationQuery({}), { limit: 50 }); assert.equal(parseNotificationQuery({ limit: '100' }).limit, 100);
  const row = { id: randomUUID(), createdAt: new Date('2030-01-01T00:00:00.123Z') };
  const cursor = encodeNotificationCursor(row); assert.deepEqual(decodeNotificationCursor(cursor), row);
  assert.equal(parseNotificationQuery({ cursor }).cursor, cursor);
  for (const query of [{ limit: '101' }, { limit: '0' }, { limit: '01' }, { limit: ['5'] }, { userId: randomUUID() }, { cursor: '' }, { cursor: 'bad' }, { cursor: `${cursor}=` }]) {
    assert.throws(() => parseNotificationQuery(query), (error) => error.status === 400);
  }
  for (const body of [null, [], { recipientUserId: randomUUID() }]) assert.throws(() => emptyInput(body));
  emptyInput(undefined); emptyInput({});
});
test('reads scope both list and count to principal and strip private payload fields', async () => {
  const principal = { userId: randomUUID() }; const input = event(); const id = randomUUID(); const createdAt = new Date();
  const tx = { notification: {
    findMany: async (query) => { assert.equal(query.where.recipientUserId, principal.userId); assert.equal(query.take, 51);
      assert.deepEqual(query.orderBy, [{ createdAt: 'desc' }, { id: 'desc' }]);
      return [{ id, type: input.type, data: input.data, resourceId: input.resourceId, resourceType: input.resourceType, createdAt, readAt: null }]; },
    count: async ({ where }) => { assert.deepEqual(where, { recipientUserId: principal.userId, readAt: null }); return 1; },
  } };
  const result = await new NotificationsService({ $transaction: async (fn, options) => { assert.equal(options.isolationLevel, 'RepeatableRead'); return fn(tx); } }).findMine({ limit: 50 }, principal);
  assert.equal(result.unreadCount, 1); assert.equal(result.page.nextCursor, null);
  assert.deepEqual(Object.keys(result.data[0]).sort(), ['id', 'type', 'resourceType', 'resourceId', 'title', 'message', 'path', 'createdAt', 'readAt'].sort());
});
test('controller requires principal and rejects functional body/query on read', () => {
  const controller = new NotificationsController({ read: () => assert.fail('must not call') });
  assert.throws(() => controller.findMine({}, undefined, {}), (error) => error.status === 401);
  const req = { principal: { userId: randomUUID() } }, params = { notificationId: randomUUID() };
  assert.throws(() => controller.read(params, {}, { readAt: 'custom' }, req), (error) => error.status === 400);
  assert.throws(() => controller.read(params, { recipientUserId: randomUUID() }, undefined, req), (error) => error.status === 400);
});
