import { Injectable, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OAuth2Client } from 'google-auth-library';
import { z } from 'zod';
import { emailSchema } from './schemas/auth.schemas.js';

const identitySchema = z.object({
  sub: z.string().min(1).max(255).refine((value) => value.trim() === value),
  email: emailSchema,
  email_verified: z.literal(true),
  aud: z.string(),
  iss: z.enum(['accounts.google.com', 'https://accounts.google.com']),
  exp: z.number().int().positive(),
  given_name: z.string().trim().min(1).max(120).optional(),
  family_name: z.string().trim().min(1).max(120).optional(),
});

export type GoogleIdentity = { subject: string; email: string; firstName?: string; lastName?: string };

@Injectable()
export class GoogleTokenVerifier {
  private readonly client = new OAuth2Client();
  constructor(private readonly config: ConfigService) {}

  async verify(credential: string): Promise<GoogleIdentity> {
    const audience = this.config.get<string>('GOOGLE_CLIENT_ID');
    if (this.config.get<boolean>('GOOGLE_AUTH_ENABLED') !== true || !audience) {
      throw new ServiceUnavailableException('Google authentication unavailable');
    }
    try {
      // The official adapter verifies signature, audience, issuer and token lifetime.
      const ticket = await this.client.verifyIdToken({ idToken: credential, audience });
      const claims = identitySchema.parse(ticket.getPayload());
      // Require an unexpired token even within the library's clock-skew tolerance.
      if (claims.aud !== audience || claims.exp <= Math.floor(Date.now() / 1000)) throw new Error();
      return { subject: claims.sub, email: claims.email,
        ...(claims.given_name ? { firstName: claims.given_name } : {}),
        ...(claims.family_name ? { lastName: claims.family_name } : {}) };
    } catch {
      throw new UnauthorizedException('Invalid Google credential');
    }
  }
}
