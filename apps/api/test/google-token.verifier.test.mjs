import assert from 'node:assert/strict';
import { test } from 'node:test';
import { generateKeyPairSync, sign } from 'node:crypto';
import { GoogleTokenVerifier } from '../dist/auth/google-token.verifier.js';
import { parseGoogleCredential } from '../dist/auth/schemas/auth.schemas.js';
import { validateEnvironment } from '../dist/config/environment.validation.js';

const clientId = 'test-web.apps.googleusercontent.com';
const valid = { sub: 'google-subject', email: ' Person@Example.Test ', email_verified: true,
  iss: 'https://accounts.google.com', aud: clientId, exp: Math.floor(Date.now() / 1000) + 3600,
  given_name: ' Ana ', family_name: ' Pérez ', picture: 'ignored', roles: ['IGNORED'] };
const invalid = (error) => error.status === 401 && error.message === 'Invalid Google credential' && !/secret|credential-value/.test(JSON.stringify(error));
function adapter(claims = valid, config = {}) {
  const settings = { GOOGLE_AUTH_ENABLED: true, GOOGLE_CLIENT_ID: clientId, ...config };
  const verifier = new GoogleTokenVerifier({ get: (key) => settings[key] });
  let calls = 0;
  verifier.client.verifyIdToken = async (options) => {
    calls++; assert.deepEqual(options, { idToken: 'credential-value', audience: clientId });
    if (claims instanceof Error) throw claims;
    return { getPayload: () => claims };
  };
  return { verifier, calls: () => calls };
}
test('Google adapter uses official cryptographic verifier and returns only normalized verified identity', async () => {
  const { verifier, calls } = adapter();
  assert.deepEqual(await verifier.verify('credential-value'), { subject: valid.sub, email: 'person@example.test', firstName: 'Ana', lastName: 'Pérez' });
  assert.equal(calls(), 1);
  assert.deepEqual(await adapter({ ...valid, given_name: undefined, family_name: undefined }).verifier.verify('credential-value'),
    { subject: valid.sub, email: 'person@example.test' });
});
test('invalid signature/library failures are sanitized', async () => {
  await assert.rejects(adapter(new Error('secret upstream detail credential-value')).verifier.verify('credential-value'), invalid);
});

test('official library verifies real RSA signatures/audience/issuer/expiry offline with injected public certificate', async () => {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const verifier = new GoogleTokenVerifier({ get: (key) => key === 'GOOGLE_AUTH_ENABLED' ? true : clientId });
  verifier.client.getFederatedSignonCertsAsync = async () => ({ certs: { fixture: publicKey.export({ type: 'spki', format: 'pem' }) }, format: 'PEM' });
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const jwt = (patch = {}) => {
    const content = `${encode({ alg: 'RS256', kid: 'fixture' })}.${encode({ ...valid, iat: Math.floor(Date.now() / 1000) - 30, ...patch })}`;
    return `${content}.${sign('RSA-SHA256', Buffer.from(content), privateKey).toString('base64url')}`;
  };
  assert.equal((await verifier.verify(jwt())).subject, valid.sub);
  const token = jwt(), parts = token.split('.');
  parts[1] = encode({ ...valid, sub: 'tampered' });
  await assert.rejects(verifier.verify(parts.join('.')), invalid);
  for (const patch of [{ aud: 'foreign' }, { iss: 'https://evil.test' }, { exp: Math.floor(Date.now() / 1000) - 600 }]) {
    await assert.rejects(verifier.verify(jwt(patch)), invalid);
  }
});
test('required claims, expiration, issuer, audience, verification and invalid profiles are rejected', async () => {
  for (const patch of [
    { sub: undefined }, { sub: '' }, { sub: ' bad ' }, { sub: 'x'.repeat(256) },
    { email: undefined }, { email: 'invalid' }, { email_verified: false }, { email_verified: 'true' },
    { aud: 'other' }, { aud: [clientId] }, { iss: 'https://evil.test' }, { exp: 1 }, { exp: undefined },
    { given_name: 42 }, { given_name: ' ' }, { given_name: 'x'.repeat(121) }, { family_name: null },
  ]) await assert.rejects(adapter({ ...valid, ...patch }).verifier.verify('credential-value'), invalid);
  await adapter({ ...valid, iss: 'accounts.google.com' }).verifier.verify('credential-value');
});
test('disabled Google or missing client ID does not contact provider', async () => {
  for (const config of [{ GOOGLE_AUTH_ENABLED: false }, { GOOGLE_AUTH_ENABLED: undefined }, { GOOGLE_CLIENT_ID: '' }]) {
    const a = adapter(valid, config); await assert.rejects(a.verifier.verify('credential-value'), { status: 503 }); assert.equal(a.calls(), 0);
  }
});
test('Google body is strict and never accepts user, tenant, identity, email or permission overrides', () => {
  assert.equal(parseGoogleCredential({ credential: 'token' }), 'token');
  for (const value of [undefined, {}, { credential: '' }, { credential: 'x'.repeat(8193) },
    ...['userId', 'role', 'institutionId', 'permissions', 'providerSubject', 'email'].map((key) => ({ credential: 'token', [key]: 'override' }))]) {
    assert.throws(() => parseGoogleCredential(value), { status: 400 });
  }
});
test('Google configuration requires explicit valid audience only when enabled, independently of Resend', () => {
  const base = { DATABASE_URL: 'postgresql://local@localhost/test', JWT_ACCESS_SECRET: 'a'.repeat(32), JWT_REFRESH_SECRET: 'b'.repeat(32) };
  assert.equal(validateEnvironment(base).GOOGLE_AUTH_ENABLED, false);
  const enabled = validateEnvironment({ ...base, GOOGLE_AUTH_ENABLED: 'true', GOOGLE_CLIENT_ID: clientId });
  assert.equal(enabled.GOOGLE_AUTH_ENABLED, true); assert.equal(enabled.EMAIL_DELIVERY_ENABLED, false);
  for (const GOOGLE_CLIENT_ID of [undefined, '', 'invalid-secret']) assert.throws(() => validateEnvironment({ ...base, GOOGLE_AUTH_ENABLED: 'true', GOOGLE_CLIENT_ID }),
    (error) => error.message.includes('GOOGLE_CLIENT_ID') && !error.message.includes('invalid-secret'));
  assert.throws(() => validateEnvironment({ ...base, GOOGLE_AUTH_ENABLED: 'yes' }));
});
