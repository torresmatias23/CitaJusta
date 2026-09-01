import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { DatabaseModule } from '../database/database.module.js';
import { AvailabilityController } from './availability.controller.js';
import { AgendaAvailabilityService } from './availability.service.js';

@Module({
  imports: [DatabaseModule, AuthModule],
  controllers: [AvailabilityController],
  providers: [AgendaAvailabilityService],
})
export class AvailabilityModule {}
