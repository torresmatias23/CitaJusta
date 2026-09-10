import { BadRequestException, Body, Controller, Param, Post, Query, Req, UnauthorizedException, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { AccessTokenGuard } from '../auth/guards/access-token.guard.js';
import { AuthorizationContextGuard } from '../authorization/authorization-context.guard.js';
import { PermissionsGuard } from '../authorization/permissions.guard.js';
import { RequirePermissions } from '../authorization/decorators/require-permissions.decorator.js';
import type { AuthorizedRequest } from '../authorization/types/authorization-context.js';
import { ReassignmentsService, GENERATE_OFFERS_PERMISSION } from './reassignments.service.js';

const paramsSchema = z.object({ agendaSlotId: z.string().uuid() }).strict();
const empty = z.object({}).strict();
@Controller('reassignments')
@UseGuards(AccessTokenGuard, AuthorizationContextGuard, PermissionsGuard)
export class ReassignmentsController {
  constructor(private readonly service: ReassignmentsService) {}
  @Post(':agendaSlotId/offers')
  @RequirePermissions(GENERATE_OFFERS_PERMISSION)
  generate(@Param() params: unknown, @Query() query: unknown, @Body() body: unknown, @Req() request: AuthorizedRequest) {
    if (!request.principal || !request.authorization) throw new UnauthorizedException('Unauthorized');
    const parsed = paramsSchema.safeParse(params);
    if (!parsed.success || !empty.safeParse(query).success || !empty.optional().safeParse(body).success) {
      throw new BadRequestException('Invalid offer generation request');
    }
    if (!request.authorization.institutionId) throw new BadRequestException('Institutional context required');
    return this.service.generate(parsed.data.agendaSlotId, request.authorization);
  }
}
