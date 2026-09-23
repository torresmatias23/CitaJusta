import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { AccessTokenGuard } from '../auth/guards/access-token.guard.js';
import { ProfessionalsService } from './professionals.service.js';
import { parseProfessionalParams } from './schemas/professional-params.schemas.js';
import { AuthorizationContextGuard } from '../authorization/authorization-context.guard.js';
import { PermissionsGuard } from '../authorization/permissions.guard.js';
import { RequirePermissions } from '../authorization/decorators/require-permissions.decorator.js';
import type { AuthorizedRequest } from '../authorization/types/authorization-context.js';
import { ProfessionalAdministrationService, PROFESSIONAL_PERMISSIONS } from './professional-administration.service.js';
import { createProfessionalSchema, updateProfessionalSchema, parseProfessionalInput, professionalAdministrationContext, parseProfessionalRead, parseEligibleUserQuery } from './schemas/professional-administration.schemas.js';

@Controller('professionals')
@UseGuards(AccessTokenGuard)
export class ProfessionalsController {
  constructor(
    private readonly professionalsService: ProfessionalsService,
    private readonly administration: ProfessionalAdministrationService,
  ) {}

  @Get('administration')
  @UseGuards(AuthorizationContextGuard, PermissionsGuard)
  @RequirePermissions(PROFESSIONAL_PERMISSIONS.read)
  administrationList(@Body() body: unknown, @Query() query: unknown, @Req() request: AuthorizedRequest) {
    parseProfessionalRead(body, query);
    return this.administration.list(professionalAdministrationContext(request));
  }

  @Get('eligible-users')
  @UseGuards(AuthorizationContextGuard, PermissionsGuard)
  @RequirePermissions(PROFESSIONAL_PERMISSIONS.create)
  eligibleUser(@Body() body: unknown, @Query() query: unknown, @Req() request: AuthorizedRequest) {
    return this.administration.eligibleUser(parseEligibleUserQuery(body, query), professionalAdministrationContext(request));
  }

  @Post()
  @UseGuards(AuthorizationContextGuard, PermissionsGuard)
  @RequirePermissions(PROFESSIONAL_PERMISSIONS.create)
  create(@Body() body: unknown, @Query() query: unknown, @Req() request: AuthorizedRequest) {
    return this.administration.create(parseProfessionalInput(createProfessionalSchema, body, query), professionalAdministrationContext(request));
  }

  @Patch(':professionalId')
  @UseGuards(AuthorizationContextGuard, PermissionsGuard)
  @RequirePermissions(PROFESSIONAL_PERMISSIONS.update)
  update(@Param() params: unknown, @Body() body: unknown, @Query() query: unknown, @Req() request: AuthorizedRequest) {
    const { professionalId } = parseProfessionalParams(params);
    return this.administration.update(professionalId, parseProfessionalInput(updateProfessionalSchema, body, query), professionalAdministrationContext(request));
  }

  @Get()
  findAll() {
    return this.professionalsService.findAll();
  }

  @Get(':professionalId')
  findById(@Param() params: unknown) {
    const { professionalId } = parseProfessionalParams(params);

    return this.professionalsService.findById(professionalId);
  }
}
