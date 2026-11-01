import { Body, Controller, Get, Query, Req, UnauthorizedException, UseGuards } from '@nestjs/common';
import { AccessTokenGuard } from '../auth/guards/access-token.guard.js';
import { AuthorizationContextGuard } from '../authorization/authorization-context.guard.js';
import { PermissionsGuard } from '../authorization/permissions.guard.js';
import { RequirePermissions } from '../authorization/decorators/require-permissions.decorator.js';
import type { AuthorizedRequest } from '../authorization/types/authorization-context.js';
import { parseInstitutionalWaitlistQuery } from './institutional-waitlist.schemas.js';
import { InstitutionalWaitlistService, READ_INSTITUTIONAL_WAITLIST } from './institutional-waitlist.service.js';

@Controller('waitlist/administration')
@UseGuards(AccessTokenGuard, AuthorizationContextGuard, PermissionsGuard)
export class InstitutionalWaitlistController {
  constructor(private readonly service: InstitutionalWaitlistService) {}

  @Get()
  @RequirePermissions(READ_INSTITUTIONAL_WAITLIST)
  find(@Query() query: unknown, @Body() body: unknown, @Req() request: AuthorizedRequest) {
    if (!request.principal || !request.authorization || request.principal.userId !== request.authorization.userId) {
      throw new UnauthorizedException('Unauthorized');
    }
    return this.service.find(parseInstitutionalWaitlistQuery(query, body), request.authorization);
  }
}
