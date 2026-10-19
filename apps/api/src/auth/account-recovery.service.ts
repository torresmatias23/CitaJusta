import { randomUUID } from 'node:crypto';
import { BadRequestException, Injectable, InternalServerErrorException, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as argon2 from 'argon2';
import { z } from 'zod';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../database/prisma.service.js';
import { isTransactionConflict } from '../database/transaction-conflict.js';
import { AuditService } from '../audit/audit.service.js';
import { emailSchema, passwordSchema } from './schemas/auth.schemas.js';
import { AccountRecoveryCrypto, clearedDelivery, hasLocalCredential, recoveryTokenHash, recoveryTokenPattern } from './account-recovery.crypto.js';

const requestSchema = z.object({ email: emailSchema }).strict();
const resetSchema = z.object({ token: z.string().regex(recoveryTokenPattern), password: passwordSchema }).strict();
export const recoveryAcknowledgement = { message: 'Si la cuenta permite recuperación, recibirás instrucciones por correo.' } as const;
export function parseRecoveryRequest(value: unknown) {
  const result = requestSchema.safeParse(value);
  if (!result.success) throw new BadRequestException('Invalid recovery request');
  return result.data;
}
export function parseRecoveryReset(value: unknown) {
  const result = resetSchema.safeParse(value);
  if (!result.success) throw new BadRequestException('Invalid recovery request');
  return result.data;
}

@Injectable()
export class AccountRecoveryService {
  private readonly logger = new Logger(AccountRecoveryService.name);
  constructor(private readonly prisma: PrismaService, private readonly config: ConfigService, private readonly crypto: AccountRecoveryCrypto) {}

  async request(email: string) {
    this.requireEnabled();
    const normalized = email.trim().toLowerCase(), emailHmac = this.crypto.emailHmac(normalized);
    await this.transaction(async tx => {
      const now = new Date();
      const windowMs = this.config.getOrThrow<number>('ACCOUNT_RECOVERY_WINDOW_MINUTES') * 60_000;
      const intervalMs = this.config.getOrThrow<number>('ACCOUNT_RECOVERY_MIN_INTERVAL_SECONDS') * 1000;
      // Native upsert locks the persistent key, including for nonexistent accounts.
      const limit = await tx.accountRecoveryLimit.upsert({ where: { emailHmac },
        create: { emailHmac, windowStartedAt: now, requestCount: 0, lastAcceptedAt: new Date(now.getTime() - intervalMs), expiresAt: new Date(now.getTime() + windowMs) },
        update: { emailHmac } });
      const freshWindow = limit.expiresAt <= now;
      if (now.getTime() - limit.lastAcceptedAt.getTime() < intervalMs ||
        (!freshWindow && limit.requestCount >= this.config.getOrThrow<number>('ACCOUNT_RECOVERY_MAX_REQUESTS'))) return;
      await tx.accountRecoveryLimit.update({ where: { emailHmac }, data: {
        requestCount: freshWindow ? 1 : limit.requestCount + 1, lastAcceptedAt: now,
        ...(freshWindow ? { windowStartedAt: now, expiresAt: new Date(now.getTime() + windowMs) } : {}),
      } });
      const user = await tx.user.findUnique({ where: { email: normalized }, select: { id: true, passwordHash: true, status: true, deletedAt: true } });
      if (!user || user.status !== 'ACTIVE' || user.deletedAt !== null || !hasLocalCredential(user.passwordHash)) return;
      const id = randomUUID(), token = this.crypto.token();
      const expiresAt = new Date(now.getTime() + this.config.getOrThrow<number>('ACCOUNT_RECOVERY_TTL_MINUTES') * 60_000);
      const url = new URL('/restablecer-contrasena', this.config.getOrThrow<string>('ACCOUNT_RECOVERY_WEB_ORIGIN'));
      url.hash = `token=${token}`;
      // Freeze the complete provider payload once; retries use identical content and idempotency key.
      const encrypted = this.crypto.encrypt(id, { from: this.config.getOrThrow<string>('RESEND_FROM'), to: [normalized],
        subject: 'Restablece tu contraseña de CitaJusta',
        text: `Solicitaste restablecer tu contraseña de CitaJusta.\n${url.href}\nEl enlace vence a las ${expiresAt.toISOString()} y sólo puede usarse una vez. Si no lo solicitaste, ignora este correo.` });
      await tx.accountRecovery.updateMany({ where: { userId: user.id, consumedAt: null, invalidatedAt: null },
        data: { invalidatedAt: now, ...clearedDelivery, deliveryStatus: 'FAILED', claimToken: null, lockedUntil: null } });
      await tx.accountRecovery.create({ data: { id, userId: user.id, tokenHash: recoveryTokenHash(token), createdAt: now, expiresAt, nextAttemptAt: now, ...encrypted } });
      await AuditService.record(tx, { actorType: 'SYSTEM', actionCode: 'ACCOUNT_RECOVERY_REQUESTED', resourceType: 'AUTH', resourceId: user.id, outcome: 'SUCCESS' });
    });
    return recoveryAcknowledgement;
  }

  async reset(token: string, password: string) {
    this.requireEnabled();
    const tokenHash = recoveryTokenHash(token);
    // Avoid expensive password hashing for arbitrary invalid/expired input; revalidate everything inside the transaction.
    const candidate = await this.transaction(tx => tx.accountRecovery.findUnique({ where: { tokenHash }, select: { expiresAt: true, consumedAt: true, invalidatedAt: true } }));
    if (!candidate || candidate.consumedAt || candidate.invalidatedAt || candidate.expiresAt <= new Date()) throw this.invalidToken();
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 });
    await this.transaction(async tx => {
      const now = new Date();
      const recovery = await tx.accountRecovery.findUnique({ where: { tokenHash }, include: { user: true } });
      if (!recovery || recovery.consumedAt || recovery.invalidatedAt || recovery.expiresAt <= now ||
        recovery.user.status !== 'ACTIVE' || recovery.user.deletedAt !== null || !hasLocalCredential(recovery.user.passwordHash)) throw this.invalidToken();
      const consumed = await tx.accountRecovery.updateMany({ where: { id: recovery.id, consumedAt: null, invalidatedAt: null, expiresAt: { gt: now } },
        data: { consumedAt: now, ...clearedDelivery, claimToken: null, lockedUntil: null } });
      if (consumed.count !== 1) throw this.invalidToken();
      await tx.user.update({ where: { id: recovery.userId }, data: { passwordHash } });
      await tx.accountRecovery.updateMany({ where: { userId: recovery.userId, id: { not: recovery.id }, consumedAt: null, invalidatedAt: null },
        data: { invalidatedAt: now, ...clearedDelivery, deliveryStatus: 'FAILED', claimToken: null, lockedUntil: null } });
      await tx.authSession.updateMany({ where: { userId: recovery.userId, revokedAt: null }, data: { revokedAt: now } });
      await AuditService.record(tx, { actorUserId: recovery.userId, actorType: 'USER', actionCode: 'ACCOUNT_PASSWORD_RESET', resourceType: 'AUTH', outcome: 'SUCCESS' });
    });
    return { message: 'Contraseña restablecida. Inicia sesión nuevamente.' };
  }

  private requireEnabled() { if (!this.config.getOrThrow<boolean>('ACCOUNT_RECOVERY_ENABLED')) throw new ServiceUnavailableException('Account recovery unavailable'); }
  private invalidToken() { return new BadRequestException('Recovery link invalid or expired'); }
  private async transaction<T>(operation: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    for (let attempt = 0; attempt < 3; attempt++) {
      try { return await this.prisma.$transaction(operation, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }); }
      catch (error) {
        if (error instanceof BadRequestException) throw error;
        if (isTransactionConflict(error) && attempt < 2) continue;
        // Never log the error object: adapter/validation errors can include sensitive input.
        if (isTransactionConflict(error) || error instanceof Prisma.PrismaClientKnownRequestError || error instanceof Prisma.PrismaClientInitializationError) {
          this.logger.warn('Account recovery storage operation unavailable');
          throw new ServiceUnavailableException('Account recovery unavailable');
        }
        this.logger.error('Unexpected account recovery operation failure');
        throw new InternalServerErrorException('Account recovery unavailable');
      }
    }
    throw new ServiceUnavailableException('Account recovery unavailable');
  }
}
