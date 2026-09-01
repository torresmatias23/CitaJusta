import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { AccessTokenGuard } from '../auth/guards/access-token.guard.js';
import { ServicesService } from './services.service.js';
import { parseServiceParams } from './services.schemas.js';

@Controller('services')
@UseGuards(AccessTokenGuard)
export class ServicesController {
  constructor(private readonly servicesService: ServicesService) {}

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
