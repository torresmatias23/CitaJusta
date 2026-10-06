import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { z } from 'zod';
import { PrismaService } from '../database/prisma.service.js';
import { notificationContent, notificationContentSchema } from './notification-content.js';
import { EmailProviderError, emailEligibleTypes, emailPayloadSchema, ResendClient, type EmailPayload } from './resend.client.js';

@Injectable()
export class EmailDeliveryService {
  constructor(private readonly prisma: PrismaService, private readonly config: ConfigService, private readonly resend: ResendClient) {}

  async processBatch(): Promise<void> {
    if (!this.config.getOrThrow<boolean>('EMAIL_DELIVERY_ENABLED')) return;
    const now = new Date();
    const rows = await this.prisma.notificationEmailDelivery.findMany({
      where: { OR: [
        { status: 'PENDING', nextAttemptAt: { lte: now } },
        { status: 'PROCESSING', lockedUntil: { lte: now } },
      ] },
      orderBy: [{ nextAttemptAt: 'asc' }, { id: 'asc' }],
      take: this.config.getOrThrow<number>('EMAIL_DELIVERY_BATCH_SIZE'), select: { id: true },
    });
    for (const row of rows) await this.deliver(row.id);
  }

  private async deliver(id: string): Promise<void> {
    const now = new Date(), claimToken = randomUUID();
    const claim = await this.prisma.notificationEmailDelivery.updateMany({
      where: { id, OR: [
        { status: 'PENDING', nextAttemptAt: { lte: now } },
        { status: 'PROCESSING', lockedUntil: { lte: now } },
      ] },
      data: { status: 'PROCESSING', claimToken, lockedUntil: new Date(+now + this.config.getOrThrow<number>('EMAIL_DELIVERY_LEASE_MS')),
        lastAttemptAt: now, attemptCount: { increment: 1 } },
    });
    if (claim.count !== 1) return;
    const ownership = { id, status: 'PROCESSING' as const, claimToken };
    const row = await this.prisma.notificationEmailDelivery.findUniqueOrThrow({
      where: { id }, include: { notification: { include: { recipient: { select: { email: true, status: true, deletedAt: true } } } } },
    });
    // A resumed worker must never use another worker's claim/payload.
    if (row.claimToken !== claimToken) return;
    const finishFailure = async (code: string, retryable: boolean) => {
      const retry = retryable && row.attemptCount < this.config.getOrThrow<number>('EMAIL_DELIVERY_MAX_ATTEMPTS');
      await this.prisma.notificationEmailDelivery.updateMany({ where: ownership,
        data: { status: retry ? 'PENDING' : 'FAILED', claimToken: null, lockedUntil: null, lastErrorCode: code,
          ...(retry ? { nextAttemptAt: new Date(Date.now() + Math.min(3_600_000, 30_000 * 2 ** (row.attemptCount - 1))) } : {}) },
      });
    };
    if (row.attemptCount > this.config.getOrThrow<number>('EMAIL_DELIVERY_MAX_ATTEMPTS')) {
      await finishFailure('EMAIL_MAX_ATTEMPTS', false); return;
    }
    // Never automatically retry uncertain delivery after the provider's 24-hour retention.
    if (row.firstAttemptAt && Date.now() - +row.firstAttemptAt >= 86_400_000) {
      await finishFailure('EMAIL_IDEMPOTENCY_WINDOW_EXPIRED', false); return;
    }
    const notification = row.notification, recipient = notification.recipient;
    if (recipient.status !== 'ACTIVE' || recipient.deletedAt !== null || !z.email().safeParse(recipient.email).success) {
      await finishFailure('EMAIL_RECIPIENT_INVALID', false); return;
    }
    if (!emailEligibleTypes.has(notification.type)) { await finishFailure('EMAIL_EVENT_INELIGIBLE', false); return; }
    let payload: EmailPayload;
    if (row.payload !== null) {
      const parsed = emailPayloadSchema.safeParse(row.payload);
      if (!parsed.success) { await finishFailure('EMAIL_PAYLOAD_INVALID', false); return; }
      payload = parsed.data;
      if (payload.to[0] !== recipient.email) { await finishFailure('EMAIL_RECIPIENT_CHANGED', false); return; }
    } else {
      const content = notificationContentSchema.safeParse({ type: notification.type, data: notification.data });
      if (!content.success) { await finishFailure('EMAIL_CONTENT_INVALID', false); return; }
      const institution = notification.institutionId ? await this.prisma.institution.findUnique({
        where: { id: notification.institutionId }, select: { timeZone: true },
      }) : null;
      const rendered = notificationContent(content.data, institution?.timeZone ?? 'UTC');
      const parsed = emailPayloadSchema.safeParse({ from: this.config.get<string>('RESEND_FROM'), to: [recipient.email], subject: rendered.title, text: rendered.message });
      if (!parsed.success) { await finishFailure('EMAIL_CONFIGURATION_INVALID', false); return; }
      payload = parsed.data;
    }
    // Freeze and renew in one guarded DB operation; HTTP is not inside a transaction.
    const prepared = await this.prisma.notificationEmailDelivery.updateMany({
      where: { ...ownership, lockedUntil: { gt: new Date() } },
      data: { payload, firstAttemptAt: row.firstAttemptAt ?? new Date(),
        lockedUntil: new Date(Date.now() + this.config.getOrThrow<number>('EMAIL_DELIVERY_LEASE_MS')) },
    });
    if (prepared.count !== 1) return;
    let providerMessageId: string;
    try {
      providerMessageId = await this.resend.send(notification.id, payload,
        this.config.getOrThrow<string>('RESEND_API_KEY'), this.config.getOrThrow<number>('EMAIL_DELIVERY_REQUEST_TIMEOUT_MS'));
    } catch (error) {
      if (error instanceof EmailProviderError) { await finishFailure(error.code, error.retryable); return; }
      await finishFailure('EMAIL_INTERNAL_ERROR', false);
      throw error; // Runner logs only a constant; never reclassifies arbitrary errors.
    }
    await this.prisma.notificationEmailDelivery.updateMany({ where: ownership,
      data: { status: 'SENT', providerMessageId, sentAt: new Date(), lastErrorCode: null, claimToken: null, lockedUntil: null },
    });
  }
}
