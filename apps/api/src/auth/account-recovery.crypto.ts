import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { emailPayloadSchema, type EmailPayload } from '../notifications/resend.client.js';

export const clearedDelivery = { ciphertext: null, keyId: null, nonce: null, authTag: null } as const;
export const recoveryTokenPattern = /^[A-Za-z0-9_-]{43}$/;
export function recoveryTokenHash(token: string): string { return createHash('sha256').update(token).digest('hex'); }
export function hasLocalCredential(hash: string | null): boolean {
  // Reject technical sentinels and Google-only identities, not just SQL NULL.
  const match = hash === null ? null : /^\$argon2id\$v=19\$([^$]+)\$[A-Za-z0-9+/]+\$[A-Za-z0-9+/]+$/.exec(hash);
  if (!match) return false;
  const parameters = match[1].split(',');
  return parameters.length === 3 && ['m', 't', 'p'].every(key => parameters.filter(value => new RegExp(`^${key}=[1-9][0-9]*$`).test(value)).length === 1);
}
type Envelope = { ciphertext: Uint8Array | null; nonce: Uint8Array | null; authTag: Uint8Array | null; keyId: string | null };
export class RecoveryEnvelopeError extends Error {
  constructor() { super('Recovery delivery envelope unavailable'); }
}

@Injectable()
export class AccountRecoveryCrypto {
  constructor(private readonly config: ConfigService) {}

  emailHmac(email: string): string {
    return createHmac('sha256', Buffer.from(this.config.getOrThrow<string>('ACCOUNT_RECOVERY_HMAC_KEY'), 'hex'))
      .update(email.trim().toLowerCase()).digest('hex');
  }
  token(): string { return randomBytes(32).toString('base64url'); }
  encrypt(id: string, payload: EmailPayload) {
    const nonce = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key(), nonce);
    cipher.setAAD(Buffer.from(`citajusta/account-recovery/v1/${id}`));
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify(emailPayloadSchema.parse(payload)), 'utf8'), cipher.final()]);
    return { ciphertext, nonce, authTag: cipher.getAuthTag(), keyId: this.config.getOrThrow<string>('ACCOUNT_RECOVERY_KEY_ID') };
  }
  decrypt(id: string, envelope: Envelope): EmailPayload {
    try {
      if (!envelope.ciphertext || !envelope.nonce || !envelope.authTag || envelope.keyId !== this.config.getOrThrow<string>('ACCOUNT_RECOVERY_KEY_ID')) throw new Error();
      const decipher = createDecipheriv('aes-256-gcm', this.key(), envelope.nonce);
      decipher.setAAD(Buffer.from(`citajusta/account-recovery/v1/${id}`));
      decipher.setAuthTag(Buffer.from(envelope.authTag));
      const plain = Buffer.concat([decipher.update(envelope.ciphertext), decipher.final()]);
      return emailPayloadSchema.parse(JSON.parse(plain.toString('utf8')) as unknown);
    } catch { throw new RecoveryEnvelopeError(); }
  }
  private key(): Buffer { return Buffer.from(this.config.getOrThrow<string>('ACCOUNT_RECOVERY_ENCRYPTION_KEY'), 'hex'); }
}
