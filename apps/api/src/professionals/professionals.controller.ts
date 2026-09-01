import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { AccessTokenGuard } from '../auth/guards/access-token.guard.js';
import { ProfessionalsService } from './professionals.service.js';
import { parseProfessionalParams } from './schemas/professional-params.schemas.js';

@Controller('professionals')
@UseGuards(AccessTokenGuard)
export class ProfessionalsController {
  constructor(
    private readonly professionalsService: ProfessionalsService,
  ) {}

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
