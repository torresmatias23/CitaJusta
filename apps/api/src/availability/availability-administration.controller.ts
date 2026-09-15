import { Body, Controller, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { AccessTokenGuard } from '../auth/guards/access-token.guard.js';
import { AuthorizationContextGuard } from '../authorization/authorization-context.guard.js';
import { PermissionsGuard } from '../authorization/permissions.guard.js';
import { RequirePermissions } from '../authorization/decorators/require-permissions.decorator.js';
import type { AuthorizedRequest } from '../authorization/types/authorization-context.js';
import { AvailabilityAdministrationService } from './availability-administration.service.js';
import { administrationContext, createAvailabilitySchema, createBlockSchema, parseAdministrationInput, parseAvailabilityId, updateAvailabilitySchema } from './availability-administration.schemas.js';

@Controller('availability')
@UseGuards(AccessTokenGuard, AuthorizationContextGuard, PermissionsGuard)
export class AvailabilityAdministrationController {
  constructor(private readonly service: AvailabilityAdministrationService) {}

  @Post()
  @RequirePermissions('availability.create')
  create(@Body() body: unknown, @Query() query: unknown, @Req() request: AuthorizedRequest) {
    return this.service.create(parseAdministrationInput(createAvailabilitySchema, body, query), administrationContext(request));
  }

  @Patch(':availabilityId')
  @RequirePermissions('availability.update')
  update(@Param() params: unknown, @Body() body: unknown, @Query() query: unknown, @Req() request: AuthorizedRequest) {
    return this.service.update(parseAvailabilityId(params), parseAdministrationInput(updateAvailabilitySchema, body, query), administrationContext(request));
  }

  @Post('blocks')
  @RequirePermissions('availability.block')
  block(@Body() body: unknown, @Query() query: unknown, @Req() request: AuthorizedRequest) {
    return this.service.block(parseAdministrationInput(createBlockSchema, body, query), administrationContext(request));
  }
}
