import { z } from 'zod';

function isPostgresqlUrl(value: string): boolean {
  try {
    const url = new URL(value);

    return (
      (url.protocol === 'postgresql:' || url.protocol === 'postgres:') &&
      url.hostname.length > 0 &&
      url.pathname.length > 1
    );
  } catch {
    return false;
  }
}

const environmentSchema = z
  .object({
    NODE_ENV: z
      .enum(['development', 'test', 'production'])
      .default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    WAITLIST_OFFER_TTL_MINUTES: z.coerce.number().int().positive().default(10),
    OFFER_EXPIRATION_ENABLED: z.enum(['true', 'false']).transform((value) => value === 'true').optional(),
    OFFER_EXPIRATION_INTERVAL_MS: z.coerce.number().int().positive().max(2_147_483_647).default(30_000),
    OFFER_EXPIRATION_BATCH_SIZE: z.coerce.number().int().positive().max(1000).default(50),
    EMAIL_DELIVERY_ENABLED: z.enum(['true', 'false']).default('false').transform((value) => value === 'true'),
    EMAIL_DELIVERY_INTERVAL_MS: z.coerce.number().int().min(1000).max(300_000).default(30_000),
    EMAIL_DELIVERY_BATCH_SIZE: z.coerce.number().int().min(1).max(100).default(10),
    EMAIL_DELIVERY_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(5),
    EMAIL_DELIVERY_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(100).max(30_000).default(10_000),
    EMAIL_DELIVERY_LEASE_MS: z.coerce.number().int().min(5000).max(300_000).default(60_000),
    RESEND_API_KEY: z.string().optional(),
    RESEND_FROM: z.string().optional(),
    DATABASE_URL: z.string().refine(isPostgresqlUrl, {
      message: 'must be a valid PostgreSQL URL',
    }),
    JWT_ACCESS_SECRET: z
      .string()
      .min(32, 'must contain at least 32 characters'),
    JWT_REFRESH_SECRET: z
      .string()
      .min(32, 'must contain at least 32 characters'),
    JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().positive().default(900),
    JWT_REFRESH_TTL_SECONDS: z.coerce
      .number()
      .int()
      .positive()
      .default(2_592_000),
  })
  .superRefine((environment, context) => {
    if (environment.EMAIL_DELIVERY_LEASE_MS < environment.EMAIL_DELIVERY_REQUEST_TIMEOUT_MS + 5000) {
      context.addIssue({ code: 'custom', path: ['EMAIL_DELIVERY_LEASE_MS'], message: 'must exceed request timeout by at least 5000 ms' });
    }
    if (environment.EMAIL_DELIVERY_ENABLED) {
      if (!/^re_[A-Za-z0-9_-]{10,200}$/.test(environment.RESEND_API_KEY ?? '')) {
        context.addIssue({ code: 'custom', path: ['RESEND_API_KEY'], message: 'must be a valid sending API key when email is enabled' });
      }
      if (!isEmailSender(environment.RESEND_FROM ?? '')) {
        context.addIssue({ code: 'custom', path: ['RESEND_FROM'], message: 'must be a valid sender when email is enabled' });
      }
    }
    if (environment.JWT_ACCESS_SECRET === environment.JWT_REFRESH_SECRET) {
      context.addIssue({
        code: 'custom',
        path: ['JWT_REFRESH_SECRET'],
        message: 'must differ from JWT_ACCESS_SECRET',
      });
    }
  }).transform((environment) => ({ ...environment,
    OFFER_EXPIRATION_ENABLED: environment.OFFER_EXPIRATION_ENABLED ?? environment.NODE_ENV !== 'test',
  }));

export type Environment = z.infer<typeof environmentSchema>;

export function isEmailSender(value: string): boolean {
  if (/[\r\n]/.test(value) || value.length > 320) return false;
  const match = /^([^<>]+) <([^<>]+)>$/.exec(value);
  return z.email().safeParse(match ? match[2] : value).success;
}

export function validateEnvironment(
  config: Record<string, unknown>,
): Environment {
  const result = environmentSchema.safeParse(config);

  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');

    throw new Error(`Invalid environment configuration: ${details}`);
  }

  return result.data;
}
