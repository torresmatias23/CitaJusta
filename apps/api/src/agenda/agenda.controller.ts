import { Body, Controller, Get, Query, Req, UnauthorizedException, UseGuards } from '@nestjs/common';
import { AccessTokenGuard } from '../auth/guards/access-token.guard.js';
import { AuthorizationContextGuard } from '../authorization/authorization-context.guard.js';
import { PermissionsGuard } from '../authorization/permissions.guard.js';
import { RequirePermissions } from '../authorization/decorators/require-permissions.decorator.js';
import type { AuthorizedRequest } from '../authorization/types/authorization-context.js';
import { AgendaService } from './agenda.service.js';
import { parseAgendaQuery } from './agenda.schemas.js';

@Controller('agenda')
@UseGuards(AccessTokenGuard, AuthorizationContextGuard, PermissionsGuard)
export class AgendaController {
  constructor(private readonly service: AgendaService) {}

  @Get()
  @RequirePermissions('agenda.read')
  find(@Query() query: unknown, @Body() body: unknown, @Req() request: AuthorizedRequest) {
    if (!request.principal || !request.authorization || request.principal.userId !== request.authorization.userId) throw new UnauthorizedException('Unauthorized');
    return this.service.find(parseAgendaQuery(query, body), request.authorization);
  }
}
