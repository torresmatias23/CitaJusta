import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { REQUIRE_PERMISSIONS_KEY } from './decorators/require-permissions.decorator.js';
import type { AuthorizedRequest } from './types/authorization-context.js';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredPermissions = [
      ...new Set(
        this.reflector.getAllAndMerge<string[]>(REQUIRE_PERMISSIONS_KEY, [
          context.getHandler(),
          context.getClass(),
        ]) ?? [],
      ),
    ];

    if (requiredPermissions.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthorizedRequest>();

    if (!request.principal) {
      throw new UnauthorizedException('Unauthorized');
    }

    const effectivePermissions = new Set(
      request.authorization?.permissions ?? [],
    );

    if (
      !requiredPermissions.every((permission) =>
        effectivePermissions.has(permission),
      )
    ) {
      throw new ForbiddenException('Forbidden');
    }

    return true;
  }
}
