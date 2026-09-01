import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from './auth/auth.module.js';
import { validateEnvironment } from './config/environment.validation.js';
import { DatabaseModule } from './database/database.module.js';
import { HealthController } from './health.controller.js';
import { InstitutionsModule } from './institutions/institutions.module.js';
import { ProfessionalsModule } from './professionals/professionals.module.js';
import { ServicesModule } from './services/services.module.js';
import { UsersModule } from './users/users.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnvironment,
    }),
    DatabaseModule,
    AuthModule,
    InstitutionsModule,
    ProfessionalsModule,
    ServicesModule,
    UsersModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
