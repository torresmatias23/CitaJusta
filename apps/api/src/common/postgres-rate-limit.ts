import { Prisma } from '../generated/prisma/client.js';
import type { PrismaService } from '../database/prisma.service.js';

export interface RateLimitDecision {
  allowed: boolean;
  retryAfterSeconds: number;
}

// Shared atomic counter only. Callers own identity/HMAC domains, policy and error handling.
export async function consumePostgresRateLimit(
  prisma: Pick<PrismaService, '$queryRaw'>,
  identifier: string,
  policy: { readonly requests: number; readonly windowSeconds: number },
): Promise<RateLimitDecision> {
  // PostgreSQL owns time and serialization across processes. Rejections never
  // extend the window; the limit+1 sentinel bounds rejected counters.
  const now = Prisma.sql`(statement_timestamp() AT TIME ZONE 'UTC')::timestamp(3)`;
  const rows = await prisma.$queryRaw<RateLimitDecision[]>(Prisma.sql`
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
}
