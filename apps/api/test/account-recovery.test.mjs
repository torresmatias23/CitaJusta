import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { mock, test } from 'node:test';
import { ConfigService } from '@nestjs/config';
import * as argon2 from 'argon2';
import { validateEnvironment } from '../dist/config/environment.validation.js';
import { AccountRecoveryCrypto, hasLocalCredential, recoveryTokenHash } from '../dist/auth/account-recovery.crypto.js';
import { AccountRecoveryService, parseRecoveryRequest, parseRecoveryReset, recoveryAcknowledgement } from '../dist/auth/account-recovery.service.js';
import { AccountRecoveryDeliveryService } from '../dist/auth/account-recovery-delivery.service.js';
import { EmailProviderError } from '../dist/notifications/resend.client.js';

const password = 'A-strong-test-password-188';
const hash = await argon2.hash(password, { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 });
const baseConfig = { DATABASE_URL: 'postgresql://unused:unused@127.0.0.1:1/unused',
  JWT_ACCESS_SECRET: randomBytes(32).toString('hex'), JWT_REFRESH_SECRET: randomBytes(32).toString('hex'),
  ACCOUNT_RECOVERY_ENABLED: 'true', ACCOUNT_RECOVERY_WEB_ORIGIN: 'http://127.0.0.1:5173', ACCOUNT_RECOVERY_KEY_ID: 'unit-test',
  ACCOUNT_RECOVERY_ENCRYPTION_KEY: randomBytes(32).toString('hex'), ACCOUNT_RECOVERY_HMAC_KEY: randomBytes(32).toString('hex'),
  RESEND_API_KEY: 're_offline_test_only', RESEND_FROM: 'CitaJusta <fixture@example.test>', EMAIL_DELIVERY_ENABLED: 'true' };

function fixture(overrides = {}) {
  const config = new ConfigService(validateEnvironment({ ...baseConfig, ...overrides }));
  const crypto = new AccountRecoveryCrypto(config);
  let state = { user: { id: randomUUID(), email: 'local@example.test', passwordHash: hash, status: 'ACTIVE', deletedAt: null }, limits: new Map(), rows: new Map(), sessions: [{ revokedAt: null }], audits: [] };
  let failAudit = false;
  function matches(row, where) {
    if (where.id && (typeof where.id === 'string' ? row.id !== where.id : row.id === where.id.not)) return false;
    if (where.userId && row.userId !== where.userId) return false;
    for (const field of ['consumedAt', 'invalidatedAt', 'claimToken', 'deliveryStatus']) if (where[field] !== undefined && row[field] !== where[field]) return false;
    if (where.expiresAt?.gt && row.expiresAt <= where.expiresAt.gt) return false;
    if (where.lockedUntil?.gt && row.lockedUntil <= where.lockedUntil.gt) return false;
    if (where.OR && !where.OR.some(condition => row.deliveryStatus === condition.deliveryStatus &&
      (condition.nextAttemptAt ? row.nextAttemptAt <= condition.nextAttemptAt.lte : row.lockedUntil <= condition.lockedUntil.lte))) return false;
    return true;
  }
  const db = {
    user: { findUnique: async () => state.user, update: async ({ data }) => { Object.assign(state.user, data); } },
    accountRecoveryLimit: {
      upsert: async ({ where, create }) => { if (!state.limits.has(where.emailHmac)) state.limits.set(where.emailHmac, { ...create }); return { ...state.limits.get(where.emailHmac) }; },
      update: async ({ where, data }) => Object.assign(state.limits.get(where.emailHmac), data),
    },
    accountRecovery: {
      create: async ({ data }) => { state.rows.set(data.id, { ...data, consumedAt: null, invalidatedAt: null, deliveryStatus: 'PENDING', attemptCount: 0, claimToken: null, lockedUntil: null }); },
      findUnique: async ({ where }) => { const row = [...state.rows.values()].find(row => row.tokenHash === where.tokenHash); return row ? { ...row, user: state.user } : null; },
      findUniqueOrThrow: async ({ where }) => ({ ...state.rows.get(where.id), user: state.user }),
      updateMany: async ({ where, data }) => { let count = 0; for (const row of state.rows.values()) if (matches(row, where)) {
        const attemptCount = row.attemptCount + (data.attemptCount?.increment ?? 0); Object.assign(row, data); row.attemptCount = attemptCount; count++;
      } return { count }; },
    },
    authSession: { updateMany: async ({ data }) => { state.sessions.forEach(session => Object.assign(session, data)); } },
    auditEvent: { create: async ({ data }) => { if (failAudit) throw new Error('private audit failure'); state.audits.push(data); } },
  };
  db.$transaction = mock.fn(async (fn, options) => {
    assert.equal(options.isolationLevel, 'Serializable');
    const snapshot = structuredClone(state);
    try { return await fn(db); } catch (error) { state = snapshot; throw error; }
  });
  const service = new AccountRecoveryService(db, config, crypto);
  const sender = { send: mock.fn(async () => randomUUID()) };
  const delivery = new AccountRecoveryDeliveryService(db, config, crypto, sender);
  return { config, crypto, db, service, delivery, sender, state: () => state, failAudit: () => { failAudit = true; },
    row: () => [...state.rows.values()].at(-1),
    token: () => { const row = [...state.rows.values()].at(-1); return new URLSearchParams(new URL(crypto.decrypt(row.id, row).text.split('\n')[1]).hash.slice(1)).get('token'); },
    releaseCooldown: () => { for (const limit of state.limits.values()) limit.lastAcceptedAt = new Date(Date.now() - 61000); },
  };
}
const status = code => error => error.getStatus?.() === code;

