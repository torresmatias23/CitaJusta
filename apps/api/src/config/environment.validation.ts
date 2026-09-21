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
