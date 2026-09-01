import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { AccessTokenGuard } from '../auth/guards/access-token.guard.js';
import { InstitutionsService } from './institutions.service.js';
import { parseInstitutionParams } from './institutions.schemas.js';

@Controller('institutions')
@UseGuards(AccessTokenGuard)
export class InstitutionsController {
  constructor(
    private readonly institutionsService: InstitutionsService,
  ) {}

  @Get()
  findAll() {
    return this.institutionsService.findAll();
  }

  @Get(':institutionId/branches')
  findBranches(@Param() params: unknown) {
    const { institutionId } = parseInstitutionParams(params);

    return this.institutionsService.findBranches(institutionId);
  }

  @Get(':institutionId')
  findById(@Param() params: unknown) {
    const { institutionId } = parseInstitutionParams(params);

    return this.institutionsService.findById(institutionId);
  }
}
