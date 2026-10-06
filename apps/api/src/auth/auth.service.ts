import { AuditService } from '../audit/audit.service.js';
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import {
  ConflictException,
  Injectable,
  UnauthorizedException,
  BadRequestException,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { Prisma, UserStatus } from '../generated/prisma/client.js';
import { isTransactionConflict } from '../database/transaction-conflict.js';
import { GoogleTokenVerifier, type GoogleIdentity } from './google-token.verifier.js';
import { PrismaService } from '../database/prisma.service.js';
import {
  parseRefreshTokenClaims,
  type LoginInput,
  type RefreshTokenClaims,
  type RegisterInput,
} from './schemas/auth.schemas.js';

const PASSWORD_HASH_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

const INVALID_PASSWORD_HASH = argon2.hash(
  'citajusta-invalid-password-placeholder',
  PASSWORD_HASH_OPTIONS,
);

export interface RegisteredUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  status: UserStatus;
}

export interface AuthTokenPair {
  accessToken: string;
  refreshToken: string;
  tokenType: 'Bearer';
  accessTokenExpiresIn: number;
  refreshTokenExpiresIn: number;
}

@Injectable()
export class AuthService {
  private readonly accessSecret: string;
  private readonly refreshSecret: string;
  private readonly accessTtlSeconds: number;
  private readonly refreshTtlSeconds: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    configService: ConfigService,
    @Optional() private readonly googleVerifier?: GoogleTokenVerifier,
  ) {
    this.accessSecret =
      configService.getOrThrow<string>('JWT_ACCESS_SECRET');
    this.refreshSecret =
      configService.getOrThrow<string>('JWT_REFRESH_SECRET');
    this.accessTtlSeconds = configService.getOrThrow<number>(
      'JWT_ACCESS_TTL_SECONDS',
    );
    this.refreshTtlSeconds = configService.getOrThrow<number>(
      'JWT_REFRESH_TTL_SECONDS',
    );
  }

  async register(input: RegisterInput): Promise<RegisteredUser> {
    const email = input.email.trim().toLowerCase();
    const existingUser = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true },
    });

    if (existingUser) {
      throw new ConflictException('Email already registered');
    }

    const passwordHash = await argon2.hash(
      input.password,
      PASSWORD_HASH_OPTIONS,
    );

    try {
      const user = await this.prisma.user.create({
        data: {
          id: randomUUID(),
          email,
          passwordHash,
          firstNames: input.firstName,
          lastNames: input.lastName,
          status: UserStatus.ACTIVE,
        },
        select: {
          id: true,
          email: true,
          firstNames: true,
          lastNames: true,
          status: true,
        },
      });

      return {
        id: user.id,
        email: user.email,
        firstName: user.firstNames,
        lastName: user.lastNames,
        status: user.status,
      };
    } catch (error) {
      if (this.isUniqueConstraintError(error)) {
        throw new ConflictException('Email already registered');
      }

      throw error;
    }
  }

  async login(input: LoginInput): Promise<AuthTokenPair> {
    const email = input.email.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({
      where: { email },
      select: {
        id: true,
        passwordHash: true,
        status: true,
        deletedAt: true,
      },
    });

    const passwordHash = user?.passwordHash ?? (await INVALID_PASSWORD_HASH);
    const passwordMatches = await this.verifyPassword(
      passwordHash,
      input.password,
    );

    if (
      !user ||
      !user.passwordHash ||
      !passwordMatches ||
      user.status !== UserStatus.ACTIVE ||
      user.deletedAt !== null
    ) {
      // Do not identify an unverified actor or let an audit outage change invalid credentials to 500.
      try {
        await AuditService.record(this.prisma, { actorType: 'USER', actionCode: 'AUTH_LOGIN_FAILURE',
          resourceType: 'AUTH', outcome: 'FAILURE', reasonCode: 'INVALID_CREDENTIALS' });
      } catch { /* Invalid credentials retain their existing contract. */ }
      throw this.invalidCredentials();
    }

    return this.prisma.$transaction((transaction) => this.createSession(transaction, user.id));
  }

  private async createSession(transaction: Prisma.TransactionClient, userId: string): Promise<AuthTokenPair> {
    const sessionId = randomUUID();
    const now = new Date();
    const expiresAt = new Date(
      now.getTime() + this.refreshTtlSeconds * 1_000,
    );
    const tokens = await this.issueTokenPair(
      userId,
      sessionId,
      this.refreshTtlSeconds,
    );

    await transaction.authSession.create({
      data: {
        id: sessionId,
        userId,
        refreshTokenHash: this.hashRefreshToken(tokens.refreshToken),
        expiresAt,
      },
    });

    await transaction.user.update({
      where: { id: userId },
      data: { lastLoginAt: now },
    });
    await AuditService.record(transaction, { actorUserId: userId, actorType: 'USER',
      actionCode: 'AUTH_LOGIN_SUCCESS', resourceType: 'AUTH', outcome: 'SUCCESS' });

    return tokens;
  }

  async loginGoogle(credential: string): Promise<AuthTokenPair> {
    let identity: GoogleIdentity;
    try { identity = await this.verifyGoogle(credential); }
    catch (error) {
      if (error instanceof UnauthorizedException) {
        try {
          await AuditService.record(this.prisma, { actorType: 'USER', actionCode: 'AUTH_LOGIN_FAILURE',
            resourceType: 'AUTH', outcome: 'FAILURE', reasonCode: 'INVALID_CREDENTIALS' });
        } catch { /* Verification errors remain sanitized during audit outages. */ }
      }
      throw error;
    }
    return this.googleTransaction(async (tx) => {
      const existing = await tx.externalIdentity.findUnique({
        where: { provider_providerSubject: { provider: 'GOOGLE', providerSubject: identity.subject } },
        select: { user: { select: { id: true, status: true, deletedAt: true } } },
      });
      if (existing) {
        this.requireActive(existing.user);
        return this.createSession(tx, existing.user.id);
      }
      if (await tx.user.findUnique({ where: { email: identity.email }, select: { id: true } })) {
        throw new ConflictException({ code: 'GOOGLE_ACCOUNT_LINK_REQUIRED', message: 'Sign in locally and link Google first' });
      }
      if (!identity.firstName || !identity.lastName) {
        throw new BadRequestException({ code: 'GOOGLE_PROFILE_REQUIRED', message: 'Google profile requires given and family names' });
      }
      const user = await tx.user.create({ data: {
        id: randomUUID(), email: identity.email, passwordHash: null,
        firstNames: identity.firstName, lastNames: identity.lastName,
        status: UserStatus.ACTIVE, emailVerifiedAt: new Date(),
      }, select: { id: true } });
      await tx.externalIdentity.create({ data: { id: randomUUID(), userId: user.id,
        provider: 'GOOGLE', providerSubject: identity.subject }, select: { id: true } });
      return this.createSession(tx, user.id);
    });
  }

  async linkGoogle(userId: string, credential: string): Promise<void> {
    const identity = await this.verifyGoogle(credential);
    await this.googleTransaction(async (tx) => {
      const user = await tx.user.findUnique({ where: { id: userId },
        select: { id: true, email: true, status: true, deletedAt: true } });
      this.requireActive(user);
      if (!user || user.email.trim().toLowerCase() !== identity.email) {
        throw new ConflictException({ code: 'GOOGLE_IDENTITY_CONFLICT', message: 'Google identity cannot be linked' });
      }
      const subject = await tx.externalIdentity.findUnique({
        where: { provider_providerSubject: { provider: 'GOOGLE', providerSubject: identity.subject } },
        select: { userId: true },
      });
      if (subject) {
        if (subject.userId === userId) return;
        throw new ConflictException({ code: 'GOOGLE_IDENTITY_CONFLICT', message: 'Google identity cannot be linked' });
      }
      if (await tx.externalIdentity.findUnique({ where: { userId_provider: { userId, provider: 'GOOGLE' } }, select: { id: true } })) {
        throw new ConflictException({ code: 'GOOGLE_IDENTITY_CONFLICT', message: 'Google identity cannot be linked' });
      }
      await tx.externalIdentity.create({ data: { id: randomUUID(), userId, provider: 'GOOGLE', providerSubject: identity.subject }, select: { id: true } });
      await AuditService.record(tx, { actorUserId: userId, actorType: 'USER',
        actionCode: 'AUTH_GOOGLE_LINKED', resourceType: 'AUTH', outcome: 'SUCCESS' });
    });
  }

  private requireActive(user: { status: UserStatus; deletedAt: Date | null } | null): void {
    if (!user || user.status !== UserStatus.ACTIVE || user.deletedAt !== null) throw this.invalidCredentials();
  }

  private verifyGoogle(credential: string): Promise<GoogleIdentity> {
    if (!this.googleVerifier) throw new ServiceUnavailableException('Google authentication unavailable');
    return this.googleVerifier.verify(credential);
  }

  private async googleTransaction<T>(work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try { return await this.prisma.$transaction(work, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }); }
      catch (error) {
        const retryable = isTransactionConflict(error) || this.isGoogleUniqueConflict(error);
        if (!retryable) throw error;
        if (attempt < 2) continue;
        throw new ConflictException({ code: 'GOOGLE_IDENTITY_CONFLICT', message: 'Google identity operation conflicted; retry' });
      }
    }
  }

  private isGoogleUniqueConflict(error: unknown): boolean {
    if (!this.isUniqueConstraintError(error) || typeof error !== 'object' || error === null || !('meta' in error)) return false;
    const meta = error.meta;
    if (typeof meta !== 'object' || meta === null || !('target' in meta) || !Array.isArray(meta.target)) return false;
    const target = meta.target.join(',');
    return ['email', 'proveedor,sujeto_proveedor', 'usuario_id,proveedor'].includes(target);
  }

  async refresh(refreshToken: string): Promise<AuthTokenPair> {
    const claims = await this.verifyRefreshToken(refreshToken);
    const session = await this.prisma.authSession.findUnique({
      where: { id: claims.sid },
      select: {
        userId: true,
        refreshTokenHash: true,
        expiresAt: true,
        revokedAt: true,
        user: {
          select: {
            status: true,
            deletedAt: true,
          },
        },
      },
    });
    const now = new Date();

    if (
      !session ||
      session.userId !== claims.sub ||
      session.revokedAt !== null ||
      session.expiresAt <= now ||
      session.user.status !== UserStatus.ACTIVE ||
      session.user.deletedAt !== null ||
      !this.matchesRefreshTokenHash(
        refreshToken,
        session.refreshTokenHash,
      )
    ) {
      throw this.invalidRefreshToken();
    }

    const remainingRefreshSeconds = Math.floor(
      (session.expiresAt.getTime() - now.getTime()) / 1_000,
    );

    if (remainingRefreshSeconds <= 0) {
      throw this.invalidRefreshToken();
    }

    const tokens = await this.issueTokenPair(
      session.userId,
      claims.sid,
      remainingRefreshSeconds,
    );
    const rotated = await this.prisma.authSession.updateMany({
      where: {
        id: claims.sid,
        userId: claims.sub,
        refreshTokenHash: session.refreshTokenHash,
        revokedAt: null,
        expiresAt: { gt: now },
      },
      data: {
        refreshTokenHash: this.hashRefreshToken(tokens.refreshToken),
        lastUsedAt: now,
      },
    });

    if (rotated.count !== 1) {
      throw this.invalidRefreshToken();
    }

    return tokens;
  }

  async logout(refreshToken: string): Promise<void> {
    const claims = await this.verifyRefreshToken(refreshToken);
    const session = await this.prisma.authSession.findUnique({
      where: { id: claims.sid },
      select: {
        userId: true,
        refreshTokenHash: true,
        revokedAt: true,
      },
    });

    if (!session || session.userId !== claims.sub) {
      throw this.invalidRefreshToken();
    }

    if (session.revokedAt !== null) {
      return;
    }

    if (
      !this.matchesRefreshTokenHash(refreshToken, session.refreshTokenHash)
    ) {
      throw this.invalidRefreshToken();
    }

    await this.prisma.$transaction(async (tx) => {
      const revoked = await tx.authSession.updateMany({
        where: { id: claims.sid, userId: claims.sub, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      if (revoked.count === 1) await AuditService.record(tx, { actorUserId: claims.sub, actorType: 'USER',
        actionCode: 'AUTH_LOGOUT', resourceType: 'AUTH', outcome: 'SUCCESS' });
    });
  }

  private async issueTokenPair(
    userId: string,
    sessionId: string,
    refreshExpiresIn: number,
  ): Promise<AuthTokenPair> {
    const refreshId = randomUUID();
    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(
        { sub: userId, sid: sessionId },
        {
          secret: this.accessSecret,
          algorithm: 'HS256',
          expiresIn: this.accessTtlSeconds,
        },
      ),
      this.jwtService.signAsync(
        { sub: userId, sid: sessionId, jti: refreshId },
        {
          secret: this.refreshSecret,
          algorithm: 'HS256',
          expiresIn: refreshExpiresIn,
        },
      ),
    ]);

    return {
      accessToken,
      refreshToken,
      tokenType: 'Bearer',
      accessTokenExpiresIn: this.accessTtlSeconds,
      refreshTokenExpiresIn: refreshExpiresIn,
    };
  }

  private async verifyRefreshToken(
    refreshToken: string,
  ): Promise<RefreshTokenClaims> {
    try {
      const payload = await this.jwtService.verifyAsync<Record<string, unknown>>(
        refreshToken,
        {
          secret: this.refreshSecret,
          algorithms: ['HS256'],
        },
      );

      return parseRefreshTokenClaims(payload);
    } catch {
      throw this.invalidRefreshToken();
    }
  }

  private async verifyPassword(
    passwordHash: string,
    password: string,
  ): Promise<boolean> {
    try {
      return await argon2.verify(passwordHash, password);
    } catch {
      return false;
    }
  }

  private hashRefreshToken(refreshToken: string): string {
    return createHash('sha256').update(refreshToken).digest('hex');
  }

  private matchesRefreshTokenHash(
    refreshToken: string,
    expectedHash: string,
  ): boolean {
    const actual = Buffer.from(this.hashRefreshToken(refreshToken));
    const expected = Buffer.from(expectedHash);

    return actual.length === expected.length && timingSafeEqual(actual, expected);
  }

  private isUniqueConstraintError(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'P2002'
    );
  }

  private invalidCredentials(): UnauthorizedException {
    return new UnauthorizedException('Invalid credentials');
  }

  private invalidRefreshToken(): UnauthorizedException {
    return new UnauthorizedException('Invalid refresh token');
  }
}
