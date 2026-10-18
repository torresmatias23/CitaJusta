import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { DatabaseModule } from '../database/database.module.js';
import { InstitutionsController } from './institutions.controller.js';
import { InstitutionsService } from './institutions.service.js';
import { AuthorizationModule } from '../authorization/authorization.module.js';
import { InstitutionAdministrationController } from './institution-administration.controller.js';
import { InstitutionAdministrationService } from './institution-administration.service.js';

@Module({
  imports: [DatabaseModule, AuthModule, AuthorizationModule],
  controllers: [InstitutionAdministrationController, InstitutionsController],
  providers: [InstitutionsService, InstitutionAdministrationService],
})
export class InstitutionsModule {}
