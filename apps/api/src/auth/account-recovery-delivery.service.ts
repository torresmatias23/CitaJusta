import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../database/prisma.service.js';
import { EmailProviderError, ResendClient, type EmailPayload } from '../notifications/resend.client.js';
import { AccountRecoveryCrypto, clearedDelivery, hasLocalCredential, RecoveryEnvelopeError } from './account-recovery.crypto.js';

@Injectable()
export class AccountRecoveryDeliveryService {
  constructor(private readonly prisma: PrismaService, private readonly config: ConfigService,
    private readonly crypto: AccountRecoveryCrypto, private readonly resend: ResendClient) {}

  // Retention needs neither provider credentials nor recovery encryption keys.
  async cleanupExpiredBatch(): Promise<void> {
    const now = new Date(), take = this.config.getOrThrow<number>('EMAIL_DELIVERY_BATCH_SIZE');
    const expired = await this.prisma.accountRecovery.findMany({ where: { expiresAt: { lte: now }, ciphertext: { not: null } }, select: { id: true }, take, orderBy: { expiresAt: 'asc' } });
    if (expired.length) await this.prisma.accountRecovery.updateMany({ where: { id: { in: expired.map(row => row.id) }, expiresAt: { lte: now }, ciphertext: { not: null } },
      data: { ...clearedDelivery, deliveryStatus: 'FAILED', claimToken: null, lockedUntil: null, lastErrorCode: 'EMAIL_RECOVERY_EXPIRED' } });
    // Bounded retention cleanup, only after both the window and cooldown have elapsed.
    const old = { expiresAt: { lt: now }, lastAcceptedAt: { lt: new Date(now.getTime() - this.config.getOrThrow<number>('ACCOUNT_RECOVERY_MIN_INTERVAL_SECONDS') * 1000) } };
    const limits = await this.prisma.accountRecoveryLimit.findMany({ where: old, select: { emailHmac: true }, take, orderBy: { expiresAt: 'asc' } });
    if (limits.length) await this.prisma.accountRecoveryLimit.deleteMany({ where: { ...old, emailHmac: { in: limits.map(row => row.emailHmac) } } });
  }

  async processBatch(): Promise<void> {
    if (!this.config.getOrThrow<boolean>('ACCOUNT_RECOVERY_ENABLED') || !this.config.getOrThrow<boolean>('EMAIL_DELIVERY_ENABLED')) return;
    const now = new Date(), take = this.config.getOrThrow<number>('EMAIL_DELIVERY_BATCH_SIZE');
    const rows = await this.prisma.accountRecovery.findMany({ where: { consumedAt: null, invalidatedAt: null, expiresAt: { gt: now },
      OR: [{ deliveryStatus: 'PENDING', nextAttemptAt: { lte: now } }, { deliveryStatus: 'PROCESSING', lockedUntil: { lte: now } }] },
      select: { id: true }, take, orderBy: [{ nextAttemptAt: 'asc' }, { id: 'asc' }] });
    for (const row of rows) await this.deliver(row.id);
  }

  async deliver(id: string): Promise<void> {
    if (!this.config.getOrThrow<boolean>('ACCOUNT_RECOVERY_ENABLED') || !this.config.getOrThrow<boolean>('EMAIL_DELIVERY_ENABLED')) return;
    const now = new Date(), claimToken = randomUUID();
    const ownership = { id, claimToken, deliveryStatus: 'PROCESSING' as const };
    const claim = await this.prisma.accountRecovery.updateMany({ where: { id, consumedAt: null, invalidatedAt: null, expiresAt: { gt: now },
      OR: [{ deliveryStatus: 'PENDING', nextAttemptAt: { lte: now } }, { deliveryStatus: 'PROCESSING', lockedUntil: { lte: now } }] },
      data: { deliveryStatus: 'PROCESSING', claimToken, lockedUntil: new Date(now.getTime() + this.config.getOrThrow<number>('EMAIL_DELIVERY_LEASE_MS')), attemptCount: { increment: 1 } } });
    if (claim.count !== 1) return;
    const row = await this.prisma.accountRecovery.findUniqueOrThrow({ where: { id }, include: { user: true } });
    const fail = async (code: string, retryable: boolean) => {
      const nextAttemptAt = new Date(Date.now() + Math.min(3_600_000, 30_000 * 2 ** Math.min(row.attemptCount - 1, 10)));
      const retry = retryable && row.attemptCount < this.config.getOrThrow<number>('EMAIL_DELIVERY_MAX_ATTEMPTS') && nextAttemptAt < row.expiresAt;
      await this.prisma.accountRecovery.updateMany({ where: ownership, data: { deliveryStatus: retry ? 'PENDING' : 'FAILED',
        lastErrorCode: code, nextAttemptAt, claimToken: null, lockedUntil: null, ...(!retry ? clearedDelivery : {}) } });
    };
    if (row.claimToken !== claimToken) return;
    if (row.consumedAt || row.invalidatedAt || row.expiresAt <= new Date() || row.user.status !== 'ACTIVE' || row.user.deletedAt || !hasLocalCredential(row.user.passwordHash)) {
      await fail('EMAIL_RECOVERY_INACTIVE', false); return;
    }
    if (row.attemptCount > this.config.getOrThrow<number>('EMAIL_DELIVERY_MAX_ATTEMPTS') || Date.now() - row.createdAt.getTime() >= 86_400_000) {
      await fail('EMAIL_RETRY_WINDOW_CLOSED', false); return;
    }
    let payload: EmailPayload;
    try { payload = this.crypto.decrypt(id, row); }
    catch (error) {
      if (!(error instanceof RecoveryEnvelopeError)) throw error;
      await fail('EMAIL_ENVELOPE_INVALID', false); return;
    }
    if (payload.to[0] !== row.user.email) { await fail('EMAIL_RECIPIENT_CHANGED', false); return; }
    // Recheck and renew immediately before sending. No transaction is held over HTTP.
    const ready = await this.prisma.accountRecovery.updateMany({ where: { ...ownership, lockedUntil: { gt: new Date() }, consumedAt: null, invalidatedAt: null, expiresAt: { gt: new Date() } },
      data: { lockedUntil: new Date(Date.now() + this.config.getOrThrow<number>('EMAIL_DELIVERY_LEASE_MS')) } });
    if (ready.count !== 1) return;
    let providerMessageId: string;
    try {
      providerMessageId = await this.resend.send(id, payload, this.config.getOrThrow<string>('RESEND_API_KEY'), this.config.getOrThrow<number>('EMAIL_DELIVERY_REQUEST_TIMEOUT_MS'));
    } catch (error) {
      if (error instanceof EmailProviderError) { await fail(error.code, error.retryable); return; }
      await fail('EMAIL_INTERNAL_ERROR', false);
      throw error;
    }
    // A DB failure after provider success retains the lease/envelope for an idempotent retry.
    await this.prisma.accountRecovery.updateMany({ where: ownership, data: { deliveryStatus: 'SENT', providerMessageId, ...clearedDelivery, claimToken: null, lockedUntil: null, lastErrorCode: null } });
  }
}
