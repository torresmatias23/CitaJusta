import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { AccessTokenGuard } from '../auth/guards/access-token.guard.js';
import { parseBranchParams } from './services.schemas.js';
import { ServicesService } from './services.service.js';
import { AuthorizationContextGuard } from '../authorization/authorization-context.guard.js';
import { PermissionsGuard } from '../authorization/permissions.guard.js';
import { RequirePermissions } from '../authorization/decorators/require-permissions.decorator.js';
import type { AuthorizedRequest } from '../authorization/types/authorization-context.js';
import { CatalogAdministrationService, CATALOG_PERMISSIONS } from './catalog-administration.service.js';
import { catalogContext, createBranchSchema, updateBranchSchema, parseCatalogInput, parseCatalogRead } from './catalog-administration.schemas.js';

@Controller('branches')
@UseGuards(AccessTokenGuard)
export class BranchesController {
  constructor(
    private readonly servicesService: ServicesService,
    private readonly administration: CatalogAdministrationService,
  ) {}

  @Get('administration')
  @UseGuards(AuthorizationContextGuard, PermissionsGuard)
  @RequirePermissions(CATALOG_PERMISSIONS.readBranches)
  administrationList(@Body() body: unknown, @Query() query: unknown, @Req() request: AuthorizedRequest) {
    parseCatalogRead(body, query);
    return this.administration.listBranches(catalogContext(request));
  }

  @Post()
  @UseGuards(AuthorizationContextGuard, PermissionsGuard)
  @RequirePermissions(CATALOG_PERMISSIONS.createBranch)
  create(@Body() body: unknown, @Query() query: unknown, @Req() request: AuthorizedRequest) {
    return this.administration.createBranch(parseCatalogInput(createBranchSchema, body, query), catalogContext(request));
  }

  @Patch(':branchId')
  @UseGuards(AuthorizationContextGuard, PermissionsGuard)
  @RequirePermissions(CATALOG_PERMISSIONS.updateBranch)
  update(@Param() params: unknown, @Body() body: unknown, @Query() query: unknown, @Req() request: AuthorizedRequest) {
    const { branchId } = parseBranchParams(params);
    return this.administration.updateBranch(branchId, parseCatalogInput(updateBranchSchema, body, query), catalogContext(request));
  }

  @Get(':branchId/services')
  findServices(@Param() params: unknown) {
    const { branchId } = parseBranchParams(params);

    return this.servicesService.findByBranch(branchId);
  }
}