test('strict request normalizes email and reset reuses the 12..128 password policy without echoing inputs', () => {
  assert.deepEqual(parseRecoveryRequest({ email: ' PERSON@EXAMPLE.TEST ' }), { email: 'person@example.test' });
  for (const value of [{ email: 'bad' }, { email: 'valid@example.test', userId: randomUUID() }]) assert.throws(() => parseRecoveryRequest(value), status(400));
  for (const value of [{ token: 'bad', password }, { token: 'a'.repeat(43), password: 'short' }, { token: 'a'.repeat(43), password: 'p'.repeat(129) }, { token: 'a'.repeat(43), password, userId: randomUUID() }]) {
    assert.throws(() => parseRecoveryReset(value), error => { assert.equal(error.status, 400); assert.ok(!JSON.stringify(error.getResponse()).includes(value.password)); return true; });
  }
});
test('startup rejects missing/reused keys, insecure origins and invalid policies, without leaking values', () => {
  assert.equal(validateEnvironment(baseConfig).ACCOUNT_RECOVERY_TTL_MINUTES, 30);
  for (const values of [{ ACCOUNT_RECOVERY_ENCRYPTION_KEY: 'secret-invalid' }, { ACCOUNT_RECOVERY_HMAC_KEY: '' },
    { ACCOUNT_RECOVERY_HMAC_KEY: baseConfig.ACCOUNT_RECOVERY_ENCRYPTION_KEY }, { ACCOUNT_RECOVERY_KEY_ID: '' },
    { ACCOUNT_RECOVERY_WEB_ORIGIN: 'http://example.test' }, { ACCOUNT_RECOVERY_WEB_ORIGIN: 'https://user:pass@example.test' },
    { ACCOUNT_RECOVERY_TTL_MINUTES: '0' }, { ACCOUNT_RECOVERY_MAX_REQUESTS: '1.5' }, { ACCOUNT_RECOVERY_MIN_INTERVAL_SECONDS: '-1' }, { ACCOUNT_RECOVERY_WINDOW_MINUTES: '0' }, { RESEND_FROM: '' }]) {
    assert.throws(() => validateEnvironment({ ...baseConfig, ...values }), error => !error.message.includes('secret-invalid'));
  }
});
test('AES-GCM uses random nonces, authenticated record binding and HMAC normalized identifiers', () => {
  const f = fixture(), id = randomUUID(), payload = { from: baseConfig.RESEND_FROM, to: ['local@example.test'], subject: 'Recovery', text: 'opaque link' };
  const first = f.crypto.encrypt(id, payload), second = f.crypto.encrypt(id, payload);
  assert.deepEqual(f.crypto.decrypt(id, first), payload); assert.equal(first.nonce.length, 12); assert.equal(first.authTag.length, 16);
  assert.notDeepEqual(first.nonce, second.nonce); assert.ok(!first.ciphertext.includes(Buffer.from('opaque link')));
  for (const bad of [{ ...first, ciphertext: Buffer.from('tampered') }, { ...first, keyId: 'unknown' }, { ...first, authTag: randomBytes(16) }]) assert.throws(() => f.crypto.decrypt(id, bad), /^Error: Recovery delivery envelope unavailable$/);
  assert.throws(() => f.crypto.decrypt(randomUUID(), first));
  assert.equal(f.crypto.emailHmac(' Local@Example.test '), f.crypto.emailHmac('local@example.test'));
  assert.match(f.crypto.token(), /^[A-Za-z0-9_-]{43}$/); assert.notEqual(f.crypto.token(), f.crypto.token());
});
test('request stores only token hash plus encrypted frozen delivery and controlled audit/response', async () => {
  const f = fixture(); assert.deepEqual(await f.service.request('local@example.test'), recoveryAcknowledgement);
  const row = f.row(), token = f.token(); assert.equal(row.tokenHash, recoveryTokenHash(token));
  assert.equal(row.expiresAt - row.createdAt, 30 * 60000);
  assert.ok(!JSON.stringify(f.state()).includes(token));
  assert.ok(!JSON.stringify(f.state().audits).includes('local@example.test')); assert.equal(f.state().audits[0].actionCode, 'ACCOUNT_RECOVERY_REQUESTED');
  assert.equal(f.sender.send.mock.callCount(), 0);
});
for (const kind of ['missing', 'google-only', 'inactive', 'deleted', 'technical']) {
  test(`request for ${kind} account is generic but applies persistent email limits`, async () => {
    const f = fixture();
    if (kind === 'missing') f.state().user = null;
    if (kind === 'google-only') f.state().user.passwordHash = null;
    if (kind === 'inactive') f.state().user.status = 'INACTIVE';
    if (kind === 'deleted') f.state().user.deletedAt = new Date();
    if (kind === 'technical') f.state().user.passwordHash = '!CITA_JUSTA_DEMO_NO_LOGIN!';
    assert.deepEqual(await f.service.request('local@example.test'), recoveryAcknowledgement);
    assert.equal(f.state().rows.size, 0); assert.equal([...f.state().limits.values()][0].requestCount, 1);
  });
}
test('cooldown, quota, window reset and atomic replacement preserve only one outstanding token', async () => {
  const f = fixture(); await f.service.request('local@example.test'); const first = f.row();
  await f.service.request('LOCAL@example.test'); assert.equal(f.state().rows.size, 1);
  for (let i = 0; i < 2; i++) { f.releaseCooldown(); await f.service.request('local@example.test'); }
  assert.equal(f.state().rows.size, 3); assert.ok(first.invalidatedAt); assert.equal(first.ciphertext, null);
  f.releaseCooldown(); assert.deepEqual(await f.service.request('local@example.test'), recoveryAcknowledgement); assert.equal(f.state().rows.size, 3);
  for (const limit of f.state().limits.values()) limit.expiresAt = new Date(0);
  await f.service.request('local@example.test'); assert.equal(f.state().rows.size, 4); assert.equal([...f.state().limits.values()][0].requestCount, 1);
});
test('reset consumes once, clears ciphertext, revokes all sessions, hashes with Argon2id and audits', async () => {
  const f = fixture(); await f.service.request('local@example.test'); const token = f.token();
  await f.service.reset(token, 'A-new-secure-password-188');
  assert.ok(f.row().consumedAt); assert.equal(f.row().ciphertext, null); assert.equal(f.row().nonce, null);
  assert.equal(await argon2.verify(f.state().user.passwordHash, 'A-new-secure-password-188'), true);
  assert.equal(hasLocalCredential(f.state().user.passwordHash), true); assert.ok(f.state().sessions.every(session => session.revokedAt));
  await assert.rejects(f.service.reset(token, password), status(400));
  assert.equal(f.state().audits.filter(a => a.actionCode === 'ACCOUNT_PASSWORD_RESET').length, 1);
});
test('expired, manipulated and invalidated tokens cannot change credentials', async () => {
  const f = fixture(); await f.service.request('local@example.test'); const token = f.token();
  await assert.rejects(f.service.reset(f.crypto.token(), password), status(400));
  f.row().expiresAt = new Date(0); await assert.rejects(f.service.reset(token, password), status(400));
  f.row().expiresAt = new Date(Date.now() + 100000); f.row().invalidatedAt = new Date();
  await assert.rejects(f.service.reset(token, password), status(400)); assert.equal(f.state().user.passwordHash, hash);
});
test('audit failure rolls back token consumption, password and session revocations', async () => {
  const f = fixture(); await f.service.request('local@example.test'); const token = f.token(); f.failAudit();
  await assert.rejects(f.service.reset(token, 'A-new-secure-password-188'), status(500));
  assert.equal(f.row().consumedAt, null); assert.ok(f.row().ciphertext); assert.equal(f.state().user.passwordHash, hash);
  assert.ok(f.state().sessions.every(session => session.revokedAt === null));
});
test('request audit failure rolls back admission, replacement and sensitive delivery', async () => {
  const f = fixture(); f.failAudit(); await assert.rejects(f.service.request('local@example.test'), status(500));
  assert.equal(f.state().rows.size, 0); assert.equal(f.state().limits.size, 0);
});
test('recovery retries only recognized transaction conflicts, never programming defects', async () => {
  const f = fixture(), original = f.db.$transaction;
  let attempts = 0;
  f.db.$transaction = async (...args) => { if (++attempts === 1) throw { code: 'P2034' }; return original(...args); };
  await f.service.request('local@example.test'); assert.equal(attempts, 2); assert.equal(f.state().rows.size, 1);
  attempts = 0; f.db.$transaction = async () => { attempts++; throw new TypeError('private programming defect'); };
  await assert.rejects(f.service.request('local@example.test'), error => error.status === 500 && !error.message.includes('private'));
  assert.equal(attempts, 1);
});
test('provider sends only claimed/decrypted payload, reuses ID, then purges sensitive envelope', async () => {
  const f = fixture(); await f.service.request('local@example.test'); const row = f.row(), token = f.token();
  await f.delivery.deliver(row.id);
  assert.equal(f.sender.send.mock.callCount(), 1); assert.equal(f.sender.send.mock.calls[0].arguments[0], row.id);
  assert.ok(f.sender.send.mock.calls[0].arguments[1].text.includes(token));
  assert.equal(row.deliveryStatus, 'SENT'); assert.equal(row.ciphertext, null); assert.equal(row.authTag, null);
  await f.delivery.deliver(row.id); assert.equal(f.sender.send.mock.callCount(), 1);
  await f.service.reset(token, password); assert.ok(f.row().consumedAt);
});
test('uncertain provider failure retries identical frozen content with bounded attempts', async () => {
  const f = fixture(); await f.service.request('local@example.test'); const row = f.row();
  f.sender.send.mock.mockImplementationOnce(async () => { throw new EmailProviderError('RESEND_TIMEOUT', true); });
  await f.delivery.deliver(row.id); assert.equal(row.deliveryStatus, 'PENDING'); assert.ok(row.ciphertext);
  row.nextAttemptAt = new Date(0); await f.delivery.deliver(row.id);
  assert.deepEqual(f.sender.send.mock.calls[0].arguments, f.sender.send.mock.calls[1].arguments);
  assert.equal(row.deliveryStatus, 'SENT');
});
test('terminal provider error purges envelope, while programming errors are not provider retries', async () => {
  const f = fixture(); await f.service.request('local@example.test');
  f.sender.send.mock.mockImplementation(async () => { throw new EmailProviderError('RESEND_HTTP_400', false); });
  await f.delivery.deliver(f.row().id); assert.equal(f.row().deliveryStatus, 'FAILED'); assert.equal(f.row().ciphertext, null);
  f.releaseCooldown(); await f.service.request('local@example.test');
  f.sender.send.mock.mockImplementation(async () => { throw new TypeError('provider programming defect'); });
  await assert.rejects(f.delivery.deliver(f.row().id), /provider programming defect/); assert.equal(f.row().deliveryStatus, 'FAILED'); assert.equal(f.row().ciphertext, null);
});
test('delivery skips consumed/invalidated/expired links, foreign recipients and closes retry window', async () => {
  for (const change of [row => { row.consumedAt = new Date(); }, row => { row.invalidatedAt = new Date(); }, row => { row.expiresAt = new Date(0); }, row => { row.attemptCount = 10; }]) {
    const f = fixture(); await f.service.request('local@example.test'); change(f.row()); await f.delivery.deliver(f.row().id); assert.equal(f.sender.send.mock.callCount(), 0);
  }
  const f = fixture(); await f.service.request('local@example.test'); f.state().user.email = 'changed@example.test';
  await f.delivery.deliver(f.row().id); assert.equal(f.row().lastErrorCode, 'EMAIL_RECIPIENT_CHANGED'); assert.equal(f.sender.send.mock.callCount(), 0);
});
test('disabled feature fails explicitly without looking up accounts or claiming success', async () => {
  const f = fixture({ ACCOUNT_RECOVERY_ENABLED: 'false' });
  await assert.rejects(f.service.request('local@example.test'), status(503)); assert.equal(f.db.$transaction.mock.callCount(), 0);
});

