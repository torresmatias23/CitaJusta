import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { AccessTokenGuard } from '../auth/guards/access-token.guard.js';
import {
  parseBranchParams,
  parseServiceParams,
} from '../services/services.schemas.js';
import { ProfessionalsService } from './professionals.service.js';

@Controller()
@UseGuards(AccessTokenGuard)
export class ProfessionalRelationsController {
  constructor(
    private readonly professionalsService: ProfessionalsService,
  ) {}

  @Get('branches/:branchId/professionals')
  findByBranch(@Param() params: unknown) {
    const { branchId } = parseBranchParams(params);

    return this.professionalsService.findByBranch(branchId);
  }

  @Get('services/:serviceId/professionals')
  findByService(@Param() params: unknown) {
    const { serviceId } = parseServiceParams(params);

    return this.professionalsService.findByService(serviceId);
  }

  @Get('branches/:branchId/services/:serviceId/professionals')
  findByBranchAndService(@Param() params: unknown) {
    const { branchId } = parseBranchParams(params);
    const { serviceId } = parseServiceParams(params);

    return this.professionalsService.findByBranchAndService(
      branchId,
      serviceId,
    );
  }
}
