import {
  Controller,
  Get,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AccessTokenGuard } from '../auth/guards/access-token.guard.js';
import { parseProfessionalParams } from '../professionals/schemas/professional-params.schemas.js';
import {
  parseBranchParams,
  parseServiceParams,
} from '../services/services.schemas.js';
import { AgendaAvailabilityService } from './availability.service.js';
import { parseAvailabilityRange } from './schemas/availability-query.schemas.js';

@Controller('branches/:branchId/services/:serviceId')
@UseGuards(AccessTokenGuard)
export class AvailabilityController {
  constructor(
    private readonly availabilityService: AgendaAvailabilityService,
  ) {}

  @Get('availability')
  findAvailableSlots(
    @Param() params: unknown,
    @Query() query: unknown,
  ) {
    const { branchId } = parseBranchParams(params);
    const { serviceId } = parseServiceParams(params);
    const range = parseAvailabilityRange(query);

    return this.availabilityService.findAvailableSlots(
      branchId,
      serviceId,
      range,
    );
  }

  @Get('professionals/:professionalId/availability')
  findAvailableSlotsByProfessional(
    @Param() params: unknown,
    @Query() query: unknown,
  ) {
    const { branchId } = parseBranchParams(params);
    const { serviceId } = parseServiceParams(params);
    const { professionalId } = parseProfessionalParams(params);
    const range = parseAvailabilityRange(query);

    return this.availabilityService.findAvailableSlotsByProfessional(
      branchId,
      serviceId,
      professionalId,
      range,
    );
  }
}
