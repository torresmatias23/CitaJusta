import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { AccessTokenGuard } from '../auth/guards/access-token.guard.js';
import { parseBranchParams } from './services.schemas.js';
import { ServicesService } from './services.service.js';

@Controller('branches')
@UseGuards(AccessTokenGuard)
export class BranchesController {
  constructor(private readonly servicesService: ServicesService) {}

  @Get(':branchId/services')
  findServices(@Param() params: unknown) {
    const { branchId } = parseBranchParams(params);

    return this.servicesService.findByBranch(branchId);
  }
}
