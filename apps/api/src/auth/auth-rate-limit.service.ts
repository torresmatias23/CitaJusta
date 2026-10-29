import { createHmac } from 'node:crypto';
import { isIP } from 'node:net';
import { Injectable, InternalServerErrorException, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../database/prisma.service.js';
import { Prisma } from '../generated/prisma/client.js';
import { authRateLimitPolicies, type AuthRateLimitOperation } from './auth-rate-limit.policy.js';

export interface AuthRateLimitDecision {
  allowed: boolean;
  retryAfterSeconds: number;
}

// Only the TCP peer is supplied by the guard, never an HTTP header or user ID.
export function authRateLimitNetwork(address: string | undefined): string {
  if (!address || !isIP(address)) throw new InternalServerErrorException('Authentication unavailable');
  if (isIP(address) === 4) return address;

  // URL canonicalizes IPv6 (including dotted IPv4 tails); group native IPv6 by /64.
  const canonical = new URL(`http://[${address.split('%')[0]}]/`).hostname.slice(1, -1);
  const [left, right] = canonical.split('::');
  const head = left ? left.split(':') : [];
  const tail = right ? right.split(':') : [];
  const words = right === undefined ? head : [...head, ...Array<string>(8 - head.length - tail.length).fill('0'), ...tail];
  const numbers = words.map(word => Number.parseInt(word, 16));
  if (numbers.slice(0, 5).every(word => word === 0) && numbers[5] === 0xffff) {
    return [numbers[6] >> 8, numbers[6] & 255, numbers[7] >> 8, numbers[7] & 255].join('.');
  }
  return `${numbers.slice(0, 4).map(word => word.toString(16)).join(':')}::/64`;
}

@Injectable()
export class AuthRateLimitService {
  private readonly logger = new Logger(AuthRateLimitService.name);
  private readonly key: Buffer;

  constructor(private readonly prisma: PrismaService, config: ConfigService) {
    // Domain-separated subkey; no new secret or dependency on enabled email recovery.
    this.key = createHmac('sha256', config.getOrThrow<string>('JWT_ACCESS_SECRET'))
      .update('citajusta/auth-rate-limit/key/v1').digest();
  }

  async consume(operation: AuthRateLimitOperation, address: string | undefined): Promise<AuthRateLimitDecision> {
    const policy = authRateLimitPolicies[operation];
    const identifier = createHmac('sha256', this.key)
      .update(JSON.stringify(['citajusta/auth-rate-limit/v1', operation, authRateLimitNetwork(address)]))
      .digest('hex');
    try {
      // One atomic upsert on the existing unique key. PostgreSQL owns time and
      // serialization across processes. Rejections never extend the window.
      // The limit+1 sentinel keeps rejected counters bounded without admitting again.
      // Match the existing timestamp(3) columns, including Retry-After rounding.
      const now = Prisma.sql`(statement_timestamp() AT TIME ZONE 'UTC')::timestamp(3)`;
      const rows = await this.prisma.$queryRaw<AuthRateLimitDecision[]>(Prisma.sql`
        INSERT INTO "limites_recuperacion_cuenta" AS counter
          ("email_hmac", "ventana_inicio_at", "solicitudes", "ultima_admitida_at", "expira_at")
        VALUES (${identifier}, ${now}, 1, ${now},
          ${now} + ${policy.windowSeconds} * interval '1 second')
        ON CONFLICT ("email_hmac") DO UPDATE SET
          "solicitudes" = CASE
            WHEN counter."expira_at" <= ${now} THEN 1
            ELSE LEAST(counter."solicitudes" + 1, ${policy.requests + 1}) END,
          "ventana_inicio_at" = CASE
            WHEN counter."expira_at" <= ${now}
            THEN ${now} ELSE counter."ventana_inicio_at" END,
          "expira_at" = CASE
            WHEN counter."expira_at" <= ${now}
            THEN ${now} + ${policy.windowSeconds} * interval '1 second'
            ELSE counter."expira_at" END,
          "ultima_admitida_at" = CASE
            WHEN counter."expira_at" <= ${now} OR counter."solicitudes" < ${policy.requests}
            THEN ${now} ELSE counter."ultima_admitida_at" END
        RETURNING "solicitudes" <= ${policy.requests} AS "allowed",
          GREATEST(1, CEIL(EXTRACT(EPOCH FROM ("expira_at" - ${now}))))::integer AS "retryAfterSeconds"
      `);
      const decision = rows[0];
      if (rows.length !== 1 || !decision || typeof decision.allowed !== 'boolean' ||
        !Number.isInteger(decision.retryAfterSeconds) || decision.retryAfterSeconds < 1) {
        throw new Error('Invalid rate limit storage result');
      }
      return decision;
    } catch (error) {
      // Never log adapter errors, identifiers, bodies, passwords or tokens.
      this.logger.error('Authentication rate limit storage unavailable');
      if (error instanceof Prisma.PrismaClientKnownRequestError || error instanceof Prisma.PrismaClientInitializationError) {
        throw new ServiceUnavailableException('Authentication unavailable');
      }
      throw new InternalServerErrorException('Authentication unavailable');
    }
  }
}
