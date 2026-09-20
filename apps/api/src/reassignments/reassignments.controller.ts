import {
  BadRequestException, Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query, Req,
  UnauthorizedException, UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { AccessTokenGuard } from '../auth/guards/access-token.guard.js';
import type { AuthenticatedRequest } from '../auth/types/authenticated-principal.js';
import { AuthorizationContextGuard } from '../authorization/authorization-context.guard.js';
import { PermissionsGuard } from '../authorization/permissions.guard.js';
import { RequirePermissions } from '../authorization/decorators/require-permissions.decorator.js';
import type { AuthorizedRequest } from '../authorization/types/authorization-context.js';
import { ReassignmentsService, GENERATE_OFFERS_PERMISSION } from './reassignments.service.js';
import { ReassignmentSupervisionService, SUPERVISE_REASSIGNMENTS_PERMISSION } from './reassignment-supervision.service.js';
import { RecipientOffersService } from './recipient-offers.service.js';

const slotParamsSchema = z.object({ agendaSlotId: z.string().uuid() }).strict();
const offerParamsSchema = z.object({ offerId: z.string().uuid() }).strict();
const reassignmentParamsSchema = z.object({ reassignmentId: z.string().uuid() }).strict();
const empty = z.object({}).strict();

@Controller('reassignments')
export class ReassignmentsController {
  constructor(private readonly service: ReassignmentsService, private readonly supervision: ReassignmentSupervisionService, private readonly recipientOffers: RecipientOffersService) {}

  @Get('offers/me')
  @UseGuards(AccessTokenGuard)
  findMine(@Query() query: unknown, @Body() body: unknown, @Req() request: AuthenticatedRequest) {
    if (!request.principal) throw new UnauthorizedException('Unauthorized');
    if (!empty.safeParse(query).success || !empty.optional().safeParse(body).success) {
      throw new BadRequestException('Invalid recipient offers request');
    }
    return this.recipientOffers.findMine(request.principal);
  }

  @Get(':reassignmentId')
  @UseGuards(AccessTokenGuard, AuthorizationContextGuard, PermissionsGuard)
  @RequirePermissions(SUPERVISE_REASSIGNMENTS_PERMISSION)
  getDetail(@Param() params: unknown, @Query() query: unknown, @Body() body: unknown, @Req() request: AuthorizedRequest) {
    if (!request.principal || !request.authorization) throw new UnauthorizedException('Unauthorized');
    const parsed = reassignmentParamsSchema.safeParse(params);
    if (!parsed.success || !empty.safeParse(query).success || !empty.optional().safeParse(body).success) {
      throw new BadRequestException('Invalid reassignment supervision request');
    }
    if (!request.authorization.institutionId) throw new BadRequestException('Institutional context required');
    return this.supervision.getDetail(parsed.data.reassignmentId, request.authorization);
  }

  @Post(':agendaSlotId/offers')
  @UseGuards(AccessTokenGuard, AuthorizationContextGuard, PermissionsGuard)
  @RequirePermissions(GENERATE_OFFERS_PERMISSION)
  generate(
    @Param() params: unknown,
    @Query() query: unknown,
    @Body() body: unknown,
    @Req() request: AuthorizedRequest,
  ) {
    if (!request.principal || !request.authorization) throw new UnauthorizedException('Unauthorized');
    const parsed = slotParamsSchema.safeParse(params);
    if (!parsed.success || !empty.safeParse(query).success || !empty.optional().safeParse(body).success) {
      throw new BadRequestException('Invalid offer generation request');
    }
    if (!request.authorization.institutionId) throw new BadRequestException('Institutional context required');
    return this.service.generate(parsed.data.agendaSlotId, request.authorization);
  }

  @Post('offers/:offerId/accept')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AccessTokenGuard)
  accept(
    @Param() params: unknown,
    @Query() query: unknown,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    if (!request.principal) throw new UnauthorizedException('Unauthorized');
    const parsed = offerParamsSchema.safeParse(params);
    if (!parsed.success || !empty.safeParse(query).success || !empty.optional().safeParse(body).success) {
      throw new BadRequestException('Invalid offer acceptance request');
    }
    return this.service.acceptOffer(parsed.data.offerId, request.principal);
  }

  @Post('offers/:offerId/reject')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AccessTokenGuard)
  reject(
    @Param() params: unknown,
    @Query() query: unknown,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    if (!request.principal) throw new UnauthorizedException('Unauthorized');
    const parsed = offerParamsSchema.safeParse(params);
    if (!parsed.success || !empty.safeParse(query).success || !empty.optional().safeParse(body).success) {
      throw new BadRequestException('Invalid offer rejection request');
    }
    return this.service.rejectOffer(parsed.data.offerId, request.principal);
  }
}