test('invalid encryption envelope becomes a safe terminal delivery without leaking contents', async () => {
  const f = fixture(); await f.service.request('local@example.test'); f.row().authTag = randomBytes(16);
  await f.delivery.deliver(f.row().id); assert.equal(f.row().lastErrorCode, 'EMAIL_ENVELOPE_INVALID');
  assert.equal(f.row().ciphertext, null); assert.equal(f.sender.send.mock.callCount(), 0);
});

test('expiry or invalidation after claim prevents sending at the final guarded check', async () => {
  const f = fixture(); await f.service.request('local@example.test');
  const decrypt = f.crypto.decrypt.bind(f.crypto);
  f.crypto.decrypt = (...args) => { const payload = decrypt(...args); f.row().invalidatedAt = new Date(); return payload; };
  await f.delivery.deliver(f.row().id); assert.equal(f.sender.send.mock.callCount(), 0);
});

test('provider success followed by DB failure retains stable envelope for an uncertain idempotent retry', async () => {
  const f = fixture(); await f.service.request('local@example.test');
  const update = f.db.accountRecovery.updateMany;
  f.db.accountRecovery.updateMany = args => { if (args.data.deliveryStatus === 'SENT') throw new Error('controlled storage failure'); return update(args); };
  await assert.rejects(f.delivery.deliver(f.row().id), /controlled storage failure/);
  assert.equal(f.row().deliveryStatus, 'PROCESSING'); assert.ok(f.row().ciphertext);
  f.db.accountRecovery.updateMany = update; f.row().lockedUntil = new Date(0);
  await f.delivery.deliver(f.row().id);
  assert.deepEqual(f.sender.send.mock.calls[0].arguments, f.sender.send.mock.calls[1].arguments);
  assert.equal(f.row().deliveryStatus, 'SENT');
});
