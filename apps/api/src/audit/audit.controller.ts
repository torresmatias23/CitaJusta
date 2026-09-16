import { Body, Controller, Get, Query, Req, UnauthorizedException, UseGuards } from '@nestjs/common';
import { AccessTokenGuard } from '../auth/guards/access-token.guard.js';
import { AuthorizationContextGuard } from '../authorization/authorization-context.guard.js';
import { PermissionsGuard } from '../authorization/permissions.guard.js';
import { RequirePermissions } from '../authorization/decorators/require-permissions.decorator.js';
import type { AuthorizedRequest } from '../authorization/types/authorization-context.js';
import { AuditService } from './audit.service.js';
import { parseAuditQuery } from './audit.schemas.js';

@Controller('audit')
@UseGuards(AccessTokenGuard, AuthorizationContextGuard, PermissionsGuard)
export class AuditController {
  constructor(private readonly service: AuditService) {}

  @Get('events')
  @RequirePermissions('audit.read')
  find(@Query() query: unknown, @Body() body: unknown, @Req() request: AuthorizedRequest) {
    if (!request.principal || !request.authorization || request.principal.userId !== request.authorization.userId) throw new UnauthorizedException('Unauthorized');
    return this.service.find(parseAuditQuery(query, body), request.authorization);
  }
}
