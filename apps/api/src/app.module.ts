import { Module } from '@nestjs/common';
import { AuditModule } from './audit/audit.module.js';
import { ReportsModule } from './reports/reports.module.js';
import { ReassignmentPolicyModule } from './reassignment-policy/reassignment-policy.module.js';
import { AgendaModule } from './agenda/agenda.module.js';
import { ConfigModule } from '@nestjs/config';
import { AppointmentsModule } from './appointments/appointments.module.js';
import { AvailabilityModule } from './availability/availability.module.js';
import { AuthModule } from './auth/auth.module.js';
import { validateEnvironment } from './config/environment.validation.js';
import { DatabaseModule } from './database/database.module.js';
import { HealthController } from './health.controller.js';
import { InstitutionsModule } from './institutions/institutions.module.js';
import { ProfessionalsModule } from './professionals/professionals.module.js';
import { ServicesModule } from './services/services.module.js';
import { UsersModule } from './users/users.module.js';
import { WaitlistModule } from './waitlist/waitlist.module.js';
import { ReassignmentsModule } from './reassignments/reassignments.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnvironment,
    }),
    DatabaseModule,
    AuditModule,
    ReportsModule,
    ReassignmentPolicyModule,
    AgendaModule,
    AuthModule,
    AppointmentsModule,
    AvailabilityModule,
    InstitutionsModule,
    ProfessionalsModule,
    ServicesModule,
    UsersModule,
    WaitlistModule,
    ReassignmentsModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
