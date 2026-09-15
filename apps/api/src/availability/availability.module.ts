import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { DatabaseModule } from '../database/database.module.js';
import { AvailabilityController } from './availability.controller.js';
import { AgendaAvailabilityService } from './availability.service.js';
import { AuthorizationModule } from '../authorization/authorization.module.js';
import { AvailabilityAdministrationController } from './availability-administration.controller.js';
import { AvailabilityAdministrationService } from './availability-administration.service.js';

@Module({
  imports: [DatabaseModule, AuthModule, AuthorizationModule],
  controllers: [AvailabilityController, AvailabilityAdministrationController],
  providers: [AgendaAvailabilityService, AvailabilityAdministrationService],
})
export class AvailabilityModule {}
