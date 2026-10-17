import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { loadEmailLogo, emailLogoAttachmentSchema } from '../dist/notifications/email-logo.js';

test('logo resolves after build independently of cwd and preserves every original PNG byte', () => {
  let location;
  const attachment = loadEmailLogo((path) => { location = path; return readFileSync(path); });
  assert.equal(location.href, new URL('../assets/logo-citajusta.png', import.meta.url).href);
  const original = readFileSync(new URL('../../web/public/images/logo-citajusta.png', import.meta.url));
  assert.deepEqual(Buffer.from(attachment.content, 'base64'), original);
  assert.ok(original.length <= 256 * 1024);
  assert.equal(attachment.filename, 'logo-citajusta.png');
  assert.equal(attachment.content_type, 'image/png');
  assert.equal(attachment.content_id, 'citajusta-logo');
  assert.deepEqual(emailLogoAttachmentSchema.parse(attachment), attachment);
});

test('missing asset permits text branding fallback; other filesystem failures are not hidden', () => {
  assert.equal(loadEmailLogo(() => { throw Object.assign(new Error('not found'), { code: 'ENOENT' }); }), undefined);
  const denied = Object.assign(new Error('access denied'), { code: 'EACCES' });
  assert.throws(() => loadEmailLogo(() => { throw denied; }), (error) => error === denied);
});

test('invalid and oversized static logo cannot enter the outbound payload', () => {
  for (const bytes of [Buffer.from('not a PNG'), Buffer.alloc(256 * 1024 + 1)]) {
    assert.throws(() => loadEmailLogo(() => bytes), /Invalid static email logo/);
  }
});

test('CID contract is REST snake_case, bounded canonical Base64, no remote path or extra fields', () => {
  const valid = loadEmailLogo();
  for (const value of [
    { ...valid, content_id: undefined, contentId: 'citajusta-logo' },
    { ...valid, content_type: 'text/html' },
    { ...valid, filename: '../logo.png' },
    { ...valid, path: 'https://external.example/logo.png' },
    { ...valid, content: 'invalid base64' },
    { ...valid, content: `${valid.content}\n` },
    { ...valid, content: Buffer.alloc(256 * 1024 + 1).toString('base64') },
  ]) assert.equal(emailLogoAttachmentSchema.safeParse(value).success, false);
});
