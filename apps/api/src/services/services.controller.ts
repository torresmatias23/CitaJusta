import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { AccessTokenGuard } from '../auth/guards/access-token.guard.js';
import { ServicesService } from './services.service.js';
import { parseServiceParams } from './services.schemas.js';
import { AuthorizationContextGuard } from '../authorization/authorization-context.guard.js';
import { PermissionsGuard } from '../authorization/permissions.guard.js';
import { RequirePermissions } from '../authorization/decorators/require-permissions.decorator.js';
import type { AuthorizedRequest } from '../authorization/types/authorization-context.js';
import { CatalogAdministrationService, CATALOG_PERMISSIONS } from './catalog-administration.service.js';
import { catalogContext, createServiceSchema, updateServiceSchema, parseCatalogInput, parseCatalogRead } from './catalog-administration.schemas.js';

@Controller('services')
@UseGuards(AccessTokenGuard)
export class ServicesController {
  constructor(
    private readonly servicesService: ServicesService,
    private readonly administration: CatalogAdministrationService,
  ) {}

  @Get('administration')
  @UseGuards(AuthorizationContextGuard, PermissionsGuard)
  @RequirePermissions(CATALOG_PERMISSIONS.readServices)
  administrationList(@Body() body: unknown, @Query() query: unknown, @Req() request: AuthorizedRequest) {
    parseCatalogRead(body, query);
    return this.administration.listServices(catalogContext(request));
  }

  @Get('categories')
  @UseGuards(AuthorizationContextGuard, PermissionsGuard)
  @RequirePermissions(CATALOG_PERMISSIONS.readServices)
  categories(@Body() body: unknown, @Query() query: unknown, @Req() request: AuthorizedRequest) {
    parseCatalogRead(body, query);
    return this.administration.listCategories(catalogContext(request));
  }

  @Post()
  @UseGuards(AuthorizationContextGuard, PermissionsGuard)
  @RequirePermissions(CATALOG_PERMISSIONS.createService)
  create(@Body() body: unknown, @Query() query: unknown, @Req() request: AuthorizedRequest) {
    return this.administration.createService(parseCatalogInput(createServiceSchema, body, query), catalogContext(request));
  }

  @Patch(':serviceId')
  @UseGuards(AuthorizationContextGuard, PermissionsGuard)
  @RequirePermissions(CATALOG_PERMISSIONS.updateService)
  update(@Param() params: unknown, @Body() body: unknown, @Query() query: unknown, @Req() request: AuthorizedRequest) {
    const { serviceId } = parseServiceParams(params);
    return this.administration.updateService(serviceId, parseCatalogInput(updateServiceSchema, body, query), catalogContext(request));
  }

  @Get()
  findAll() {
    return this.servicesService.findAll();
  }

  @Get(':serviceId')
  findById(@Param() params: unknown) {
    const { serviceId } = parseServiceParams(params);

    return this.servicesService.findById(serviceId);
  }
}
