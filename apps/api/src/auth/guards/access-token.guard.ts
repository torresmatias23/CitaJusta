import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../database/prisma.service.js';
import { UserStatus } from '../../generated/prisma/client.js';
import { parseAccessTokenClaims } from '../schemas/auth.schemas.js';
import type { AuthenticatedRequest } from '../types/authenticated-principal.js';

@Injectable()
export class AccessTokenGuard implements CanActivate {
  private readonly accessSecret: string;

  constructor(
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
    configService: ConfigService,
  ) {
    this.accessSecret =
      configService.getOrThrow<string>('JWT_ACCESS_SECRET');
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = this.extractBearerToken(request.headers.authorization);
    const claims = await this.verifyAccessToken(token);
    const user = await this.prisma.user.findUnique({
      where: { id: claims.sub },
      select: {
        status: true,
        deletedAt: true,
      },
    });

    if (
      !user ||
      user.status !== UserStatus.ACTIVE ||
      user.deletedAt !== null
    ) {
      throw this.unauthorized();
    }

    request.principal = {
      userId: claims.sub,
      sessionId: claims.sid,
    };

    return true;
  }

  private extractBearerToken(
    authorization: string | string[] | undefined,
  ): string {
    if (typeof authorization !== 'string') {
      throw this.unauthorized();
    }

    const match = /^Bearer\s+(\S+)$/i.exec(authorization.trim());

    if (!match) {
      throw this.unauthorized();
    }

    return match[1];
  }

  private async verifyAccessToken(token: string) {
    try {
      const payload = await this.jwtService.verifyAsync<Record<string, unknown>>(
        token,
        {
          secret: this.accessSecret,
          algorithms: ['HS256'],
        },
      );

      return parseAccessTokenClaims(payload);
    } catch {
      throw this.unauthorized();
    }
  }

  private unauthorized(): UnauthorizedException {
    return new UnauthorizedException('Unauthorized');
  }
}
