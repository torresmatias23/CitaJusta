import { Injectable, UnauthorizedException } from '@nestjs/common';
import type { AuthenticatedPrincipal } from '../auth/types/authenticated-principal.js';
import type { AuthorizationContext } from '../authorization/types/authorization-context.js';
import { PrismaService } from '../database/prisma.service.js';
import { UserStatus } from '../generated/prisma/client.js';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async getMe(
    principal: AuthenticatedPrincipal,
    authorization: AuthorizationContext,
  ) {
    if (authorization.userId !== principal.userId) {
      throw new UnauthorizedException('Unauthorized');
    }

    const user = await this.prisma.user.findFirst({
      where: {
        id: principal.userId,
        status: UserStatus.ACTIVE,
        deletedAt: null,
      },
      select: {
        id: true,
        email: true,
        firstNames: true,
        lastNames: true,
        status: true,
      },
    });

    if (!user) {
      throw new UnauthorizedException('Unauthorized');
    }

    return {
      data: {
        id: user.id,
        email: user.email,
        firstName: user.firstNames,
        lastName: user.lastNames,
        status: user.status,
        context: {
          ...(authorization.institutionId
            ? { institutionId: authorization.institutionId }
            : {}),
          ...(authorization.branchId
            ? { branchId: authorization.branchId }
            : {}),
        },
        roles: [...authorization.roleCodes],
        permissions: [...authorization.permissions],
      },
    };
  }
}
