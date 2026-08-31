import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';

const emailSchema = z
  .string()
  .trim()
  .email()
  .max(254)
  .transform((email) => email.toLowerCase());

const passwordSchema = z.string().min(12).max(128);

const registerSchema = z
  .object({
    email: emailSchema,
    password: passwordSchema,
    firstName: z.string().trim().min(1).max(120),
    lastName: z.string().trim().min(1).max(120),
  })
  .strict();

const loginSchema = z
  .object({
    email: emailSchema,
    password: z.string().min(1).max(128),
  })
  .strict();

const refreshTokenSchema = z
  .object({
    refreshToken: z.string().min(1).max(4096),
  })
  .strict();

const refreshTokenClaimsSchema = z.object({
  sub: z.string().uuid(),
  sid: z.string().uuid(),
  jti: z.string().uuid(),
});

const accessTokenClaimsSchema = z.object({
  sub: z.string().uuid(),
  sid: z.string().uuid(),
  exp: z.number().int().positive(),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type RefreshTokenClaims = z.infer<typeof refreshTokenClaimsSchema>;
export type AccessTokenClaims = z.infer<typeof accessTokenClaimsSchema>;

function parseBody<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);

  if (!result.success) {
    throw new BadRequestException({
      message: 'Invalid request body',
      errors: result.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    });
  }

  return result.data;
}

export function parseRegisterInput(value: unknown): RegisterInput {
  return parseBody(registerSchema, value);
}

export function parseLoginInput(value: unknown): LoginInput {
  return parseBody(loginSchema, value);
}

export function parseRefreshToken(value: unknown): string {
  return parseBody(refreshTokenSchema, value).refreshToken;
}

export function parseRefreshTokenClaims(
  value: unknown,
): RefreshTokenClaims {
  return refreshTokenClaimsSchema.parse(value);
}

export function parseAccessTokenClaims(value: unknown): AccessTokenClaims {
  return accessTokenClaimsSchema.parse(value);
}
