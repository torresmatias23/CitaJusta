import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { DatabaseModule } from '../database/database.module.js';
import { AppointmentsController } from './appointments.controller.js';
import { AppointmentsService } from './appointments.service.js';

@Module({
  imports: [DatabaseModule, AuthModule],
  controllers: [AppointmentsController],
  providers: [AppointmentsService],
})
export class AppointmentsModule {}
