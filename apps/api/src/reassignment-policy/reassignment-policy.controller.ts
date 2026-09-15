import { Body, Controller, Get, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import { AccessTokenGuard } from '../auth/guards/access-token.guard.js';
import { AuthorizationContextGuard } from '../authorization/authorization-context.guard.js';
import { PermissionsGuard } from '../authorization/permissions.guard.js';
import { RequirePermissions } from '../authorization/decorators/require-permissions.decorator.js';
import type { AuthorizedRequest } from '../authorization/types/authorization-context.js';
import { parsePolicy, policyReadInput, policyContext } from './reassignment-policy.schemas.js';
import { ReassignmentPolicyService } from './reassignment-policy.service.js';

@Controller('reassignment-policy')
@UseGuards(AccessTokenGuard, AuthorizationContextGuard, PermissionsGuard)
export class ReassignmentPolicyController {
  constructor(private readonly service: ReassignmentPolicyService) {}
  @Get()
  @RequirePermissions('reassignments.policy.read')
  get(@Body() body: unknown, @Query() query: unknown, @Req() request: AuthorizedRequest) {
    policyReadInput(body, query);
    return this.service.get(policyContext(request));
  }
  @Post()
  @RequirePermissions('reassignments.policy.update')
  async configure(@Body() body: unknown, @Query() query: unknown, @Req() request: AuthorizedRequest,
    @Res({ passthrough: true }) response: { status(code: number): unknown }) {
    const result = await this.service.configure(parsePolicy(body, query), policyContext(request));
    response.status(result.created ? 201 : 200);
    return { data: result.data };
  }
}
