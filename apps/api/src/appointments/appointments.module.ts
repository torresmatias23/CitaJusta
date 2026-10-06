import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { DatabaseModule } from '../database/database.module.js';
import { AppointmentsController } from './appointments.controller.js';
import { AppointmentsService } from './appointments.service.js';
import { AuthorizationModule } from '../authorization/authorization.module.js';
import { AttendanceController } from './attendance.controller.js';
import { AttendanceService } from './attendance.service.js';
import { AppointmentCalendarService } from './appointment-calendar.service.js';
import { GoogleCalendarAdapter } from './google-calendar.adapter.js';

@Module({
  imports: [DatabaseModule, AuthModule, AuthorizationModule],
  controllers: [AppointmentsController, AttendanceController],
  providers: [AppointmentsService, AttendanceService, AppointmentCalendarService, GoogleCalendarAdapter],
})
export class AppointmentsModule {}
