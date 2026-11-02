import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { PrivacyNoticeService } from '../dist/users/privacy-notice.service.js';
import { PrivacyNoticeController, PublicPrivacyNoticeController } from '../dist/users/privacy-notice.controller.js';
import { currentPrivacyNotice as notice, privacyNoticeVersions } from '../dist/users/privacy-notices.js';
import { parsePrivacyAcknowledgement, validatePrivacyRead } from '../dist/users/privacy-notice.schemas.js';
import { privacyStorage } from './fixtures/privacy-notice.mjs';

const status = code => error => error?.getStatus?.() === code;
function fixture() {
  const f = privacyStorage(), userId = randomUUID(), principal = { userId, sessionId: randomUUID() };
  f.users.set(userId, { status: 'ACTIVE', deletedAt: null, firstNames: 'Fictitious' });
  return { ...f, principal, service: new PrivacyNoticeService(f.db) };
}
test('published notice has immutable version/content and explicitly distinguishes acknowledgement from consent', () => {
  assert.equal(createHash('sha256').update(JSON.stringify(privacyNoticeVersions[0])).digest('hex'), '1da8cf0f714047b1db522a68f70315e76d416a5213c71b892a48b952a6acb744');
  assert.equal(new Set(privacyNoticeVersions.map(row => row.id)).size, privacyNoticeVersions.length);
  assert.equal(new Set(privacyNoticeVersions.map(row => row.version)).size, privacyNoticeVersions.length);
  assert.match(notice.introduction, /No es una política legal aprobada/);
  assert.match(JSON.stringify(notice), /No se registra una aceptación/);
  assert.deepEqual(new PublicPrivacyNoticeController().find({}, undefined), { data: notice });
});
test('strict input refuses actor, tenant, timestamp, consent, unknown version format and query injection', () => {
  assert.deepEqual(parsePrivacyAcknowledgement({}, { versionId: notice.id }), { versionId: notice.id });
  for (const body of [{}, { versionId: 'bad' }, { versionId: [notice.id] }, ...['userId', 'institutionId', 'acknowledgedAt', 'consent'].map(key => ({ versionId: notice.id, [key]: 'untrusted' }))]) {
    assert.throws(() => parsePrivacyAcknowledgement({}, body), status(400));
  }
  assert.throws(() => parsePrivacyAcknowledgement({ userId: randomUUID() }, { versionId: notice.id }), status(400));
  assert.throws(() => validatePrivacyRead({ userId: randomUUID() }, undefined), status(400));
  assert.throws(() => validatePrivacyRead({}, { versionId: notice.id }), status(400));
});
test('controller rejects missing identity instead of using body or headers', () => {
  const controller = new PrivacyNoticeController({});
  assert.throws(() => controller.find({}, undefined, {}), status(401));
  assert.throws(() => controller.acknowledge({}, { versionId: notice.id }, {}), status(401));
});
test('accounts without evidence remain unacknowledged; GET never writes', async () => {
  const f = fixture();
  assert.deepEqual(await f.service.findMine(f.principal), { data: { notice, acknowledgedAt: null } });
  assert.equal(f.events.length, 0); assert.equal(f.db.$transaction.mock.callCount(), 0);
});
test('explicit acknowledgement stores minimum evidence and preserves user data; repeated requests preserve first timestamp', async () => {
  const f = fixture(), before = structuredClone([...f.users]);
  const saved = await f.service.acknowledge(notice.id, f.principal);
  assert.deepEqual(await f.service.acknowledge(notice.id, f.principal), saved);
  assert.equal(f.events.length, 1); assert.deepEqual([...f.users], before);
  assert.deepEqual(Object.keys(f.events[0]).sort(), ['actionCode', 'actorType', 'actorUserId', 'id', 'occurredAt', 'outcome', 'resourceId', 'resourceType']);
  assert.equal(f.events[0].actorUserId, f.principal.userId);
  assert.equal(f.events[0].resourceId, notice.id);
  assert.equal(f.events[0].actionCode, 'PRIVACY_NOTICE_ACKNOWLEDGED');
  assert.equal((await f.service.findMine(f.principal)).data.acknowledgedAt, saved.data.acknowledgedAt);
});
test('historical version stays intact and does not acknowledge a newer notice', async () => {
  const f = fixture();
  await f.service.acknowledge(notice.id, f.principal);
  f.events[0].resourceId = randomUUID();
  const historical = structuredClone(f.events[0]);
  assert.equal((await f.service.findMine(f.principal)).data.acknowledgedAt, null);
  await f.service.acknowledge(notice.id, f.principal);
  assert.equal(f.events.length, 2); assert.deepEqual(f.events[0], historical);
});
test('another account or differently scoped audit event cannot satisfy own confirmation', async () => {
  const f = fixture();
  await f.service.acknowledge(notice.id, f.principal);
  assert.equal((await f.service.findMine({ userId: randomUUID(), sessionId: randomUUID() })).data.acknowledgedAt, null);
  f.events[0].institutionId = randomUUID();
  assert.equal((await f.service.findMine(f.principal)).data.acknowledgedAt, null);
});
test('stale/unknown versions fail before transactions or writes', async () => {
  const f = fixture();
  await assert.rejects(f.service.acknowledge(randomUUID(), f.principal), status(409));
  assert.equal(f.db.$transaction.mock.callCount(), 0); assert.equal(f.events.length, 0);
});
test('deactivated and missing accounts fail closed during the locked write', async () => {
  for (const missing of [false, true]) {
    const f = fixture();
    if (missing) f.users.clear(); else f.users.get(f.principal.userId).status = 'INACTIVE';
    await assert.rejects(f.service.acknowledge(notice.id, f.principal), status(401));
    assert.equal(f.events.length, 0);
  }
});
test('simultaneous calls use serialized transaction contract and preserve one acknowledgement', async () => {
  const f = fixture();
  const results = await Promise.all([f.service.acknowledge(notice.id, f.principal), f.service.acknowledge(notice.id, f.principal)]);
  assert.deepEqual(results[0], results[1]); assert.equal(f.events.length, 1);
  assert.equal(f.db.$queryRaw.mock.callCount(), 2);
});
test('write failures remain sanitized and do not produce success evidence', async () => {
  const f = fixture(); f.db.auditEvent.create = async () => { throw new Error('synthetic private detail'); };
  await assert.rejects(f.service.acknowledge(notice.id, f.principal), error => status(500)(error) && !JSON.stringify(error).includes('private detail'));
  assert.equal(f.events.length, 0);
});
