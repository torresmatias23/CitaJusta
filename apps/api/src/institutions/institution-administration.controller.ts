import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { AccessTokenGuard } from '../auth/guards/access-token.guard.js';
import { AuthorizationContextGuard } from '../authorization/authorization-context.guard.js';
import { PermissionsGuard } from '../authorization/permissions.guard.js';
import { RequirePermissions } from '../authorization/decorators/require-permissions.decorator.js';
import type { AuthorizedRequest } from '../authorization/types/authorization-context.js';
import { parseInstitutionParams } from './institutions.schemas.js';
import { InstitutionAdministrationService } from './institution-administration.service.js';
import { createInstitutionSchema, updateInstitutionSchema, parseInstitutionAdministration,
  parseInstitutionAdministrationRead, institutionAdministrationContext } from './institution-administration.schemas.js';

@Controller('institutions')
@UseGuards(AccessTokenGuard, AuthorizationContextGuard, PermissionsGuard)
export class InstitutionAdministrationController {
  constructor(private readonly service: InstitutionAdministrationService) {}

  @Get('administration')
  @RequirePermissions('institutions.read')
  list(@Body() body: unknown, @Query() query: unknown, @Req() request: AuthorizedRequest) {
    parseInstitutionAdministrationRead(body, query);
    return this.service.list(institutionAdministrationContext(request));
  }

  @Post()
  @RequirePermissions('institutions.create')
  create(@Body() body: unknown, @Query() query: unknown, @Req() request: AuthorizedRequest) {
    return this.service.create(parseInstitutionAdministration(createInstitutionSchema, body, query), institutionAdministrationContext(request));
  }

  @Patch(':institutionId')
  @RequirePermissions('institutions.update')
  update(@Param() params: unknown, @Body() body: unknown, @Query() query: unknown, @Req() request: AuthorizedRequest) {
    const { institutionId } = parseInstitutionParams(params);
    return this.service.update(institutionId, parseInstitutionAdministration(updateInstitutionSchema, body, query), institutionAdministrationContext(request));
  }
}
