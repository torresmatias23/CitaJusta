import { Body, Controller, Get, Query, Req, UnauthorizedException, UseGuards } from '@nestjs/common';
import { AccessTokenGuard } from '../auth/guards/access-token.guard.js';
import { AuthorizationContextGuard } from '../authorization/authorization-context.guard.js';
import { PermissionsGuard } from '../authorization/permissions.guard.js';
import { RequirePermissions } from '../authorization/decorators/require-permissions.decorator.js';
import type { AuthorizedRequest } from '../authorization/types/authorization-context.js';
import { ReportsDashboardService } from './reports-dashboard.service.js';
import { ReportsService } from './reports.service.js';
import { parseReportsQuery } from './reports.schemas.js';

function authorized(request: AuthorizedRequest) {
  if (!request.principal || !request.authorization || request.principal.userId !== request.authorization.userId) {
    throw new UnauthorizedException('Unauthorized');
  }
  return request.authorization;
}

@Controller('reports')
@UseGuards(AccessTokenGuard, AuthorizationContextGuard, PermissionsGuard)
export class ReportsController {
  constructor(private readonly service: ReportsService, private readonly dashboard: ReportsDashboardService) {}

  @Get('indicators')
  @RequirePermissions('reports.read')
  find(@Query() query: unknown, @Body() body: unknown, @Req() request: AuthorizedRequest) {
    const context = authorized(request);
    return this.service.find(parseReportsQuery(query, body), context);
  }

  @Get('dashboard')
  @RequirePermissions('reports.read')
  findDashboard(@Query() query: unknown, @Body() body: unknown, @Req() request: AuthorizedRequest) {
    const context = authorized(request);
    return this.dashboard.find(parseReportsQuery(query, body), context);
  }
}
