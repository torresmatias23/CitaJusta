import { Body, Controller, Get, Query, Req, UnauthorizedException, UseGuards } from '@nestjs/common';
import { AccessTokenGuard } from '../auth/guards/access-token.guard.js';
import { AuthorizationContextGuard } from '../authorization/authorization-context.guard.js';
import { PermissionsGuard } from '../authorization/permissions.guard.js';
import { RequirePermissions } from '../authorization/decorators/require-permissions.decorator.js';
import type { AuthorizedRequest } from '../authorization/types/authorization-context.js';
import { parseInstitutionalUsersQuery } from './institutional-users.schemas.js';
import { InstitutionalUsersService, READ_INSTITUTIONAL_USERS } from './institutional-users.service.js';

@Controller('users/administration')
@UseGuards(AccessTokenGuard, AuthorizationContextGuard, PermissionsGuard)
export class InstitutionalUsersController {
  constructor(private readonly service: InstitutionalUsersService) {}

  @Get()
  @RequirePermissions(READ_INSTITUTIONAL_USERS)
  find(@Query() query: unknown, @Body() body: unknown, @Req() request: AuthorizedRequest) {
    if (!request.principal || !request.authorization || request.principal.userId !== request.authorization.userId) {
      throw new UnauthorizedException('Unauthorized');
    }
    return this.service.find(parseInstitutionalUsersQuery(query, body), request.authorization);
  }
}
